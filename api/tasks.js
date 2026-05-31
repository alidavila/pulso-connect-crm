// api/tasks.js — CRUD completo para la tabla tasks del CRM PulsoConnect
// GET    /api/tasks                          → listar todas
// GET    /api/tasks?project_id=UUID          → filtrar por proyecto
// GET    /api/tasks?status=completed|pending → filtrar por estado (is_completed)
// GET    /api/tasks?id=UUID                  → obtener una tarea específica
// POST   /api/tasks                          → crear tarea (body JSON)
// PATCH  /api/tasks?id=UUID                  → actualizar tarea (body JSON)
// DELETE /api/tasks?id=UUID                  → eliminar tarea
//
// Auth: ?secret=CRON_SECRET o header Authorization: Bearer <token>
// CORS: Access-Control-Allow-Origin: *

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // ── Auth ──────────────────────────────────────────────────────────
  const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET && secret !== process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Supabase config ───────────────────────────────────────────────
  const SUPABASE_URL = process.env.PULSOCONNECT_SUPABASE_URL;
  const SUPABASE_KEY = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Missing PULSOCONNECT_SUPABASE_* credentials' });
  }

  const BASE = `${SUPABASE_URL}/rest/v1/tasks`;
  const HEADERS = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    // ── GET: Listar / Obtener ───────────────────────────────────────
    if (req.method === 'GET') {
      // Si se pasa ?id=UUID, devolver una tarea específica
      if (req.query.id) {
        const url = `${BASE}?id=eq.${encodeURIComponent(req.query.id)}&limit=1`;
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) {
          const err = await r.text();
          return res.status(r.status).json({ error: 'Supabase GET by id failed', details: err });
        }
        const data = await r.json();
        if (!data || data.length === 0) {
          return res.status(404).json({ error: 'Task not found' });
        }
        return res.json(normalizeTask(data[0]));
      }

      // Construir query params para filtros
      const params = new URLSearchParams();
      params.set('select', '*');
      params.set('order', 'created_at.desc');

      // Filtro por project_id
      if (req.query.project_id) {
        params.set('project_id', `eq.${req.query.project_id}`);
      }

      // Filtro por status: completed → is_completed=true, pending → is_completed=false
      if (req.query.status === 'completed') {
        params.set('is_completed', 'eq.true');
      } else if (req.query.status === 'pending') {
        params.set('is_completed', 'eq.false');
      }

      // Límite opcional (default 100)
      const limit = parseInt(req.query.limit) || 100;
      params.set('limit', String(Math.min(limit, 1000)));

      const url = `${BASE}?${params.toString()}`;
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: 'Supabase GET failed', details: err });
      }
      const data = await r.json();
      return res.json(data.map(normalizeTask));
    }

    // ── POST: Crear ─────────────────────────────────────────────────
    if (req.method === 'POST') {
      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Request body is required (JSON)' });
      }

      // Mapear campos del body a columnas reales de la tabla
      const task = {
        name: body.title || body.name || 'Untitled task',
        description: body.description || null,
        is_completed: body.is_completed !== undefined ? body.is_completed
                      : (body.status === 'completed' ? true : false),
        assigned_to: body.assigned_to || null,
        project_id: body.project_id || null
      };

      // Limpiar campos undefined/null que no deben enviarse
      // (Supabase ignora nulls, pero mejor ser explícito)
      const r = await fetch(BASE, {
        method: 'POST',
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(task)
      });

      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: 'Supabase POST failed', details: err });
      }
      const created = await r.json();
      return res.status(201).json(normalizeTask(Array.isArray(created) ? created[0] : created));
    }

    // ── PATCH: Actualizar ───────────────────────────────────────────
    if (req.method === 'PATCH') {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ error: 'Query parameter ?id=UUID is required for PATCH' });
      }

      const body = req.body;
      if (!body || typeof body !== 'object') {
        return res.status(400).json({ error: 'Request body is required (JSON)' });
      }

      // Construir el objeto de actualización solo con campos permitidos
      const updates = {};

      if (body.title !== undefined || body.name !== undefined) {
        updates.name = body.title || body.name;
      }
      if (body.description !== undefined) {
        updates.description = body.description;
      }
      // Manejar status → is_completed
      if (body.status !== undefined) {
        updates.is_completed = body.status === 'completed';
      }
      if (body.is_completed !== undefined) {
        updates.is_completed = body.is_completed;
      }
      if (body.assigned_to !== undefined) {
        updates.assigned_to = body.assigned_to;
      }
      if (body.project_id !== undefined) {
        updates.project_id = body.project_id;
      }

      // updated_at se actualiza automáticamente si la tabla tiene trigger;
      // si no, lo seteamos manualmente
      updates.updated_at = new Date().toISOString();

      if (Object.keys(updates).length === 1 && updates.updated_at) {
        return res.status(400).json({ error: 'No valid fields to update' });
      }

      const r = await fetch(`${BASE}?id=eq.${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { ...HEADERS, 'Prefer': 'return=representation' },
        body: JSON.stringify(updates)
      });

      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: 'Supabase PATCH failed', details: err });
      }
      const updated = await r.json();
      if (!updated || updated.length === 0) {
        return res.status(404).json({ error: 'Task not found or no changes applied' });
      }
      return res.json(normalizeTask(Array.isArray(updated) ? updated[0] : updated));
    }

    // ── DELETE: Eliminar ────────────────────────────────────────────
    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) {
        return res.status(400).json({ error: 'Query parameter ?id=UUID is required for DELETE' });
      }

      const r = await fetch(`${BASE}?id=eq.${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...HEADERS, 'Prefer': 'return=representation' }
      });

      if (!r.ok) {
        const err = await r.text();
        return res.status(r.status).json({ error: 'Supabase DELETE failed', details: err });
      }
      const deleted = await r.json();
      if (!deleted || deleted.length === 0) {
        return res.status(404).json({ error: 'Task not found' });
      }
      return res.json({
        success: true,
        message: 'Task deleted',
        task: normalizeTask(Array.isArray(deleted) ? deleted[0] : deleted)
      });
    }

    // ── Método no soportado ─────────────────────────────────────────
    return res.status(405).json({ error: `Method ${req.method} not allowed` });

  } catch (e) {
    return res.status(500).json({ error: 'Internal server error', details: e.message });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────
function normalizeTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.name,
    name: row.name,
    description: row.description,
    status: row.is_completed ? 'completed' : 'pending',
    is_completed: row.is_completed,
    assigned_to: row.assigned_to,
    project_id: row.project_id,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}
