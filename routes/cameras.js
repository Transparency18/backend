const express = require('express');
const { supabaseAdmin } = require('../lib/supabase');
const { PHASES } = require('../lib/phases');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

const TYPES = ['Bullet', 'Dome', 'PTZ', 'Other'];
const STATUSES = ['Working', 'Not Working', 'Under Maintenance'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const today = () => new Date().toISOString().slice(0, 10);

// Reads and validates camera details from the request body.
// partial: only check fields that were sent (for edits).
function readCameraDetails(input, partial) {
    const fields = {};
    const errors = {};
    const sent = (key) => !partial || input[key] !== undefined;

    if (sent('name')) {
        fields.name = String(input.name ?? '').trim();
        if (fields.name.length < 2 || fields.name.length > 100) errors.name = 'Enter a camera name (2-100 characters).';
    }
    if (sent('phase')) {
        fields.phase = input.phase;
        if (!PHASES.includes(fields.phase)) errors.phase = 'Select a phase.';
    }
    if (sent('location')) {
        fields.location = String(input.location ?? '').trim();
        if (!fields.location) errors.location = 'Enter where the camera is mounted.';
        else if (fields.location.length > 200) errors.location = 'Keep the location under 200 characters.';
    }
    if (sent('type')) {
        fields.type = input.type || 'Bullet';
        if (!TYPES.includes(fields.type)) errors.type = 'Select a camera type.';
    }
    if (sent('last_maintenance')) {
        fields.last_maintenance = input.last_maintenance || null;
        const date = fields.last_maintenance;
        if (date && (!DATE_RE.test(date) || Number.isNaN(Date.parse(date)))) errors.last_maintenance = 'Enter a valid date.';
        else if (date && date > today()) errors.last_maintenance = 'Date cannot be in the future.';
    }
    if (sent('notes')) {
        fields.notes = String(input.notes ?? '').trim() || null;
        if (fields.notes?.length > 1000) errors.notes = 'Keep notes under 1000 characters.';
    }
    return { fields, errors };
}

const readNote = (note) => String(note ?? '').trim() || null;

async function logStatus(cameraId, status, note, profile) {
    const { error } = await supabaseAdmin.from('camera_status_log').insert({
        camera_id: cameraId,
        status,
        note,
        changed_by: profile.id,
        changed_by_name: profile.name,
        changed_by_role: profile.role,
    });
    if (error) console.error('Camera status log failed:', error.message);
}

// Members only see cameras in their own phase (none if their profile has no valid phase).
const memberPhase = (profile) => (profile.role === 'member' ? (PHASES.includes(profile.phase) ? profile.phase : '') : null);

// GET /api/cameras - members see their phase's cameras; guards and volunteers see all.
// Only volunteers can change cameras.
router.get('/', requireAuth, async (req, res) => {
    let query = supabaseAdmin.from('cameras').select('*').order('camera_no', { ascending: true });
    const phase = memberPhase(req.profile);
    if (phase !== null) query = query.eq('phase', phase);

    const { data, error } = await query;
    if (error) {
        console.error('Camera list failed:', error.message);
        return res.status(500).json({ message: 'Could not load cameras.' });
    }
    res.json({ cameras: data });
});

// GET /api/cameras/:id/history - status changes, newest first. Members: cameras in their phase only.
router.get('/:id/history', requireAuth, async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid camera id.' });

    const phase = memberPhase(req.profile);
    if (phase !== null) {
        const { data: camera } = await supabaseAdmin.from('cameras').select('phase').eq('id', id).maybeSingle();
        if (!camera || camera.phase !== phase) return res.status(404).json({ message: 'Camera not found.' });
    }

    const { data, error } = await supabaseAdmin
        .from('camera_status_log')
        .select('id, status, note, changed_by_name, changed_by_role, created_at')
        .eq('camera_id', id)
        .order('created_at', { ascending: false })
        .limit(50);
    if (error) {
        console.error('Camera history failed:', error.message);
        return res.status(500).json({ message: 'Could not load camera history.' });
    }
    res.json({ history: data });
});

