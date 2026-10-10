const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

const ROLES = ['member', 'volunteer', 'guard'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The main volunteer from .env (npm run db:seed-volunteer) can't be demoted or deleted.
const isOwner = (profile) =>
    !!process.env.VOLUNTEER_EMAIL && profile.email === process.env.VOLUNTEER_EMAIL.trim().toLowerCase();

// Loads the user targeted by :id, rejecting bad ids and the caller themselves.
async function loadTarget(req, res, action) {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return void res.status(400).json({ message: 'Invalid user id.' });
    if (id === req.profile.id) return void res.status(400).json({ message: `You cannot ${action} your own account.` });

    const { data: target } = await supabaseAdmin.from('profiles').select('id, email, role').eq('id', id).maybeSingle();
    if (!target) return void res.status(404).json({ message: 'User not found.' });
    if (isOwner(target)) return void res.status(403).json({ message: 'This is the main volunteer account and cannot be changed.' });
    return target;
}

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
    res.json({ users: data.map((u) => ({ ...u, locked: isOwner(u) })) });
});

// GET /api/users/guards - everyone with the guard role (Security Guards page). Any logged-in user;
// volunteers change roles and delete guards through the routes below.
router.get('/guards', requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, phone, phase, photo_url, created_at')
        .eq('role', 'guard')
        .order('name', { ascending: true });
    if (error) {
        console.error('Guard list failed:', error.message);
        return res.status(500).json({ message: 'Could not load security guards.' });
    }
    res.json({ guards: data });
});

// PATCH /api/users/:id/role  { role } - change a user's role. Volunteers only.
router.patch('/:id/role', requireAuth, requireRole('volunteer'), async (req, res) => {
    const role = req.body?.role;
    if (!ROLES.includes(role)) return res.status(400).json({ message: 'Role must be member, volunteer or guard.' });

    const target = await loadTarget(req, res, 'change the role of');
    if (!target) return;

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ role })
        .eq('id', target.id)
        .select('id, role')
        .single();
    if (error) {
        console.error('Role change failed:', error.message);
        return res.status(500).json({ message: 'Could not change role. Please try again.' });
    }
    res.json({ message: 'Role updated.', user: data });
});

// DELETE /api/users/:id - removes the login, profile and photo. Volunteers only;
// a volunteer must be changed to another role before they can be deleted.
router.delete('/:id', requireAuth, requireRole('volunteer'), async (req, res) => {
    const target = await loadTarget(req, res, 'delete');
    if (!target) return;
    if (target.role === 'volunteer') {
        return res.status(403).json({ message: 'Change this volunteer to another role before deleting them.' });
    }

    // Photos live under "<user id>/" in the avatars bucket.
    const { data: files } = await supabaseAdmin.storage.from('avatars').list(target.id);
    if (files?.length) {
        await supabaseAdmin.storage.from('avatars').remove(files.map((f) => `${target.id}/${f.name}`));
    }

    // Deleting the auth user also deletes the profile row (on delete cascade).
    const { error } = await supabaseAdmin.auth.admin.deleteUser(target.id);
    if (error) {
        console.error('User delete failed:', error.message);
        return res.status(500).json({ message: 'Could not delete user. Please try again.' });
    }
    res.json({ message: 'User deleted.' });
});

module.exports = router;
