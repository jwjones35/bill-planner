// Checks the Worker's push encryption and signing by acting as a phone (RFC 8291 / RFC 8292). Run: node test-push.mjs
import { _test } from './src/index.js';
const enc = new TextEncoder(), s = crypto.subtle;
const b64u = b => Buffer.from(b).toString('base64url'), unb64u = x => new Uint8Array(Buffer.from(x, 'base64url'));
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt, ikm, info, len) => new Uint8Array(await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await s.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), len * 8));

// The "phone": its push keys.
const ua = await s.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await s.exportKey('raw', ua.publicKey));
const authSecret = crypto.getRandomValues(new Uint8Array(16));
const sub = { endpoint: 'https://web.push.apple.com/abc', p256dh: b64u(uaPub), auth: b64u(authSecret) };

const message = 'n1.example-encrypted-reminder-text';
const body = await _test.encryptPush(sub, message);
// Decrypt as the phone would.
const salt = body.slice(0, 16), rs = new DataView(body.buffer).getUint32(16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
const asKey = await s.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await s.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const ikm = await hkdf(authSecret, shared, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
const plain = new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv: nonce }, await s.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
const text = new TextDecoder().decode(plain.slice(0, plain.lastIndexOf(2)));
console.log('record size', rs, '| key id length', idlen, '| decrypted OK:', text === message);

// VAPID: sign with a throwaway key and check the signature with its public half.
const kp = await s.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const env = { VAPID_PRIVATE_JWK: JSON.stringify(await s.exportKey('jwk', kp.privateKey)), VAPID_PUBLIC: b64u(new Uint8Array(await s.exportKey('raw', kp.publicKey))), VAPID_SUBJECT: 'https://jwjones35.github.io/bill-planner/' };
const auth = await _test.vapid(env, sub.endpoint);
const [, jwt] = auth.match(/^vapid t=([^,]+), k=/);
const [h, p, sig] = jwt.split('.');
const ok = await s.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, unb64u(sig), enc.encode(h + '.' + p));
const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
console.log('VAPID signature valid:', ok, '| aud', claims.aud, '| sub', claims.sub, '| expires in hours', Math.round((claims.exp - Date.now() / 1000) / 3600));
