import { env } from 'cloudflare:workers';
import type { SessionDriver } from 'astro';

export default function d1SessionDriver(): SessionDriver {
  return {
    async getItem(key) {
      const row = await env.DB.prepare(
        'SELECT payload FROM dp_astro_sessions WHERE session_id = ?1',
      ).bind(key).first<{ payload: string }>();
      return row?.payload;
    },
    async setItem(key, value) {
      if (typeof value !== 'string') throw new TypeError('La sesión de Astro debe serializarse como texto.');
      await env.DB.prepare(
        `INSERT INTO dp_astro_sessions (session_id, payload, updated_at)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(session_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      ).bind(key, value, Date.now()).run();
    },
    async removeItem(key) {
      await env.DB.prepare(
        'DELETE FROM dp_astro_sessions WHERE session_id = ?1',
      ).bind(key).run();
    },
  };
}
