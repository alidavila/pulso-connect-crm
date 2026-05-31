// api/conversaciones.js — Listar y buscar conversaciones
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const url = process.env.PULSOCONNECT_SUPABASE_URL;
    const key = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
    if (!url || !key) return res.status(500).json({ error: 'Missing credentials' });

    const params = new URLSearchParams(req.url.split('?')[1] || '');
    const search = params.get('q') || '';
    const limit = parseInt(params.get('limit') || '30');
    const offset = parseInt(params.get('offset') || '0');

    let qs = `select=id,user_id,mensaje_original,respuesta_ia,timestamp,es_error&order=timestamp.desc&limit=${limit}&offset=${offset}`;
    if (search) {
        qs += `&or=(mensaje_original.ilike.*${encodeURIComponent(search)}*,respuesta_ia.ilike.*${encodeURIComponent(search)}*)`;
    }

    try {
        const r = await fetch(`${url}/rest/v1/conversaciones?${qs}`, {
            headers: { apikey: key, Authorization: `Bearer ${key}` }
        });
        const data = await r.json();
        const count = r.headers.get('content-range')?.split('/')[1] || data.length;
        res.json({ data, total: parseInt(count) || 0 });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
