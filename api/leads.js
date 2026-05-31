// api/leads.js — CRUD para leads + creación de tabla
// GET /api/leads — listar
// POST /api/leads — crear
// PATCH /api/leads — actualizar
// DELETE /api/leads — eliminar

const TABLE_SQL = `
CREATE TABLE IF NOT EXISTS leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    source TEXT DEFAULT 'web',
    service_interest UUID REFERENCES services(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'nuevo',
    value NUMERIC DEFAULT 0,
    notes TEXT,
    next_followup TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_leads ON leads;
CREATE POLICY service_role_all_leads ON leads FOR ALL USING (true) WITH CHECK (true);
`;

async function ensureTable(pool) {
    const client = await pool.connect();
    try {
        await client.query(TABLE_SQL);
        return true;
    } catch (e) {
        console.error('Table creation error:', e.message);
        return false;
    } finally {
        client.release();
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = process.env.PULSOCONNECT_SUPABASE_URL;
    const key = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Missing credentials' });

    const ref = url.match(/https:\/\/([^.]+)/)?.[1];
    if (!ref) return res.status(500).json({ error: 'Bad URL' });

    // Connect to PostgreSQL pooler
    let pg;
    try { pg = await import('pg'); } catch (e) {
        // Fallback: REST API (read-only for GET)
        if (req.method === 'GET') {
            try {
                const qs = req.url.includes('?') ? req.url.split('?')[1] : '';
                const apiUrl = `${url}/rest/v1/leads?${qs}`;
                const r = await fetch(apiUrl, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
                const data = await r.json();
                return res.json(data);
            } catch (e2) {
                return res.status(500).json({ error: e2.message });
            }
        }
        return res.status(500).json({ error: 'pg module not available for write operations' });
    }

    const { Pool } = pg.default;
    const pool = new Pool({
        host: `${ref}.pooler.supabase.com`, port: 6543,
        user: `postgres.${ref}`, password: key, database: 'postgres',
        ssl: { rejectUnauthorized: false }
    });

    try {
        await ensureTable(pool);

        if (req.method === 'GET') {
            const client = await pool.connect();
            const result = await client.query('SELECT * FROM leads ORDER BY created_at DESC');
            client.release();
            return res.json(result.rows);
        }

        if (req.method === 'POST') {
            const { name, email, phone, company, source, service_interest, status, value, notes } = req.body || {};
            const client = await pool.connect();
            const result = await client.query(
                `INSERT INTO leads (name, email, phone, company, source, service_interest, status, value, notes)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [name, email, phone, company, source || 'web', service_interest, status || 'nuevo', value || 0, notes]
            );
            client.release();
            return res.status(201).json(result.rows[0]);
        }

        if (req.method === 'PATCH') {
            const { id, ...fields } = req.body || {};
            if (!id) return res.status(400).json({ error: 'id required' });
            const client = await pool.connect();
            const sets = [];
            const vals = [];
            let i = 1;
            for (const [k, v] of Object.entries(fields)) {
                if (v !== undefined) {
                    sets.push(`${k} = $${i++}`);
                    vals.push(v);
                }
            }
            sets.push(`updated_at = now()`);
            vals.push(id);
            const result = await client.query(
                `UPDATE leads SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals
            );
            client.release();
            if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
            return res.json(result.rows[0]);
        }

        if (req.method === 'DELETE') {
            const id = req.query.id || (req.body || {}).id;
            if (!id) return res.status(400).json({ error: 'id required' });
            const client = await pool.connect();
            await client.query('DELETE FROM leads WHERE id = $1', [id]);
            client.release();
            return res.json({ deleted: true });
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (e) {
        await pool.end().catch(() => {});
        return res.status(500).json({ error: e.message });
    }
}
