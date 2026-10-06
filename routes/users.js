const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/users - every registered user except the caller, newest first. Volunteers only.
router.get('/', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, email, phone, phase, villa_no, photo_url, role, created_at')
        .neq('id', req.profile.id)
        .order('created_at', { ascending: false });
    if (error) {
        console.error('User list failed:', error.message);
        return res.status(500).json({ message: 'Could not load users.' });
    }
    res.json({ users: data });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/users/:id - removes the login, profile and photo. Volunteers only;
// volunteers cannot be deleted (demote them to member in Supabase first).
router.delete('/:id', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid user id.' });
    if (id === req.profile.id) return res.status(400).json({ message: 'You cannot delete your own account.' });

    const { data: target } = await supabaseAdmin.from('profiles').select('id, role').eq('id', id).maybeSingle();
    if (!target) return res.status(404).json({ message: 'User not found.' });
    if (target.role === 'volunteer') return res.status(403).json({ message: 'Volunteers cannot be deleted.' });

    // Photos live under "<user id>/" in the avatars bucket.
    const { data: files } = await supabaseAdmin.storage.from('avatars').list(id);
    if (files?.length) {
        await supabaseAdmin.storage.from('avatars').remove(files.map((f) => `${id}/${f.name}`));
    }

    // Deleting the auth user also deletes the profile row (on delete cascade).
    const { error } = await supabaseAdmin.auth.admin.deleteUser(id);
    if (error) {
        console.error('User delete failed:', error.message);
        return res.status(500).json({ message: 'Could not delete user. Please try again.' });
    }
    res.json({ message: 'User deleted.' });
});

module.exports = router;
