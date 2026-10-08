const express = require('express');
const { supabaseAdmin, createAuthClient } = require('../lib/supabase');
const { uploadPhoto } = require('../middleware/upload');
const { compressImage } = require('../lib/compressImage');
const { normalizePhone, placeholderEmail } = require('../lib/phone');

const router = express.Router();

const PHASES = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 's1', 's2', 's3'];
const PHOTO_BUCKET = 'avatars';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9]{10,15}$/;
const EXT_BY_TYPE = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function validateRegistration(body) {
    const errors = {};
    if (!body.name) errors.name = "Name is required.";
    if (body.email && !EMAIL_RE.test(body.email)) errors.email = "Enter a valid email address.";
    if (!body.phone) errors.phone = "Mobile number is required.";
    else if (!PHONE_RE.test(body.phone)) errors.phone = "Enter a valid phone number (10-15 digits).";
    if (!PHASES.includes(body.phase)) errors.phase = "Select a valid phase.";
    if (!body.villaNo) errors.villaNo = "Villa number is required.";
    if (!body.password || body.password.length < 8) errors.password = "Password must be at least 8 characters.";
    return errors;
}

// POST /api/auth/register  (multipart/form-data)
router.post('/register', uploadPhoto, async (req, res) => {
    const input = req.body || {};
    const body = {
        name: input.name?.trim(),
        email: input.email?.trim().toLowerCase() || null,
        phone: normalizePhone(input.phone),
        phase: input.phase,
        villaNo: input.villaNo?.trim(),
        password: input.password,
    };

    const errors = validateRegistration(body);
    if (Object.keys(errors).length) {
        return res.status(400).json({ message: 'Please fix the highlighted fields.', errors });
    }

    // Photo is optional. Shrink it to under 1 MB before anything is created.
    let photo = null;
    try {
        if (req.file) photo = await compressImage(req.file.buffer, req.file.mimetype);
    } catch (err) {
        console.error('Photo compression failed:', err.message);
        return res.status(400).json({
            message: 'Could not process this photo. Please try a different image.',
            errors: { photo: 'Could not process this photo.' },
        });
    }

    // The mobile number is the login id, so it must be unique.
    const { data: existing } = await supabaseAdmin.from('profiles').select('id').eq('phone', body.phone).maybeSingle();
    if (existing) {
        return res.status(409).json({
            message: 'This mobile number is already registered. Please log in.',
            errors: { phone: 'This mobile number is already registered.' },
        });
    }

    // 1. Create the login account (Supabase Auth needs an email; use a placeholder if none given).
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: body.email || placeholderEmail(body.phone),
        password: body.password,
        email_confirm: true,
    });
    if (authError) {
        const taken = authError.code === 'email_exists' || /already/i.test(authError.message);
        return res.status(taken ? 409 : 400).json({
            message: taken ? 'An account with this email already exists.' : authError.message,
            errors: taken ? { email: 'This email is already registered.' } : undefined,
        });
    }
    const userId = created.user.id;

    // Undo the partial registration if a later step fails.
    const rollback = async (photoPath) => {
        if (photoPath) await supabaseAdmin.storage.from(PHOTO_BUCKET).remove([photoPath]);
        await supabaseAdmin.auth.admin.deleteUser(userId);
    };

    // 2. Upload the profile photo, if one was given.
    let photoPath = null;
    let photoUrl = null;
    if (photo) {
        photoPath = `${userId}/profile.${EXT_BY_TYPE[photo.mimetype]}`;
        const { error: uploadError } = await supabaseAdmin.storage
            .from(PHOTO_BUCKET)
            .upload(photoPath, photo.buffer, { contentType: photo.mimetype, upsert: true });
        if (uploadError) {
            await rollback();
            console.error('Photo upload failed:', uploadError.message);
            return res.status(500).json({ message: 'Could not upload profile photo. Please try again.' });
        }
        photoUrl = supabaseAdmin.storage.from(PHOTO_BUCKET).getPublicUrl(photoPath).data.publicUrl;
    }

    // 3. Save the profile row.
    const { data: profile, error: dbError } = await supabaseAdmin
        .from('profiles')
        .insert({
            id: userId,
            name: body.name,
            email: body.email,
            phone: body.phone,
            phase: body.phase,
            villa_no: body.villaNo,
            photo_url: photoUrl,
        })
        .select()
        .single();
    if (dbError) {
        await rollback(photoPath);
        console.error('Profile insert failed:', dbError.message);
        return res.status(500).json({ message: 'Could not save your details. Please try again.' });
    }

    res.status(201).json({ message: 'Registration successful. You can now log in.', user: profile });
});

// POST /api/auth/login  { phone, password } - "phone" may also be an email address.
router.post('/login', async (req, res) => {
    const identifier = req.body?.phone?.trim();
    const password = req.body?.password;
    if (!identifier || !password) {
        return res.status(400).json({ message: 'Mobile number and password are required.' });
    }

    // Find the email Supabase Auth knows this user by.
    let loginEmail;
    if (identifier.includes('@')) {
        loginEmail = identifier.toLowerCase();
    } else {
        const phone = normalizePhone(identifier);
        const { data: prof } = await supabaseAdmin.from('profiles').select('email').eq('phone', phone).maybeSingle();
        loginEmail = prof?.email || placeholderEmail(phone);
    }

    const { data, error } = await createAuthClient().auth.signInWithPassword({ email: loginEmail, password });
    if (error) {
        return res.status(401).json({ message: 'Invalid mobile number or password.' });
    }

    const { data: profile, error: dbError } = await supabaseAdmin
        .from('profiles')
        .select()
        .eq('id', data.user.id)
        .single();
    if (dbError) {
        console.error('Profile lookup failed:', dbError.message);
        return res.status(500).json({ message: 'Could not load your profile. Please try again.' });
    }

    res.json({
        token: data.session.access_token,
        refreshToken: data.session.refresh_token,
        user: profile,
    });
});

// POST /api/auth/refresh  { refreshToken } -> new token pair (access tokens expire after ~1 hour)
router.post('/refresh', async (req, res) => {
    const refreshToken = req.body?.refreshToken;
    if (!refreshToken) return res.status(400).json({ message: 'Refresh token is required.' });

    const { data, error } = await createAuthClient().auth.refreshSession({ refresh_token: refreshToken });
    if (error || !data.session) {
        return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }
    res.json({ token: data.session.access_token, refreshToken: data.session.refresh_token });
});

module.exports = router;






