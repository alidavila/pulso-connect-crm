// api/alertas.js — Sistema de alertas: leads sin seguimiento, sistemas
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = process.env.PULSOCONNECT_SUPABASE_URL;
    const key = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Missing credentials' });

    const ref = url.match(/https:\/\/([^.]+)/)?.[1];
    if (!ref) return res.status(500).json({ error: 'Bad URL' });

    let pg;
    try { pg = await import('pg'); } catch (e) {
        // Fallback: REST-based alert checks
        const alerts = [];

        // Check leads without follow-up
        try {
            const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
            const leadsRes = await fetch(
                `${url}/rest/v1/leads?select=id,name,company,status,updated_at&status=not.in.(cerrado_ganado,cerrado_perdido)&updated_at=lt.${threeDaysAgo}&limit=10`,
                { headers: { apikey: key, Authorization: `Bearer ${key}` } }
            );
            if (leadsRes.ok) {
                const staleLeads = await leadsRes.json();
                staleLeads.forEach(l => {
                    alerts.push({
                        type: 'lead_stale',
                        icon: '⏰',
                        msg: `${l.name} (${l.company || '—'}) — sin seguimiento ${Math.floor((Date.now() - new Date(l.updated_at)) / 86400000)}d`,
                        link: '#',
                        severity: 'warn'
                    });
                });
            }
        } catch (e) {}

        // System checks
        const systems = [
            { name: 'AgentLink', url: 'https://afospshladroetawktst.supabase.co' },
            { name: 'Matarife', url: 'https://yqnjlbvyeyuwugnltxmg.supabase.co' },
            { name: 'Veritas', url: 'https://rdoccjqvkmvobmqrvisy.supabase.co' },
            { name: 'Salenis', url: 'https://salenis.com' },
            { name: 'Matarife App', url: 'https://matarife.app' }
        ];

        for (const sys of systems) {
            try {
                const r = await fetch(sys.url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
                if (!r.ok) alerts.push({ type: 'system_down', icon: '🔴', msg: `${sys.name} — HTTP ${r.status}`, severity: 'error' });
            } catch (e) {
                alerts.push({ type: 'system_down', icon: '🔴', msg: `${sys.name} — no responde`, severity: 'error' });
            }
        }

        return res.json({ alerts, total: alerts.length, errors: alerts.filter(a => a.severity === 'error').length });
    }

    // PostgreSQL mode
    const { Pool } = pg.default;
    const pool = new Pool({
        host: `${ref}.pooler.supabase.com`, port: 6543,
        user: `postgres.${ref}`, password: key, database: 'postgres',
        ssl: { rejectUnauthorized: false }
    });

    try {
        const alerts = [];
        const client = await pool.connect();

        // Stale leads
        const { rows: stale } = await client.query(
            `SELECT id, name, company, status, updated_at FROM leads 
             WHERE status NOT IN ('cerrado_ganado','cerrado_perdido') 
             AND updated_at < now() - interval '3 days' LIMIT 10`
        );
        stale.forEach(l => {
            const days = Math.floor((Date.now() - new Date(l.updated_at)) / 86400000);
            alerts.push({ type: 'lead_stale', icon: '⏰', msg: `${l.name} (${l.company || '—'}) — sin seguimiento ${days}d`, severity: 'warn' });
        });

        client.release();
        await pool.end();

        return res.json({ alerts, total: alerts.length, errors: 0 });
    } catch (e) {
        await pool.end().catch(() => {});
        return res.status(500).json({ error: e.message });
    }
}
