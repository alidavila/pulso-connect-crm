// api/projects.js — CRUD completo para tabla projects del CRM
// GET    /api/projects             — listar (filtros: ?status=X, ?search=texto)
// POST   /api/projects             — crear (body JSON)
// PATCH  /api/projects?id=UUID     — actualizar (body JSON)
// DELETE /api/projects?id=UUID     — eliminar
// Auth: Bearer token o ?secret= query param (CRON_SECRET)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── Auth ──────────────────────────────────────────────
  const secret =
    req.query.secret ||
    (req.headers.authorization || '').replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Credentials ───────────────────────────────────────
  const url = process.env.PULSOCONNECT_SUPABASE_URL;
  const key = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Missing PULSOCONNECT_SUPABASE_* credentials' });
  }

  const base = `${url}/rest/v1/projects`;

  function supabaseHeaders(withRepresentation = true) {
    const h = {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json'
    };
    if (withRepresentation) h['Prefer'] = 'return=representation';
    return h;
  }

  try {
    const method = (req.method || 'GET').toUpperCase();

    // ── GET ─────────────────────────────────────────────
    if (method === 'GET') {
      // GET ignora Prefer: return=representation, así que es seguro enviarlo
      let query = 'select=*&order=created_at.desc';

      // Filtro por status
      if (req.query.status) {
        query += `&status=eq.${encodeURIComponent(req.query.status)}`;
      }

      // Búsqueda por texto (label, description, type)
      if (req.query.search) {
        const term = encodeURIComponent(req.query.search);
        query += `&or=(label.ilike.*${term}*,description.ilike.*${term}*,type.ilike.*${term}*)`;
      }

      const resp = await fetch(`${base}?${query}`, { headers: supabaseHeaders(false) });
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(resp.status).json({ error: 'Supabase query failed', details: err });
      }
      const data = await resp.json();
      return res.json(data);
    }

    // ── POST ────────────────────────────────────────────
    if (method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || !body.label) {
        return res.status(400).json({ error: 'Missing required field: label' });
      }

      // Sanitize: solo campos que pertenecen a la tabla
      const allowed = [
        'project_category_id', 'label', 'description', 'type',
        'status', 'progress', 'budget_total', 'budget_spent', 'team'
      ];
      const payload = {};
      for (const field of allowed) {
        if (body[field] !== undefined) payload[field] = body[field];
      }

      // Valores por defecto
      if (!payload.status) payload.status = 'active';
      if (payload.progress === undefined) payload.progress = 0;
      if (payload.budget_total === undefined) payload.budget_total = 0;
      if (payload.budget_spent === undefined) payload.budget_spent = 0;
      if (payload.team === undefined) payload.team = [];

      const resp = await fetch(base, {
        method: 'POST',
        headers: supabaseHeaders(true),
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(resp.status).json({ error: 'Supabase insert failed', details: err });
      }
      const data = await resp.json();
      return res.status(201).json(Array.isArray(data) ? data[0] : data);
    }

    // ── PATCH ───────────────────────────────────────────
    if (method === 'PATCH') {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ error: 'Missing ?id=UUID parameter' });
      }

      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!body || Object.keys(body).length === 0) {
        return res.status(400).json({ error: 'Missing body — nothing to update' });
      }

      // Sanitize
      const allowed = [
        'project_category_id', 'label', 'description', 'type',
        'status', 'progress', 'budget_total', 'budget_spent', 'team'
      ];
      const payload = {};
      for (const field of allowed) {
        if (body[field] !== undefined) payload[field] = body[field];
      }

      // Siempre actualizar updated_at (Supabase trigger puede hacerlo, pero aseguramos)
      payload.updated_at = new Date().toISOString();

      const resp = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: supabaseHeaders(true),
        body: JSON.stringify(payload)
      });
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(resp.status).json({ error: 'Supabase update failed', details: err });
      }
      const data = await resp.json();
      return res.json(Array.isArray(data) ? data[0] : data);
    }

    // ── DELETE ──────────────────────────────────────────
    if (method === 'DELETE') {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ error: 'Missing ?id=UUID parameter' });
      }

      const resp = await fetch(`${base}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: supabaseHeaders(false)
      });
      if (!resp.ok) {
        const err = await resp.text();
        return res.status(resp.status).json({ error: 'Supabase delete failed', details: err });
      }
      // DELETE sin Prefer: return=representation devuelve 204 No Content o array vacío
      const data = resp.status === 204 ? null : await resp.json().catch(() => null);
      return res.json({ success: true, id, deleted: data });
    }

    // ── Método no soportado ─────────────────────────────
    return res.status(405).json({ error: `Method ${method} not allowed` });

  } catch (e) {
    return res.status(500).json({ error: 'Internal server error', details: e.message });
  }
}
