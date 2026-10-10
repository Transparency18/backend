// Creates the database table and storage bucket from supabase/schema.sql.
// Usage: npm run db:setup   (safe to run more than once)
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        console.error('DATABASE_URL is missing in .env.');
        console.error('Get it from Supabase: Connect (top bar) -> Connection string -> URI, with your DB password filled in.');
        process.exit(1);
    }

    const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'schema.sql'), 'utf8');
    const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });

    await client.connect();
    try {
        await client.query(sql);
        // Make the Supabase API see the new table immediately.
        await client.query("notify pgrst, 'reload schema'");
        console.log('Database setup complete: tables and avatars bucket are ready.');
    } finally {
        await client.end();
    }
}

main().catch((err) => {
    console.error('Database setup failed:', err.message);
    process.exit(1);
});
