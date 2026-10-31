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
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
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

/* ---------- Web Push (RFC 8291 encryption + VAPID), with the browser's built-in crypto ---------- */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function unb64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function concat(...parts) { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; }
async function hkdf(salt, ikm, info, len) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, len * 8));
}
async function encryptPush(sub, text) {
  const uaPublic = unb64u(sub.p256dh), authSecret = unb64u(sub.auth);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(86); head.set(salt, 0); new DataView(head.buffer).setUint32(16, 4096); head[20] = 65; head.set(asPublic, 21);
  return concat(head, ct);
}
async function vapid(env, endpoint) {
  // (The stored secret may start with an invisible byte-order mark from Windows; skip it.)
  const jwk = JSON.parse(String(env.VAPID_PRIVATE_JWK).replace(/^﻿/, '').trim());
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const p = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));
  return `vapid t=${h}.${p}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function sendPush(env, sub, text) {
  const r = await fetch(sub.endpoint, {
    redirect: 'manual',
    method: 'POST',
    headers: { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal', Authorization: await vapid(env, sub.endpoint) },
    body: await encryptPush(sub, text)
  });
  // The phone turned notifications off or the app was removed: forget it.
  if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM subs WHERE endpoint = ?').bind(sub.endpoint).run();
  sendPush.lastReason = r.status >= 300 ? (await r.text()).slice(0, 200) : '';
  return r.status;
}
const PUSH_HOSTS = /^https:\/\/([a-z0-9.-]+\.)?(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;
// Every 15 minutes: send each household's reminders that are due, then keep only the later ones.
async function sendDue(env) {
  const now = Date.now();
  const rows = (await env.DB.prepare('SELECT household, items FROM sched').all()).results || [];
  for (const row of rows) {
    let items; try { items = JSON.parse(row.items); } catch (e) { items = []; }
    const due = items.filter(i => i.at <= now), later = items.filter(i => i.at > now);
    if (!due.length) continue;
    const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth, who FROM subs WHERE household = ?').bind(row.household).all()).results || [];
    // Reminders more than 6 hours late (storage was down, etc.) are skipped rather than sent at an odd time.
    // A reminder with "to" goes only to that person's phone(s).
    for (const i of due.filter(i => now - i.at < 6 * 3600000)) for (const s of subs.filter(s => !i.to || s.who === i.to)) { try { await sendPush(env, s, i.data); } catch (e) { } }
    await env.DB.prepare('UPDATE sched SET items = ? WHERE household = ?').bind(JSON.stringify(later), row.household).run();
  }
}

// For the encryption test on the developer's PC (ignored by Cloudflare).
export const _test = { encryptPush, vapid };

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(sendDue(env)); },
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
    const m = url.pathname.match(/^\/v1\/h\/([A-Za-z0-9_-]{16,64})(?:\/(sub|sched|test|notify|subs))?$/);
    if (!m) return json(req, 404, { error: 'not found' });
    const id = m[1];
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (token.length < 20 || token.length > 200) return json(req, 401, { error: 'missing token' });
    const auth = await sha256(token);
    const row = await env.DB.prepare('SELECT auth, ver, data FROM households WHERE id = ?').bind(id).first();
    if (row && !same(row.auth, auth)) return json(req, 403, { error: 'wrong token' });

    // Notifications: a phone's push address, the household's reminder schedule, and a test message.
    if (m[2]) {
      if (!row) return json(req, 404, { error: 'no data yet' });
      let body = {};
      if (req.method !== 'DELETE' || req.headers.get('Content-Type')) { try { body = await req.json(); } catch (e) { body = {}; } }
      if (m[2] === 'sub') {
        const ep = String(body.endpoint || '');
        if (!PUSH_HOSTS.test(ep) || ep.length > 1000) return json(req, 400, { error: 'bad endpoint' });
        if (req.method === 'PUT') {
          if (typeof body.p256dh !== 'string' || typeof body.auth !== 'string' || body.p256dh.length > 200 || body.auth.length > 100) return json(req, 400, { error: 'bad keys' });
          // who: a code for the phone's person, made by the phones with the household key (not a readable name).
          const who = typeof body.who === 'string' && /^[0-9a-f]{8,64}$/.test(body.who) ? body.who : null;
          await env.DB.prepare('INSERT OR REPLACE INTO subs (endpoint, household, p256dh, auth, created, who) VALUES (?, ?, ?, ?, ?, ?)').bind(ep, id, body.p256dh, body.auth, Date.now(), who).run();
          return json(req, 200, { ok: true });
        }
        if (req.method === 'DELETE') { await env.DB.prepare('DELETE FROM subs WHERE endpoint = ? AND household = ?').bind(ep, id).run(); return json(req, 200, { ok: true }); }
      }
      if (m[2] === 'sched' && req.method === 'PUT') {
        const items = Array.isArray(body.items) ? body.items.slice(0, 200) : null;
        if (!items || items.some(i => !Number.isFinite(i.at) || typeof i.data !== 'string' || i.data.length > 1500)) return json(req, 400, { error: 'bad items' });
        const tag = t => (typeof t === 'string' && /^[0-9a-f]{8,64}$/.test(t) ? t : null);
        await env.DB.prepare('INSERT OR REPLACE INTO sched (household, items, updated) VALUES (?, ?, ?)').bind(id, JSON.stringify(items.map(i => ({ at: i.at, to: tag(i.to), data: i.data }))), Date.now()).run();
        return json(req, 200, { ok: true });
      }
      // Send one notification right now: to one person's phones, or to every phone in the household.
      if (m[2] === 'notify' && req.method === 'POST') {
        if (typeof body.data !== 'string' || body.data.length > 1500) return json(req, 400, { error: 'bad data' });
        const to = typeof body.to === 'string' && /^[0-9a-f]{8,64}$/.test(body.to) ? body.to : null;
        const subs = (await env.DB.prepare('SELECT endpoint, p256dh, auth, who FROM subs WHERE household = ?').bind(id).all()).results || [];
        let sent = 0;
        for (const s of subs.filter(s => !to || s.who === to)) { try { if ((await sendPush(env, s, body.data)) < 300) sent++; } catch (e) { } }
        return json(req, 200, { sent });
      }
      // Which people have a phone set up for notifications (their codes only).
      if (m[2] === 'subs' && req.method === 'GET') {
        const subs = (await env.DB.prepare('SELECT who FROM subs WHERE household = ?').bind(id).all()).results || [];
        return json(req, 200, { tags: subs.map(s => s.who).filter(Boolean) });
      }
      if (m[2] === 'test' && req.method === 'POST') {
        const s = await env.DB.prepare('SELECT endpoint, p256dh, auth FROM subs WHERE endpoint = ? AND household = ?').bind(String(body.endpoint || ''), id).first();
        if (!s || typeof body.data !== 'string' || body.data.length > 1500) return json(req, 400, { error: 'not subscribed' });
        let status, detail = '';
        try { status = await sendPush(env, s, body.data); detail = sendPush.lastReason || ''; } catch (e) { status = 0; detail = String(e && e.message || e); }
        return json(req, status >= 200 && status < 300 ? 200 : 502, { status, detail });
      }
      return json(req, 405, { error: 'method not allowed' });
    }

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
      if (row) {
        await env.DB.prepare('DELETE FROM households WHERE id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM subs WHERE household = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM sched WHERE household = ?').bind(id).run();
      }
      return json(req, 200, { ok: true });
    }
    return json(req, 405, { error: 'method not allowed' });
  }
};
