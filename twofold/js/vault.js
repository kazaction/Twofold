// The vault: an append-only log of signed, encrypted events, synced through a GitHub repo.
//
// Repo layout (everything except vault.json and README.md is encrypted):
//   vault.json                                  marker + key check (no secrets)
//   events/<deviceId>/<time>-<rand>.bin         a batch of events pushed by one device
//   blobs/<rand>.bin                            an attachment (image/file)
//
// Git conflicts can't happen: devices only ADD files and each event is signed by its author.
// Edit conflicts are resolved "last push wins": every update is replayed in the order it was
// pushed (push time is encoded in the file name), so whoever synced last is the master version.
// Only message edits/deletes are restricted to the message's author.

import * as db from './db.js';
import * as C from './crypto.js';
import { GitHub } from './github.js';

const MARKER = 'vault.json';
const CHECK_TEXT = 'twofold-vault-check-v1';
const CODE_PREFIX = 'TF1.';
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PATH_RE = /^blobs\/[A-Za-z0-9_-]{8,64}\.bin$/;

const UPDATE_TYPES = new Set(['chat_update', 'msg_edit', 'msg_delete', 'cal_edit', 'cal_delete', 'pin_set', 'tl_edit', 'tl_delete']);
const pushTimeOf = (path) => parseInt(path.split('/').pop().split('-')[0], 36) || 0;
const cmp = (a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

export class Vault extends EventTarget {
  constructor() {
    super();
    this.settings = null;
    this.secrets = null;
    this.events = new Map();      // id -> event (from repo + outbox)
    this.pendingIds = new Set();  // events in outbox
    this.verdict = new Map();     // `${id}|${pub}` -> bool
    this.pubKeys = new Map();     // pub b64 -> CryptoKey
    this.blobShas = new Map();    // repo path -> blob sha
    this.pushTime = new Map();    // event id -> time its batch was pushed
    this.calendar = new Map();
    this.items = new Map();       // timeline items
    this.byTimeline = new Map();
    this.pin = null;
    this.members = new Map();
    this.chats = new Map();
    this.messages = new Map();
    this.byChat = new Map();
    this.rejected = 0;
    this.lastTs = 0;
    this.sync_ = { running: null, error: null };
    this.urlCache = new Map();
  }

  // ---------------- lifecycle ----------------
  async boot() {
    this.settings = await db.get('kv', 'settings');
    if (!this.settings) return 'setup';
    const s = await db.get('kv', 'secrets');
    if (!s) return 'setup';
    if (s.wrapped) return 'locked';
    await this.open(s.plain);
    return 'ready';
  }

  async unlock(pass) {
    const s = await db.get('kv', 'secrets');
    let secrets;
    try { secrets = await C.decryptJSON(await C.passKey(pass, s.salt), s.wrapped); }
    catch { throw new Error('Wrong passphrase'); }
    await this.open(secrets);
  }

  async open(secrets) {
    this.secrets = secrets;
    this.key = await C.importVaultKey(C.fromB64(secrets.key));
    this.signKey = await C.importPrivate(secrets.priv);
    this.gh = new GitHub({ repo: this.settings.repo, branch: this.settings.branch, token: secrets.token });
    await this.loadLocal();
  }

  async saveSettings() { await db.put('kv', 'settings', this.settings); }

  async loadLocal() {
    for (const [path, rec] of await db.entries('files')) {
      this.blobShas.set(path, rec.sha);
      if (rec.data && path.startsWith('events/')) {
        try { this.addEvents((await C.decryptJSON(this.key, rec.data)).events, false, pushTimeOf(path)); }
        catch (e) { console.warn('Could not decrypt', path, e); }
      }
    }
    for (const [id, enc] of await db.entries('outbox')) {
      try { this.addEvents([await C.decryptJSON(this.key, enc)], true); }
      catch (e) { console.warn('Bad outbox entry', id); }
    }
    await this.rebuild();
  }

  addEvents(list, pending = false, pushedAt = 0) {
    for (const ev of list || []) {
      if (!ev || typeof ev.id !== 'string' || typeof ev.ts !== 'number') continue;
      if (!this.events.has(ev.id)) this.events.set(ev.id, ev);
      if (pushedAt && !this.pushTime.has(ev.id)) this.pushTime.set(ev.id, pushedAt);
      if (pending) this.pendingIds.add(ev.id);
      if (ev.a === this.settings.personId && ev.d === this.settings.deviceId) this.lastTs = Math.max(this.lastTs, ev.ts);
    }
  }

  // ---------------- verification + replay ----------------
  async pubKey(b64) {
    if (!this.pubKeys.has(b64)) this.pubKeys.set(b64, await C.importPublic(b64));
    return this.pubKeys.get(b64);
  }

  async check(ev, pub) {
    const k = ev.id + '|' + pub;
    if (!this.verdict.has(k)) {
      const { s, ...body } = ev;
      let ok = false;
      try { ok = await C.verify(await this.pubKey(pub), body, s); } catch {}
      this.verdict.set(k, ok);
    }
    return this.verdict.get(k);
  }

  async rebuild() {
    const sorted = [...this.events.values()].sort(cmp);
    // 1) Identities: trust-on-first-use. The first valid self-signed "member" event for a
    //    person fixes their public key; later claims with another key are ignored.
    const keyOf = new Map();
    for (const ev of sorted) {
      if (ev.t !== 'member' || typeof ev.pub !== 'string') continue;
      const known = keyOf.get(ev.a);
      if (known && known !== ev.pub) continue;
      if (await this.check(ev, ev.pub)) keyOf.set(ev.a, ev.pub);
    }
    // 2) Keep only correctly signed events.
    let rejected = 0;
    const valid = [];
    for (const ev of sorted) {
      const pub = keyOf.get(ev.a);
      if (pub && (await this.check(ev, pub))) valid.push(ev); else rejected++;
    }
    // 3) Creations are replayed by time; updates by PUSH order (last push wins).
    //    Events not pushed yet count as "latest" – they will be once this device syncs.
    const pt = (e) => (this.pendingIds.has(e.id) ? Infinity : (this.pushTime.get(e.id) ?? e.ts));
    const creates = valid.filter((e) => !UPDATE_TYPES.has(e.t));
    const updates = valid.filter((e) => UPDATE_TYPES.has(e.t)).sort((a, b) => (pt(a) - pt(b)) || cmp(a, b));
    const members = new Map(), chats = new Map(), messages = new Map(), calendar = new Map(), items = new Map();
    let pin = null;
    for (const ev of [...creates, ...updates]) {
      const pending = this.pendingIds.has(ev.id);
      switch (ev.t) {
        case 'member': {
          const prev = members.get(ev.a);
          members.set(ev.a, { id: ev.a, name: clip(ev.name, 40) || 'Someone', since: prev?.since ?? ev.ts });
          break;
        }
        case 'chat_create':
          if (!chats.has(ev.chat)) chats.set(ev.chat, {
            id: ev.chat, kind: ev.kind === 'timeline' ? 'timeline' : 'chat', name: clip(ev.name, 60) || 'chat', emoji: clip(ev.emoji, 8), desc: clip(ev.desc, 500),
            creator: ev.a, created: ev.ts, updated: ev.ts, deleted: false, locked: false, lastTs: ev.ts, count: 0, pending,
          });
          break;
        case 'chat_update': {
          const c = chats.get(ev.chat);
          if (!c) { rejected++; break; }
          if (ev.name !== undefined) c.name = clip(ev.name, 60) || c.name;
          if (ev.emoji !== undefined) c.emoji = clip(ev.emoji, 8);
          if (ev.desc !== undefined) c.desc = clip(ev.desc, 500);
          if (ev.deleted !== undefined) c.deleted = !!ev.deleted;
          if (ev.locked !== undefined) c.locked = !!ev.locked;
          c.updated = Math.max(c.updated, ev.ts);
          c.pending ||= pending;
          break;
        }
        case 'msg':
          if (!messages.has(ev.msg) && chats.has(ev.chat)) messages.set(ev.msg, {
            id: ev.msg, chat: ev.chat, author: ev.a, ts: ev.ts, text: clip(ev.text, 20000),
            att: Array.isArray(ev.att) ? ev.att.filter((a) => a && PATH_RE.test(a.path)).slice(0, 20) : [],
            edited: null, deleted: false, pending,
          });
          break;
        case 'msg_edit': {
          const m = messages.get(ev.msg);
          if (m && m.author === ev.a && !m.deleted) { m.text = clip(ev.text, 20000); m.edited = ev.ts; m.pending ||= pending; }
          else rejected++;
          break;
        }
        case 'msg_delete': {
          const m = messages.get(ev.msg);
          if (m && m.author === ev.a) { m.deleted = true; m.text = ''; m.att = []; m.pending ||= pending; }
          else rejected++;
          break;
        }
        case 'cal_add':
          if (!calendar.has(ev.ev) && DAY_RE.test(ev.day)) calendar.set(ev.ev, {
            id: ev.ev, day: ev.day, title: clip(ev.title, 200) || 'Event', author: ev.a, created: ev.ts, editedBy: null, deleted: false, pending,
          });
          break;
        case 'cal_edit': {
          const e = calendar.get(ev.ev);
          if (!e || e.deleted) break;
          if (ev.title !== undefined) e.title = clip(ev.title, 200) || e.title;
          if (ev.day !== undefined && DAY_RE.test(ev.day)) e.day = ev.day;
          e.editedBy = ev.a; e.pending ||= pending;
          break;
        }
        case 'cal_delete': {
          const e = calendar.get(ev.ev);
          if (e) { e.deleted = true; e.pending ||= pending; }
          break;
        }
        case 'tl_add':
          if (!items.has(ev.item) && chats.get(ev.chat)?.kind === 'timeline') items.set(ev.item, {
            id: ev.item, chat: ev.chat, title: clip(ev.title, 120) || 'Untitled', desc: clip(ev.desc, 10000), color: clip(ev.color, 16),
            author: ev.a, created: ev.ts, edited: null, editedBy: null, deleted: false, pending,
          });
          break;
        case 'tl_edit': {
          const it = items.get(ev.item);
          if (!it || it.deleted) break;
          if (ev.title !== undefined) it.title = clip(ev.title, 120) || it.title;
          if (ev.desc !== undefined) it.desc = clip(ev.desc, 10000);
          if (ev.color !== undefined) it.color = clip(ev.color, 16);
          it.edited = ev.ts; it.editedBy = ev.a; it.pending ||= pending;
          break;
        }
        case 'tl_delete': {
          const it = items.get(ev.item);
          if (it) { it.deleted = true; it.pending ||= pending; }
          break;
        }
        case 'pin_set':
          if (typeof ev.salt === 'string' && typeof ev.hash === 'string') pin = { salt: ev.salt, hash: ev.hash, by: ev.a, ts: ev.ts };
          break;
      }
    }
    const byChat = new Map();
    for (const c of chats.values()) byChat.set(c.id, []);
    for (const m of messages.values()) byChat.get(m.chat)?.push(m);
    for (const [id, list] of byChat) {
      list.sort((a, b) => (a.ts - b.ts) || (a.id < b.id ? -1 : 1));
      const c = chats.get(id);
      c.count = list.filter((m) => !m.deleted).length;
      if (list.length) c.lastTs = Math.max(c.created, list[list.length - 1].ts);
    }
    const byTimeline = new Map();
    for (const c of chats.values()) if (c.kind === 'timeline') byTimeline.set(c.id, []);
    for (const it of items.values()) if (!it.deleted) byTimeline.get(it.chat)?.push(it);
    for (const [id, list] of byTimeline) {
      list.sort((a, b) => (a.created - b.created) || (a.id < b.id ? -1 : 1));
      const c = chats.get(id);
      c.count = list.length;
      if (list.length) c.lastTs = Math.max(c.created, list[list.length - 1].created);
    }
    Object.assign(this, { members, chats, messages, byChat, calendar, items, byTimeline, pin, rejected, keyOf });
    this.dispatchEvent(new Event('change'));
  }

  // ---------------- writing ----------------
  async emit(type, payload = {}, after = 0) {
    const ts = Math.max(Date.now(), this.lastTs + 1, after + 1);
    this.lastTs = ts;
    const body = { id: C.randomId(), t: type, a: this.settings.personId, d: this.settings.deviceId, ts, ...payload };
    const ev = { ...body, s: await C.sign(this.signKey, body) };
    await db.put('outbox', ev.id, await C.encryptJSON(this.key, ev));
    this.addEvents([ev], true);
    await this.rebuild();
    this.autoSyncSoon();
    return ev;
  }

  createChat({ name, emoji, desc, kind = 'chat' }) {
    const chat = C.randomId(9);
    return this.emit('chat_create', { chat, kind, name: name.trim(), emoji: emoji?.trim() || '', desc: desc?.trim() || '' }).then(() => chat);
  }

  // ---- timelines ----
  addItem(chat, { title, desc = '', color = '' }) { return this.emit('tl_add', { item: C.randomId(), chat, title: title.trim(), desc, color }); }
  editItem(id, fields) { return this.emit('tl_edit', { item: id, ...fields }); }
  deleteItem(id) { return this.emit('tl_delete', { item: id }); }
  updateChat(id, fields) {
    if (!this.chats.has(id)) throw new Error('Chat not found');
    return this.emit('chat_update', { chat: id, ...fields });
  }

  // ---- calendar ----
  addEvent(day, title) { return this.emit('cal_add', { ev: C.randomId(), day, title: title.trim() }); }
  editEvent(id, fields) { return this.emit('cal_edit', { ev: id, ...fields }); }
  deleteEvent(id) { return this.emit('cal_delete', { ev: id }); }

  // ---- shared PIN for locked chats ----
  async setPin(pin) {
    const salt = C.randomBytes(16);
    return this.emit('pin_set', { salt: C.toB64(salt), hash: await C.pinHash(pin, salt) });
  }
  async checkPin(pin) {
    if (!this.pin) return false;
    return (await C.pinHash(pin, C.fromB64(this.pin.salt))) === this.pin.hash;
  }
  sendMessage(chat, text, att = []) {
    return this.emit('msg', { msg: C.randomId(), chat, text, att });
  }
  editMessage(id, text) {
    const m = this.messages.get(id);
    if (!m || m.author !== this.settings.personId) throw new Error('You can only edit your own messages');
    return this.emit('msg_edit', { msg: id, text }, Math.max(m.ts, m.edited || 0));
  }
  deleteMessage(id) {
    const m = this.messages.get(id);
    if (!m || m.author !== this.settings.personId) throw new Error('You can only delete your own messages');
    return this.emit('msg_delete', { msg: id }, Math.max(m.ts, m.edited || 0));
  }
  async setName(name) {
    this.settings.name = name;
    await this.saveSettings();
    return this.emit('member', { name, pub: this.secrets.pub });
  }

  // Store an attachment (encrypted) for the next push. Returns its repo path.
  async addBlob(bytes) {
    const path = `blobs/${C.randomId(18)}.bin`;
    await db.put('pending', path, await C.encryptBytes(this.key, bytes));
    return path;
  }

  async getBlob(path) {
    let enc = (await db.get('pending', path)) || (await db.get('cache', path));
    if (!enc) {
      let sha = this.blobShas.get(path);
      if (!sha) {
        const { files } = await this.gh.listFiles();
        for (const [p, s] of files) this.blobShas.set(p, s);
        sha = files.get(path);
        if (!sha) throw new Error('Attachment not in the repo yet (not pushed from the other device?)');
      }
      enc = await this.gh.getBlob(sha);
      await db.put('cache', path, enc);
    }
    return C.decryptBytes(this.key, enc);
  }

  async blobURL(path, mime) {
    if (!this.urlCache.has(path)) {
      const bytes = await this.getBlob(path);
      this.urlCache.set(path, URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' })));
    }
    return this.urlCache.get(path);
  }

  // ---------------- sync ----------------
  autoSyncSoon() {
    if (!this.settings.autoSync) return;
    clearTimeout(this._autoTimer);
    this._autoTimer = setTimeout(() => this.sync().catch(() => {}), 1500);
  }

  async pendingCount() { return (await db.count('outbox')) + (await db.count('pending')); }

  sync() {
    if (this.sync_.running) return this.sync_.running;
    const run = (async () => {
      this.sync_.error = null;
      this.dispatchEvent(new Event('sync'));
      try {
        await this.pull();
        if (await this.push()) await this.pull();
        this.settings.lastSync = Date.now();
        await this.saveSettings();
      } catch (e) {
        this.sync_.error = e.message || String(e);
        throw e;
      } finally {
        this.sync_.running = null;
        this.dispatchEvent(new Event('sync'));
      }
    })();
    this.sync_.running = run;
    return run;
  }

  progress(text) { this.sync_.progress = text; this.dispatchEvent(new Event('sync')); }

  async pull() {
    this.progress('Checking…');
    const head = await this.gh.headCommit();
    if (!head || head === this.settings.lastHead) return 0;
    const { files } = await this.gh.listFiles();
    const toFetch = [];
    const meta = [];
    for (const [path, sha] of files) {
      if (this.blobShas.get(path) === sha) continue;
      this.blobShas.set(path, sha);
      if (path.startsWith('events/')) toFetch.push([path, sha]);
      else meta.push([path, { sha }]);
    }
    let fetched = 0;
    const incoming = [];
    const queue = toFetch.slice();
    const worker = async () => {
      while (queue.length) {
        const [path, sha] = queue.shift();
        const data = await this.gh.getBlob(sha);
        try {
          const evs = (await C.decryptJSON(this.key, data)).events || [];
          for (const ev of evs) if (ev?.id && !this.pushTime.has(ev.id)) this.pushTime.set(ev.id, pushTimeOf(path));
          incoming.push(...evs); meta.push([path, { sha, data }]);
        }
        catch { meta.push([path, { sha, bad: true }]); }
        this.progress(`Downloading ${++fetched}/${toFetch.length}`);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, worker));
    await db.putMany('files', meta);
    this.addEvents(incoming);
    this.settings.lastHead = head;
    await this.saveSettings();
    if (incoming.length) await this.rebuild();
    return incoming.length;
  }

  async push() {
    const out = await db.entries('outbox');
    const pend = await db.entries('pending');
    if (!out.length && !pend.length) return 0;
    this.progress('Uploading…');
    const evs = [];
    for (const [, enc] of out) evs.push(await C.decryptJSON(this.key, enc));
    const files = pend.map(([path, bytes]) => ({ path, bytes }));
    let evPath = null, evBytes = null;
    const pushedAt = Math.max(Date.now(), ...evs.map((e) => e.ts));
    if (evs.length) {
      evPath = `events/${this.settings.deviceId}/${pushedAt.toString(36)}-${C.randomId(6)}.bin`;
      evBytes = await C.encryptJSON(this.key, { v: 1, events: evs });
      files.push({ path: evPath, bytes: evBytes });
    }
    const { shas } = await this.gh.commitFiles(files, 'sync', (i, n) => this.progress(`Uploading ${i}/${n}`));
    await db.putMany('files', files.map((f) => {
      this.blobShas.set(f.path, shas.get(f.path));
      return [f.path, f.path === evPath ? { sha: shas.get(f.path), data: evBytes } : { sha: shas.get(f.path) }];
    }));
    await db.putMany('cache', pend.filter(([p]) => p.startsWith('blobs/')));
    await db.delMany('pending', pend.map(([p]) => p));
    await db.delMany('outbox', out.map(([id]) => id));
    for (const [id] of out) { this.pendingIds.delete(id); this.pushTime.set(id, pushedAt); }
    await this.rebuild();
    return files.length;
  }

  // ---------------- setup ----------------
  static async checkRepo(gh) {
    const info = await gh.repoInfo();
    if (info.permissions && !info.permissions.push) throw new Error('This token can read but not write to the repo. Give it "Contents: Read and write".');
    return info;
  }

  static async readMarker(gh) {
    const { files } = await gh.listFiles();
    const sha = files.get(MARKER);
    if (!sha) return null;
    return JSON.parse(C.td.decode(await gh.getBlob(sha)));
  }

  async init({ settings, secrets }) {
    this.settings = settings;
    await this.saveSettings();
    await db.put('kv', 'secrets', { plain: secrets });
    await this.open(secrets);
    try { await navigator.storage?.persist?.(); } catch {}
  }

  async createNew({ repo, branch, token, name }) {
    const gh = new GitHub({ repo, branch, token });
    const info = await Vault.checkRepo(gh);
    await gh.ensureInitialized();
    if (await Vault.readMarker(gh)) throw new Error('This repo already contains a vault. Use "Join" with a setup code instead.');
    const keyRaw = C.newVaultKeyRaw();
    const id = await C.newIdentity();
    await this.init({
      settings: { repo: gh.repo, branch: gh.branch, personId: C.randomId(9), deviceId: C.randomId(6), name, autoSync: true, compress: true, lastHead: null, created: Date.now() },
      secrets: { key: C.toB64(keyRaw), token: gh.token, priv: id.priv, pub: id.pub },
    });
    const check = C.toB64(await C.encryptBytes(this.key, C.te.encode(CHECK_TEXT)));
    await db.put('pending', MARKER, C.te.encode(JSON.stringify({ app: 'twofold', v: 1, check }, null, 2)));
    await this.emit('member', { name, pub: id.pub });
    await this.createChat({ name: 'general', emoji: '💬', desc: '' });
    await this.sync();
    return info;
  }

  static parseCode(code) {
    code = code.trim().replace(/\s+/g, '');
    if (!code.startsWith(CODE_PREFIX)) throw new Error('That is not a setup code');
    try { return JSON.parse(C.td.decode(C.fromB64url(code.slice(CODE_PREFIX.length)))); }
    catch { throw new Error('Setup code is damaged – copy it again'); }
  }

  makeCode({ forMyDevice, includeToken }) {
    const c = { r: this.settings.repo, b: this.settings.branch, k: this.secrets.key };
    if (includeToken) c.t = this.secrets.token;
    if (forMyDevice) c.p = { id: this.settings.personId, priv: this.secrets.priv, pub: this.secrets.pub, n: this.settings.name };
    return CODE_PREFIX + C.toB64url(C.te.encode(JSON.stringify(c)));
  }

  async join(code, { name, token }) {
    const c = Vault.parseCode(code);
    const gh = new GitHub({ repo: c.r, branch: c.b, token: token || c.t || '' });
    if (!gh.token) throw new Error('A GitHub token is needed');
    await Vault.checkRepo(gh);
    const marker = await Vault.readMarker(gh);
    if (!marker) throw new Error('No vault found in that repo');
    try {
      const k = await C.importVaultKey(C.fromB64(c.k));
      if (C.td.decode(await C.decryptBytes(k, C.fromB64(marker.check))) !== CHECK_TEXT) throw 0;
    } catch { throw new Error('The key in this setup code does not match the vault'); }
    const person = c.p || { id: C.randomId(9), ...(await C.newIdentity()), n: name };
    await this.init({
      settings: { repo: gh.repo, branch: gh.branch, personId: person.id, deviceId: C.randomId(6), name: person.n || name, autoSync: true, compress: true, lastHead: null, created: Date.now() },
      secrets: { key: c.k, token: gh.token, priv: person.priv, pub: person.pub },
    });
    if (!c.p) await this.emit('member', { name, pub: person.pub });
    await this.sync();
  }

  // ---------------- security / data ----------------
  async setPassphrase(pass) {
    if (!pass) {
      await db.put('kv', 'secrets', { plain: this.secrets });
      this.settings.lock = false;
    } else {
      const salt = C.randomBytes(16);
      const wrapped = await C.encryptJSON(await C.passKey(pass, salt), this.secrets);
      await db.put('kv', 'secrets', { wrapped, salt });
      this.settings.lock = true;
    }
    await this.saveSettings();
  }

  async updateToken(token) {
    const gh = new GitHub({ repo: this.settings.repo, branch: this.settings.branch, token });
    await Vault.checkRepo(gh);
    this.secrets.token = gh.token;
    this.gh = gh;
    const s = await db.get('kv', 'secrets');
    if (s.plain) await db.put('kv', 'secrets', { plain: this.secrets });
    else throw new Error('Remove the app lock first, then change the token');
  }

  exportJSON() {
    const name = (id) => this.members.get(id)?.name || id;
    return {
      exported: new Date().toISOString(),
      calendar: [...this.calendar.values()].filter((e) => !e.deleted).sort((a, b) => a.day.localeCompare(b.day)).map((e) => ({ day: e.day, title: e.title, by: name(e.author) })),
      members: [...this.members.values()],
      chats: [...this.chats.values()].map((c) => ({
        name: c.name, kind: c.kind, emoji: c.emoji, desc: c.desc,
        timeline: c.kind === 'timeline' ? (this.byTimeline.get(c.id) || []).map((it) => ({ title: it.title, description: it.desc, color: it.color, by: name(it.author), added: new Date(it.created).toISOString() })) : undefined, creator: name(c.creator), created: new Date(c.created).toISOString(), deleted: c.deleted,
        messages: (this.byChat.get(c.id) || []).filter((m) => !m.deleted).map((m) => ({
          author: name(m.author), time: new Date(m.ts).toISOString(), edited: m.edited ? new Date(m.edited).toISOString() : undefined,
          text: m.text, attachments: m.att.map((a) => ({ name: a.name, type: a.mime, size: a.size, path: a.path })),
        })),
      })),
    };
  }

  async wipeDevice() { await db.wipe(); }
}
