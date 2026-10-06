// Creates (or updates) the volunteer account defined by VOLUNTEER_* in .env.
// Usage: npm run db:seed-volunteer   (safe to run more than once)
require('dotenv').config({ quiet: true });
const { supabaseAdmin } = require('../lib/supabase');

async function findUserByEmail(email) {
    for (let page = 1; ; page++) {
        const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
        if (error) throw error;
        const match = data.users.find((u) => u.email === email);
        if (match || data.users.length < 1000) return match;
    }
}

async function main() {
    const email = process.env.VOLUNTEER_EMAIL?.trim().toLowerCase();
    const name = process.env.VOLUNTEER_NAME?.trim();
    const password = process.env.VOLUNTEER_PASSWORD;
    if (!email || !name || !password) {
        throw new Error('Set VOLUNTEER_EMAIL, VOLUNTEER_NAME and VOLUNTEER_PASSWORD in .env');
    }

    let user = await findUserByEmail(email);
    if (user) {
        const { error } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password, email_confirm: true });
        if (error) throw error;
    } else {
        const { data, error } = await supabaseAdmin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error) throw error;
        user = data.user;
    }

    const { error } = await supabaseAdmin
        .from('profiles')
        .upsert({ id: user.id, email, name, role: 'volunteer' }, { onConflict: 'id' });
    if (error) throw error;

    console.log(`Volunteer ready: ${name} <${email}>`);
}

main().catch((err) => {
    console.error('Seeding volunteer failed:', err.message);
    process.exit(1);
});
