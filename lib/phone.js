// One canonical form per number so "+91 98765-43210" and "9876543210" match:
// strip spaces, dashes and brackets, then drop an Indian +91 / 91 prefix.
function normalizePhone(value) {
    if (!value) return '';
    const compact = String(value).replace(/[\s()-]/g, '');
    const indian = compact.match(/^\+?91(\d{10})$/);
    return indian ? indian[1] : compact;
}

// Supabase Auth needs an email; users who register without one get this placeholder.
const placeholderEmail = (phone) => `${phone}@resident.app`;

module.exports = { normalizePhone, placeholderEmail };
