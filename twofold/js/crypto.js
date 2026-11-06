// Encryption (AES-256-GCM), signatures (ECDSA P-256) and helpers. Uses only the browser's Web Crypto API.

const subtle = crypto.subtle;
export const te = new TextEncoder();
export const td = new TextDecoder();

// ---------- encoding ----------
export function toB64(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(str) {
  const s = atob(str.replace(/\s+/g, ''));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export const toB64url = (b) => toB64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return fromB64(s);
}
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export const randomId = (n = 12) => toB64url(randomBytes(n));

// Deterministic JSON so signatures verify identically on every device.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}

// ---------- symmetric vault key ----------
export const newVaultKeyRaw = () => randomBytes(32);
export const importVaultKey = (raw) => subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);

const FORMAT_V1 = 1;
// Layout: [1 byte version][12 byte IV][ciphertext + 16 byte tag]
export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(1 + 12 + ct.length);
  out[0] = FORMAT_V1; out.set(iv, 1); out.set(ct, 13);
  return out;
}
export async function decryptBytes(key, data) {
  data = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (data[0] !== FORMAT_V1) throw new Error('Unknown file format');
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: data.subarray(1, 13) }, key, data.subarray(13)));
}
export const encryptJSON = (key, obj) => encryptBytes(key, te.encode(JSON.stringify(obj)));
export const decryptJSON = async (key, data) => JSON.parse(td.decode(await decryptBytes(key, data)));

// ---------- identity (signing) ----------
const EC = { name: 'ECDSA', namedCurve: 'P-256' };
const SIG = { name: 'ECDSA', hash: 'SHA-256' };

export async function newIdentity() {
  const pair = await subtle.generateKey(EC, true, ['sign', 'verify']);
  return {
    priv: toB64(await subtle.exportKey('pkcs8', pair.privateKey)),
    pub: toB64(await subtle.exportKey('spki', pair.publicKey)),
  };
}
export const importPrivate = (b64) => subtle.importKey('pkcs8', fromB64(b64), EC, false, ['sign']);
export const importPublic = (b64) => subtle.importKey('spki', fromB64(b64), EC, false, ['verify']);

export async function sign(privKey, obj) {
  return toB64(await subtle.sign(SIG, privKey, te.encode(canonical(obj))));
}
export async function verify(pubKey, obj, sigB64) {
  try { return await subtle.verify(SIG, pubKey, fromB64(sigB64), te.encode(canonical(obj))); }
  catch { return false; }
}

// ---------- passphrase lock ----------
export async function passKey(pass, salt) {
  const base = await subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// Verifier for the shared locked-chats PIN (never stored in plain form).
export async function pinHash(pin, salt) {
  const base = await subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return toB64(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256));
}

export async function sha256(bytes) {
  return new Uint8Array(await subtle.digest('SHA-256', bytes));
}
