require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { supabaseUrl } = require('./lib/supabase');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');

const app = express();
// Frontends allowed to call this API: CORS_ORIGINS (comma-separated) overrides the default.
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,https://transparency-lyart.vercel.app')
    .split(',')
    .map((origin) => origin.trim().replace(/[/]+$/, ''))
    .filter(Boolean);
app.use(cors({ origin: allowedOrigins }));
app.use(express.json());

app.get('/', (req, res) => {
  res.send('Welcome to the Transparency Backend API! Go to /api/health to check the status.');
});

app.get('/api/health', async (req, res) => {
    try {
        const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
            headers: { apikey: process.env.SUPABASE_PUBLISHABLE_KEY },
            signal: AbortSignal.timeout(5000)
        });
        if (!response.ok) {
            throw new Error(`Supabase responded with status ${response.status}`);
        }
        res.status(200).json({
            status: 'ok',
            message: 'Server is healthy and Supabase is reachable!',
            supabaseUrl: supabaseUrl
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            message: 'Server is running, but failed to reach Supabase API.',
            error: error.message
        });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);

// Return JSON instead of an HTML stack trace for unexpected errors.
app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ message: err.expose ? err.message : 'Internal server error.' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

