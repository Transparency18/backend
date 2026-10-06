const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// GET /api/users - every registered user, newest first. Volunteers only.
router.get('/', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { data, error } = await supabaseAdmin
        .from('profiles')
        .select('id, name, email, phone, phase, villa_no, photo_url, role, created_at')
        .order('created_at', { ascending: false });
    if (error) {
        console.error('User list failed:', error.message);
        return res.status(500).json({ message: 'Could not load users.' });
    }
    res.json({ users: data });
});

module.exports = router;
