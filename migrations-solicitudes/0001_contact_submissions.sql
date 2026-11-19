-- Consultas del formulario. Solo se usa con CONTACT_PERSISTENCE=on (hoy únicamente en local, datos sintéticos).
-- Contrato de privacidad y retención: OPERACION-INFRA.md. Migración aditiva: el código anterior la ignora.
-- id = clave de idempotencia de Resend (UUID), creada antes del primer intento y reutilizada en cada reintento.
CREATE TABLE IF NOT EXISTS contact_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  content_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  service TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  -- received: guardada, sin confirmar · sent: aceptada por el proveedor (no implica bandeja de entrada)
  -- failed: error reintentable · dead: no se reintenta (error definitivo, intentos o ventana de 24 h agotados)
  state TEXT NOT NULL CHECK (state IN ('received', 'sent', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  first_attempt_at INTEGER,
  claimed_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS contact_submissions_pending ON contact_submissions(state, updated_at);
CREATE INDEX IF NOT EXISTS contact_submissions_hash ON contact_submissions(content_hash, created_at);
