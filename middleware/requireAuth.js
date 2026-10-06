const { supabaseAdmin } = require('../lib/supabase');

// Checks the "Authorization: Bearer <token>" header and loads the caller's profile into req.profile.
async function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ message: 'Please log in.' });

    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ message: 'Session expired. Please log in again.' });

    const { data: profile } = await supabaseAdmin.from('profiles').select().eq('id', data.user.id).single();
    if (!profile) return res.status(401).json({ message: 'Account not found.' });

    req.profile = profile;
    next();
}

// Use after requireAuth: requireRole('volunteer')
const requireRole = (...roles) => (req, res, next) => {
    if (!roles.includes(req.profile.role)) {
        return res.status(403).json({ message: 'You do not have permission to do this.' });
    }
    next();
};

module.exports = { requireAuth, requireRole };
