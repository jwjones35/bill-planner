/* Bill Planner sync storage (Cloudflare Worker + D1).
   It only ever holds scrambled (end-to-end encrypted) data: the key to read it never leaves the linked phones.
   Each household is one row: an id, a hash of its access token, a version number and the encrypted data.

   GET    /v1/h/:id   -> { ver, data }            (404 if none yet)
   PUT    /v1/h/:id   { ver, data } -> { ver }    (409 with the current { ver, data } if someone saved first)
   DELETE /v1/h/:id   -> { ok: true }
   Every request needs "Authorization: Bearer <token>". */

// The app's address, plus two addresses on the developer's own PC for testing as two separate phones.
const ALLOWED = ['https://jwjones35.github.io', 'http://127.0.0.1:8770', 'http://127.0.0.1:8771'];
const MAX = 1_500_000; // characters of encrypted data per household

function cors(req) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes(o) ? o : ALLOWED[0],
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } });

async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
// Compare two strings without leaking how much of them matched.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);
    if (url.pathname === '/' || url.pathname === '/v1') return json(req, 200, { ok: true, service: 'bill-planner-sync' });
    // One-time codes for adding a phone. The address is a hash of the code; the data is encrypted with the code.
    const pm = url.pathname.match(/^\/v1\/pair\/([0-9a-f]{64})$/);
    if (pm) {
      const now = Date.now();
      if (req.method === 'PUT') {
        let body; try { body = await req.json(); } catch (e) { return json(req, 400, { error: 'bad json' }); }
        if (!body || typeof body.data !== 'string' || body.data.length > 2000) return json(req, 400, { error: 'bad request' });
        await env.DB.prepare('DELETE FROM pairs WHERE expires < ?').bind(now).run();
        await env.DB.prepare('INSERT OR REPLACE INTO pairs (code, data, expires) VALUES (?, ?, ?)').bind(pm[1], body.data, now + 15 * 60000).run();
        return json(req, 200, { ok: true });
      }
      if (req.method === 'GET') {
        const row = await env.DB.prepare('SELECT data, expires FROM pairs WHERE code = ?').bind(pm[1]).first();
        if (!row || row.expires < now) return json(req, 404, { error: 'no such code' });
        await env.DB.prepare('DELETE FROM pairs WHERE code = ?').bind(pm[1]).run(); // works once
        return json(req, 200, { data: row.data });
      }
      return json(req, 405, { error: 'method not allowed' });
    }
    const m = url.pathname.match(/^\/v1\/h\/([A-Za-z0-9_-]{16,64})$/);
    if (!m) return json(req, 404, { error: 'not found' });
    const id = m[1];
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (token.length < 20 || token.length > 200) return json(req, 401, { error: 'missing token' });
    const auth = await sha256(token);
    const row = await env.DB.prepare('SELECT auth, ver, data FROM households WHERE id = ?').bind(id).first();
    if (row && !same(row.auth, auth)) return json(req, 403, { error: 'wrong token' });

    if (req.method === 'GET') {
      if (!row) return json(req, 404, { error: 'no data yet' });
      return json(req, 200, { ver: row.ver, data: row.data });
    }
    if (req.method === 'PUT') {
      let body;
      try { body = await req.json(); } catch (e) { return json(req, 400, { error: 'bad json' }); }
      const ver = Number(body && body.ver), data = body && body.data;
      if (!Number.isInteger(ver) || ver < 0 || typeof data !== 'string' || !data || data.length > MAX) return json(req, 400, { error: 'bad request' });
      const now = Date.now();
      if (!row) {
        if (ver !== 0) return json(req, 409, { ver: 0, data: null });
        await env.DB.prepare('INSERT INTO households (id, auth, ver, data, updated) VALUES (?, ?, 1, ?, ?)').bind(id, auth, data, now).run();
        return json(req, 200, { ver: 1 });
      }
      // Only save over the version the phone last saw; otherwise send back the newer one to merge with.
      const r = await env.DB.prepare('UPDATE households SET ver = ver + 1, data = ?, updated = ? WHERE id = ? AND ver = ?').bind(data, now, id, ver).run();
      if (!r.meta || r.meta.changes !== 1) {
        const cur = await env.DB.prepare('SELECT ver, data FROM households WHERE id = ?').bind(id).first();
        return json(req, 409, { ver: cur.ver, data: cur.data });
      }
      return json(req, 200, { ver: ver + 1 });
    }
    if (req.method === 'DELETE') {
      if (row) await env.DB.prepare('DELETE FROM households WHERE id = ?').bind(id).run();
      return json(req, 200, { ok: true });
    }
    return json(req, 405, { error: 'method not allowed' });
  }
};
