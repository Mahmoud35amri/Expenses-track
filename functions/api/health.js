import { json, preflight } from '../../lib/api.js';

export const onRequestOptions = ({ request }) => preflight(request);

export async function onRequestGet({ request, env }) {
  let db = false;
  try { db = !!env.DB && !!(await env.DB.prepare('SELECT 1 AS ok FROM vaults LIMIT 1').all()); } catch (_) { db = false; }
  return json({ ok: true, db }, 200, request);
}
