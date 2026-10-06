const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !secretKey || !publishableKey) {
    throw new Error('SUPABASE_URL, SUPABASE_SECRET_KEY and SUPABASE_PUBLISHABLE_KEY must be set in .env');
}

const noSession = { auth: { persistSession: false, autoRefreshToken: false } };

// Admin client: bypasses RLS. Server-side only.
const supabaseAdmin = createClient(supabaseUrl, secretKey, noSession);

// Fresh client per login so user sessions never leak between requests.
const createAuthClient = () => createClient(supabaseUrl, publishableKey, noSession);

module.exports = { supabaseUrl, supabaseAdmin, createAuthClient };