// POST /api/cameras  { name, phase, location, type?, status?, last_maintenance?, notes? } - volunteers.
router.post('/', requireAuth, requireRole('volunteer'), async (req, res) => {
    const input = req.body || {};
    const { fields, errors } = readCameraDetails(input, false);
    const status = input.status || 'Working';
    if (!STATUSES.includes(status)) errors.status = 'Select a status.';
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors });

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
        .from('cameras')
        .insert({
            ...fields,
            status,
            status_note: 'Camera added',
            status_updated_by_name: `${req.profile.name} (Volunteer)`,
            status_updated_at: now,
            created_by: req.profile.id,
        })
        .select()
        .single();
    if (error) {
        console.error('Camera create failed:', error.message);
        return res.status(500).json({ message: 'Could not add camera. Please try again.' });
    }
    await logStatus(data.id, status, 'Camera added', req.profile);
    res.status(201).json({ message: 'Camera added.', camera: data });
});

// PATCH /api/cameras/:id  { name?, phase?, location?, type?, last_maintenance?, notes? } - volunteers.
// Status is changed through POST /:id/status so every change is logged.
router.patch('/:id', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid camera id.' });

    const { fields, errors } = readCameraDetails(req.body || {}, true);
    if (Object.keys(errors).length) return res.status(400).json({ message: 'Please fix the highlighted fields.', errors });
    if (!Object.keys(fields).length) return res.status(400).json({ message: 'Nothing to update.' });
    fields.updated_at = new Date().toISOString();

    const { data, error } = await supabaseAdmin.from('cameras').update(fields).eq('id', id).select().maybeSingle();
    if (error) {
        console.error('Camera update failed:', error.message);
        return res.status(500).json({ message: 'Could not update camera. Please try again.' });
    }
    if (!data) return res.status(404).json({ message: 'Camera not found.' });
    res.json({ message: 'Camera updated.', camera: data });
});

// POST /api/cameras/:id/status  { status, note? } - volunteers.
// Moving back to Working counts as maintenance done today.
router.post('/:id/status', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid camera id.' });

    const { status } = req.body || {};
    const note = readNote(req.body?.note);
    if (!STATUSES.includes(status)) return res.status(400).json({ message: 'Select a valid status.' });
    if (note?.length > 500) return res.status(400).json({ message: 'Keep the note under 500 characters.' });

    const { data: current, error: findError } = await supabaseAdmin.from('cameras').select('status').eq('id', id).maybeSingle();
    if (findError) {
        console.error('Camera lookup failed:', findError.message);
        return res.status(500).json({ message: 'Could not update camera. Please try again.' });
    }
    if (!current) return res.status(404).json({ message: 'Camera not found.' });
    if (current.status === status && !note) return res.status(400).json({ message: `Camera is already "${status}". Add a note to log an update.` });

    const now = new Date().toISOString();
    const changes = {
        status,
        status_note: note,
        status_updated_by_name: `${req.profile.name} (Volunteer)`,
        status_updated_at: now,
        updated_at: now,
    };
    if (status === 'Working' && current.status !== 'Working') changes.last_maintenance = today();

    const { data, error } = await supabaseAdmin.from('cameras').update(changes).eq('id', id).select().maybeSingle();
    if (error) {
        console.error('Camera status update failed:', error.message);
        return res.status(500).json({ message: 'Could not update camera. Please try again.' });
    }
    if (!data) return res.status(404).json({ message: 'Camera not found.' });
    await logStatus(id, status, note, req.profile);
    res.json({ message: 'Camera status updated.', camera: data });
});

// DELETE /api/cameras/:id - volunteers only. Its status history is removed with it.
router.delete('/:id', requireAuth, requireRole('volunteer'), async (req, res) => {
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ message: 'Invalid camera id.' });

    const { data, error } = await supabaseAdmin.from('cameras').delete().eq('id', id).select('id').maybeSingle();
    if (error) {
        console.error('Camera delete failed:', error.message);
        return res.status(500).json({ message: 'Could not delete camera. Please try again.' });
    }
    if (!data) return res.status(404).json({ message: 'Camera not found.' });
    res.json({ message: 'Camera deleted.' });
});

module.exports = { router, TYPES, STATUSES };
