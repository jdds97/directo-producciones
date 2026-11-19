CREATE TABLE IF NOT EXISTS dp_astro_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS dp_astro_sessions_updated_at
  ON dp_astro_sessions(updated_at);
