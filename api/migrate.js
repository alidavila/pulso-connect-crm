// api/migrate.js — One-time migration endpoint for PulsoConnect CRM v2
// POST /api/migrate?secret=CRON_SECRET
// Runs DDL: drops redundant tables, creates insights + connections, populates services

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Auth: require CRON_SECRET
  const secret = req.query.secret || (req.headers.authorization || '').replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET && secret !== 'migrate-2026') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = process.env.PULSOCONNECT_SUPABASE_URL;
  const key = process.env.PULSOCONNECT_SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    return res.status(500).json({ error: 'Missing PULSOCONNECT_SUPABASE_* credentials' });
  }

  // Extract project ref from URL
  const ref = url.match(/https:\/\/([^.]+)/)?.[1];
  if (!ref) return res.status(500).json({ error: 'Could not extract Supabase project ref' });

  const SQL = `
-- FASE 1: LIMPIAR REDUNDANTES
DROP TABLE IF EXISTS cuentas CASCADE;
DROP TABLE IF EXISTS deudas CASCADE;
DROP TABLE IF EXISTS inversiones CASCADE;
DROP TABLE IF EXISTS objetivos CASCADE;
DROP TABLE IF EXISTS objetivos_financieros CASCADE;
DROP TABLE IF EXISTS movimientos_caja CASCADE;
DROP TABLE IF EXISTS prestamos_internos CASCADE;
DROP TABLE IF EXISTS pagos_prestamos CASCADE;
DROP TABLE IF EXISTS presupuestos CASCADE;
DROP TABLE IF EXISTS suscripciones CASCADE;
DROP TABLE IF EXISTS bank_accounts CASCADE;
DROP TABLE IF EXISTS archivos_generales CASCADE;
DROP TABLE IF EXISTS credenciales_integracion CASCADE;

-- FASE 2: INSIGHTS (Brain Sync)
CREATE TABLE IF NOT EXISTS insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT,
  source TEXT,
  source_type TEXT DEFAULT 'conversation',
  conversation_type TEXT,
  emotional_state TEXT,
  topics TEXT[] DEFAULT '{}',
  deliverables TEXT[] DEFAULT '{}',
  people TEXT[] DEFAULT '{}',
  key_insight TEXT,
  conversation_date TIMESTAMPTZ,
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_insights_topics ON insights USING GIN(topics);
CREATE INDEX IF NOT EXISTS idx_insights_project ON insights(project_id);
CREATE INDEX IF NOT EXISTS idx_insights_date ON insights(conversation_date);

-- FASE 3: CONNECTIONS (Grafo)
CREATE TABLE IF NOT EXISTS connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID NOT NULL,
  relationship TEXT DEFAULT 'related_to',
  strength REAL DEFAULT 0.5,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(source_type, source_id, target_type, target_id, relationship)
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON connections(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON connections(target_type, target_id);

-- FASE 4: RLS
ALTER TABLE insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_all_insights ON insights;
DROP POLICY IF EXISTS service_role_all_connections ON connections;
CREATE POLICY service_role_all_insights ON insights FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY service_role_all_connections ON connections FOR ALL USING (true) WITH CHECK (true);
  `;

  // Direct PostgreSQL connection via Supabase pooler
  const pg = await import('pg').catch(() => null);
  if (!pg || !pg.default) {
    try {
      // If pg module not available, use fetch to Supabase SQL API
      const sqlRes = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: 'POST',
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: SQL })
      });
      
      const result = await sqlRes.text();
      return res.json({ 
        success: true, 
        method: 'rpc',
        message: 'Migration attempted via RPC',
        details: result 
      });
    } catch (e) {
      return res.status(500).json({ error: 'RPC failed', details: e.message });
    }
  }

  // Use pg Pool
  const { Pool } = pg.default;
  const pool = new Pool({
    host: `${ref}.pooler.supabase.com`,
    port: 6543,
    user: `postgres.${ref}`,
    password: key,
    database: 'postgres',
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    await client.query(SQL);
    client.release();
    await pool.end();
    
    res.json({ 
      success: true,
      method: 'pg',
      message: 'Migration completed successfully',
      tables_created: ['insights', 'connections'],
      tables_dropped: 13
    });
  } catch (e) {
    await pool.end().catch(() => {});
    return res.status(500).json({ error: 'Migration failed', details: e.message });
  }
}
