const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { PHASES } = require('../lib/phases');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

const CATEGORIES = [
    'Suspicious Activity', 'Trespassing', 'Theft', 'Vandalism', 'Noise / Disturbance',
    'Infrastructure Damage', 'Street Light', 'CCTV / Camera Fault', 'Water / Drainage', 'Garbage', 'Other',
];
const PRIORITIES = ['Low', 'Medium', 'High'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status changes each role may make.
const STATUS_BY_ROLE = {
    guard: ['Open', 'In Progress', 'Resolved'],
    volunteer: ['Open', 'In Progress', 'Resolved', 'Closed'],
};

// GET /api/complaints - members see all complaints in their phase (plus their own);
// guards and volunteers see all. Newest first.
router.get('/', requireAuth, async (req, res) => {
    let query = supabaseAdmin.from('complaints').select('*').order('created_at', { ascending: false });
    if (req.profile.role === 'member') {
        const { id, phase } = req.profile;
        query = PHASES.includes(phase)
            ? query.or(`phase.eq.${phase},reported_by.eq.${id}`)
            : query.eq('reported_by', id);
    }

    const { data, error } = await query;
    if (error) {
        console.error('Complaint list failed:', error.message);
        return res.status(500).json({ message: 'Could not load complaints.' });
    }
    res.json({ complaints: data });
});

// POST /api/complaints  { category, description, location?, phase?, priority? } - any logged-in user.
router.post('/', requireAuth, async (req, res) => {
    const input = req.body || {};
    const complaint = {
        category: input.category,
        description: input.description?.trim(),
        location: input.location?.trim() || null,
        // Members report for their own phase; staff pick the phase.
        phase: req.profile.role === 'member' && req.profile.phase ? req.profile.phase : input.phase,
        priority: input.priority || 'Medium',
    };

    const errors = {};
    if (!CATEGORIES.includes(complaint.category)) errors.category = 'Select a category.';
    if (!complaint.description || complaint.description.length < 5) errors.description = 'Describe the issue (at least 5 characters).';
    if (complaint.description?.length > 2000) errors.description = 'Keep the description under 2000 characters.';
    if (complaint.location?.length > 200) errors.location = 'Keep the location under 200 characters.';
    if (!PHASES.includes(complaint.phase)) errors.phase = 'Select a phase.';
    if (!PRIORITIES.includes(complaint.priority)) errors.priority = 'Select a priority.';
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors });

    const { data, error } = await supabaseAdmin
        .from('complaints')
        .insert({
            ...complaint,
            reported_by: req.profile.id,
            reporter_name: req.profile.name,
            reporter_role: req.profile.role,
            reporter_villa: req.profile.villa_no,
        })
        .select()
        .single();
    if (error) {
        console.error('Complaint create failed:', error.message);
        return res.status(500).json({ message: 'Could not submit complaint. Please try again.' });
    }
    res.status(201).json({ message: 'Complaint submitted.', complaint: data });
});

// PATCH /api/complaints/:id  { status?, reply?, priority? } - guards and volunteers.
// Guards: Open / In Progress / Resolved and reply. Volunteers: also Closed and priority.
router.patch('/:id', requireAuth, requireRole('guard', 'volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid complaint id.' });

    const { status, reply, priority } = req.body || {};
    const role = req.profile.role;
    const changes = {};

    if (status !== undefined) {
        if (!STATUS_BY_ROLE[role].includes(status)) {
            return res.status(403).json({ message: `You cannot set the status to "${status}".` });
        }
        changes.status = status;
        changes.resolved_at = status === 'Resolved' || status === 'Closed' ? new Date().toISOString() : null;
    }
    if (reply !== undefined) {
        const text = String(reply).trim();
        if (text.length > 2000) return res.status(400).json({ message: 'Keep the reply under 2000 characters.' });
        changes.reply = text || null;
        changes.replied_by_name = text ? `${req.profile.name} (${role === 'guard' ? 'Security Guard' : 'Volunteer'})` : null;
        changes.replied_at = text ? new Date().toISOString() : null;
    }
    if (priority !== undefined) {
        if (role !== 'volunteer') return res.status(403).json({ message: 'Only volunteers can change priority.' });
        if (!PRIORITIES.includes(priority)) return res.status(400).json({ message: 'Invalid priority.' });
        changes.priority = priority;
    }
    if (!Object.keys(changes).length) return res.status(400).json({ message: 'Nothing to update.' });
    changes.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin.from('complaints').update(changes).eq('id', id).select().maybeSingle();
    if (error) {
        console.error('Complaint update failed:', error.message);
        return res.status(500).json({ message: 'Could not update complaint. Please try again.' });
    }
    if (!data) return res.status(404).json({ message: 'Complaint not found.' });
    res.json({ message: 'Complaint updated.', complaint: data });
});

// DELETE /api/complaints/:id - volunteers only.
router.delete('/:id', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid complaint id.' });

    const { data, error } = await supabaseAdmin.from('complaints').delete().eq('id', id).select('id').maybeSingle();
    if (error) {
        console.error('Complaint delete failed:', error.message);
        return res.status(500).json({ message: 'Could not delete complaint. Please try again.' });
    }
    if (!data) return res.status(404).json({ message: 'Complaint not found.' });
    res.json({ message: 'Complaint deleted.' });
});

module.exports = { router, CATEGORIES };
