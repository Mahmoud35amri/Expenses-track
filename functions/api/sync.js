// POST /api/sync
// Body: { since: <cursor>, changes: [{ kind, id, updatedAt, deleted, data }] }
// Auth: "Authorization: Bearer <sync key>". Each key is its own private vault.
// Writes are last-write-wins on updatedAt; the response returns every record changed after `since`.
import { json, preflight } from '../../lib/api.js';

const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const KINDS = new Set(['expense', 'category', 'settings']);
const MAX_CHANGES = 500;
const MAX_DATA = 4000;
const PAGE = 1000;

async function vaultOf(key) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestOptions = ({ request }) => preflight(request);

export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!KEY_RE.test(key)) return json({ error: 'unauthorized' }, 401, request);
  if (!env.DB) return json({ error: 'database not configured' }, 503, request);

  let body;
  try { body = await request.json(); } catch (_) { return json({ error: 'invalid JSON' }, 400, request); }
  let since = Number.isInteger(body && body.since) && body.since >= 0 ? body.since : 0;
  const input = Array.isArray(body && body.changes) ? body.changes : [];
  if (input.length > MAX_CHANGES) return json({ error: 'too many changes' }, 413, request);

  const changes = [];
  for (const c of input) {
    const updatedAt = Number(c && c.updatedAt);
    if (!c || !KINDS.has(c.kind) || typeof c.id !== 'string' || !c.id || c.id.length > 64 || !Number.isFinite(updatedAt) || updatedAt < 0) {
      return json({ error: 'invalid change' }, 400, request);
    }
    const data = c.deleted ? null : JSON.stringify(c.data === undefined ? null : c.data);
    if (data && data.length > MAX_DATA) return json({ error: 'record too large' }, 413, request);
    changes.push({ kind: c.kind, id: c.id, data, deleted: c.deleted ? 1 : 0, updatedAt: Math.floor(updatedAt) });
  }

  const vault = await vaultOf(key);
  const db = env.DB;
  const n = changes.length;

  // One atomic batch: reserve n revision numbers, upsert (newer edits win), then read everything after `since`.
  const stmts = [
    db.prepare('INSERT OR IGNORE INTO vaults (vault, rev, created_at) VALUES (?1, 0, ?2)').bind(vault, Date.now()),
  ];
  if (n) {
    stmts.push(db.prepare('UPDATE vaults SET rev = rev + ?2 WHERE vault = ?1').bind(vault, n));
    stmts.push(db.prepare(
      `INSERT INTO records (vault, kind, id, data, deleted, updated_at, rev)
       SELECT ?1, json_extract(value, '$.kind'), json_extract(value, '$.id'), json_extract(value, '$.data'),
              json_extract(value, '$.deleted'), json_extract(value, '$.updatedAt'),
              (SELECT rev FROM vaults WHERE vault = ?1) - (?3 - 1 - key)
       FROM json_each(?2) WHERE true
       ON CONFLICT (vault, kind, id) DO UPDATE SET
         data = excluded.data, deleted = excluded.deleted, updated_at = excluded.updated_at, rev = excluded.rev
       WHERE excluded.updated_at > records.updated_at`
    ).bind(vault, JSON.stringify(changes), n));
  }
  stmts.push(db.prepare('SELECT rev FROM vaults WHERE vault = ?1').bind(vault));
  const results = await db.batch(stmts);
  const head = results[results.length - 1].results[0].rev;
  if (since > head) since = 0; // client cursor from an older database: resend everything

  const rows = (await db.prepare(
    'SELECT kind, id, data, deleted, updated_at, rev FROM records WHERE vault = ?1 AND rev > ?2 ORDER BY rev LIMIT ?3'
  ).bind(vault, since, PAGE + 1).all()).results;

  const more = rows.length > PAGE;
  const page = more ? rows.slice(0, PAGE) : rows;
  return json({
    cursor: more ? page[page.length - 1].rev : head,
    more,
    records: page.map((r) => ({
      kind: r.kind, id: r.id, deleted: !!r.deleted, updatedAt: r.updated_at, rev: r.rev,
      data: r.data ? JSON.parse(r.data) : null,
    })),
  }, 200, request);
}
