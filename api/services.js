// api/services.js — CRUD completo para la tabla services del CRM
// Desplegable como serverless function en Vercel (Node 18+, fetch nativo)
//
// GET    /api/services                          → listar todos
// GET    /api/services?search=texto             → filtrar por label/description
// GET    /api/services?categoria=X              → filtrar por categoria exacta
// GET    /api/services?search=X&categoria=Y     → ambos filtros combinados
// POST   /api/services                          → crear (body JSON)
// PATCH  /api/services?id=<UUID>                → actualizar (body JSON)
// DELETE /api/services?id=<UUID>                → eliminar

const SUPABASE_URL = process.env.PULSOCONNECT_SUPABASE_URL;
const SUPABASE_KEY = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;

// Columnas que el cliente puede escribir (create / update)
const WRITABLE_COLUMNS = [
  'label',
  'description',
  'categoria',
  'problema_resuelve',
  'solucion_propuesta',
  'proceso_asociado',
  'precio_sugerido',
  'tiempo_estimado',
  'activo',
  'imagen_icono',
  'pain_point',
  'target_audience',
  'result',
  'status'
];

/**
 * Verifica autenticación: Bearer token o ?secret=
 */
function isAuthorized(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const secret = req.query?.secret || '';
  return token === process.env.CRON_SECRET || secret === process.env.CRON_SECRET;
}

/**
 * Filtra el body dejando solo las columnas que existen en la tabla.
 */
function sanitizeBody(body) {
  const out = {};
  for (const col of WRITABLE_COLUMNS) {
    if (body[col] !== undefined) {
      out[col] = body[col];
    }
  }
  return out;
}

/**
 * Construye query string de filtros para Supabase REST API.
 */
function buildFilters(query) {
  const filters = [];
  const { search, categoria } = query || {};

  if (search && search.trim()) {
    const s = encodeURIComponent(`*${search.trim()}*`);
    filters.push(`or=(label.ilike.${s},description.ilike.${s})`);
  }

  if (categoria && categoria.trim()) {
    filters.push(`categoria=eq.${encodeURIComponent(categoria.trim())}`);
  }

  return filters.length ? `&${filters.join('&')}` : '';
}

/**
 * Maneja CORS preflight (OPTIONS).
 */
function handleOptions(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.status(204).end();
}

export default async function handler(req, res) {
  // --- CORS -----------------------------------------------------------------
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'OPTIONS') {
    return handleOptions(res);
  }

  // --- Validación de credenciales -------------------------------------------
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).json({ error: 'Server misconfiguration: missing PULSOCONNECT_SUPABASE_* env vars' });
  }

  // --- Endpoint público opcional: GET sin auth si CRON_SECRET no está definido
  //     En producción CRON_SECRET siempre debe estar definido.
  if (process.env.CRON_SECRET && !isAuthorized(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // --- Ruteo por método HTTP ------------------------------------------------
  try {
    switch (req.method) {
      case 'GET':
        return await listServices(req, res);
      case 'POST':
        return await createService(req, res);
      case 'PATCH':
        return await updateService(req, res);
      case 'DELETE':
        return await deleteService(req, res);
      default:
        return res.status(405).json({ error: 'Method not allowed' });
    }
  } catch (err) {
    console.error('[services] Unhandled error:', err);
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET — Listar servicios
// ═══════════════════════════════════════════════════════════════════════════════
async function listServices(req, res) {
  const { query } = req;
  const filterQs = buildFilters(query);

  // Si se pide un ID concreto (?id=...)
  if (query?.id) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/services?id=eq.${encodeURIComponent(query.id)}&select=*`,
      {
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          Accept: 'application/json'
        }
      }
    );

    if (!resp.ok) {
      const errBody = await resp.text();
      return res.status(resp.status).json({ error: 'Supabase query failed', details: errBody });
    }

    const data = await resp.json();
    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Service not found' });
    }
    return res.status(200).json(data[0]);
  }

  // Listado con filtros opcionales
  const orderQs = '&order=created_at.desc';
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/services?select=*${filterQs}${orderQs}`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json'
      }
    }
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    return res.status(resp.status).json({ error: 'Supabase query failed', details: errBody });
  }

  const data = await resp.json();
  return res.status(200).json(data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST — Crear servicio
// ═══════════════════════════════════════════════════════════════════════════════
async function createService(req, res) {
  const body = req.body;

  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Request body must be a JSON object' });
  }

  if (!body.label || !body.label.trim()) {
    return res.status(400).json({ error: 'Field "label" is required' });
  }

  if (!body.description || !body.description.trim()) {
    return res.status(400).json({ error: 'Field "description" is required' });
  }

  const payload = sanitizeBody(body);

  const resp = await fetch(`${SUPABASE_URL}/rest/v1/services`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    return res.status(resp.status).json({ error: 'Supabase insert failed', details: errBody });
  }

  const data = await resp.json();
  return res.status(201).json(data[0] || data);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PATCH — Actualizar servicio
// ═══════════════════════════════════════════════════════════════════════════════
async function updateService(req, res) {
  const id = req.query?.id;

  if (!id) {
    return res.status(400).json({ error: 'Query parameter "id" (UUID) is required' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    return res.status(400).json({ error: 'Request body must be a non-empty JSON object' });
  }

  const payload = sanitizeBody(body);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid writable fields provided' });
  }

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/services?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(payload)
    }
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    return res.status(resp.status).json({ error: 'Supabase update failed', details: errBody });
  }

  const data = await resp.json();
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Service not found' });
  }
  return res.status(200).json(data[0]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DELETE — Eliminar servicio
// ═══════════════════════════════════════════════════════════════════════════════
async function deleteService(req, res) {
  const id = req.query?.id;

  if (!id) {
    return res.status(400).json({ error: 'Query parameter "id" (UUID) is required' });
  }

  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/services?id=eq.${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json',
        Prefer: 'return=representation'
      }
    }
  );

  if (!resp.ok) {
    const errBody = await resp.text();
    return res.status(resp.status).json({ error: 'Supabase delete failed', details: errBody });
  }

  const data = await resp.json();
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Service not found' });
  }
  return res.status(200).json({ deleted: data[0] });
}
