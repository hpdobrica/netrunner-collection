'use strict';

/* ---------- utilities ---------- */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’‘`]/g, "'").replace(/[“”]/g, '"').toLowerCase().replace(/\s+/g, ' ').trim();
const plural = (n, w, ws = w + 's') => `${n} ${n === 1 ? w : ws}`;
const uid = () => Math.random().toString(36).slice(2, 10);
const sel = key => `[data-key="${CSS.escape(key)}"]`;
const store = {
  get(k, d) { try { const v = localStorage.getItem('nrc:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('nrc:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

const FACTIONS = {
  'anarch': ['Anarch', '#e8692c'], 'criminal': ['Criminal', '#3f7fd9'], 'shaper': ['Shaper', '#4caf50'],
  'adam': ['Adam', '#b39b5a'], 'apex': ['Apex', '#b04040'], 'sunny-lebeau': ['Sunny Lebeau', '#8a8aa0'],
  'neutral-runner': ['Neutral', '#8a8f98'],
  'haas-bioroid': ['Haas-Bioroid', '#8b5bd6'], 'jinteki': ['Jinteki', '#d1414b'], 'nbn': ['NBN', '#e0b021'],
  'weyland-consortium': ['Weyland', '#3b9a6e'], 'neutral-corp': ['Neutral', '#8a8f98'],
};
const RUNNER_FACTIONS = ['anarch', 'criminal', 'shaper', 'adam', 'apex', 'sunny-lebeau', 'neutral-runner'];
const CORP_FACTIONS = ['haas-bioroid', 'jinteki', 'nbn', 'weyland-consortium', 'neutral-corp'];
const TYPES = ['identity', 'agenda', 'asset', 'upgrade', 'operation', 'ice', 'event', 'hardware', 'resource', 'program'];
const TYPE_NAMES = { identity: 'Identity', agenda: 'Agenda', asset: 'Asset', upgrade: 'Upgrade', operation: 'Operation', ice: 'Ice', event: 'Event', hardware: 'Hardware', resource: 'Resource', program: 'Program' };
// Fantasy Flight Games published up to 2018; Null Signal Games from System Core 2019 on (and any new cycle).
const FFG_CYCLES = new Set(['core', 'genesis', 'creation-and-control', 'spin', 'draft', 'honor-and-profit', 'lunar', 'order-and-chaos',
  'sansan', 'data-and-destiny', 'mumbad', 'flashpoint', 'red-sand', 'terminal-directive', 'core2', 'kitara', 'reign-and-reverie',
  'magnum-opus', 'napd']);
const PUBLISHERS = { nsg: 'Null Signal', ffg: 'FFG' };
// Set symbols come from NetrunnerDB's icon font, one per cycle (Downfall and Uprising share the Ashes symbol).
const setIcon = cycle => `<i class="set-icon ic-${esc(cycle || '')}" aria-hidden="true"></i>`;
const fcolor = f => (FACTIONS[f] || ['', '#888'])[1];
const fname = f => (FACTIONS[f] || [f])[0];

/* ---------- NetrunnerDB data ---------- */

const DB = { titles: new Map(), titleList: [], byCode: new Map(), packs: [], packByCode: new Map(), cycles: new Map(), tpl: '' };

function loadDB(raw) {
  DB.tpl = raw.imageUrlTemplate || 'https://card-images.netrunnerdb.com/v2/large/{code}.jpg';
  DB.fetched = raw.fetched;
  DB.cycles = new Map(raw.cycles.map(c => [c.code, { ...c, order: c.code === 'draft' ? 9999 : c.position }]));
  const packs = raw.packs.map(p => ({ ...p, cycle: DB.cycles.get(p.cycle_code), cards: [] }))
    .sort((a, b) => (a.cycle?.order ?? 9998) - (b.cycle?.order ?? 9998) || a.position - b.position);
  packs.forEach((p, i) => { p.order = i; p.publisher = FFG_CYCLES.has(p.cycle_code) ? 'ffg' : 'nsg'; });
  DB.packByCode = new Map(packs.map(p => [p.code, p]));
  DB.byCode = new Map();
  DB.titles = new Map();
  for (const c of raw.cards) {
    const pack = DB.packByCode.get(c.pack_code);
    if (!pack) continue;
    const card = { ...c, pack, key: norm(c.stripped_title || c.title) };
    DB.byCode.set(c.code, card);
    pack.cards.push(card);
    let t = DB.titles.get(card.key);
    if (!t) DB.titles.set(card.key, t = { key: card.key, printings: [] });
    t.printings.push(card);
  }
  for (const p of packs) p.cards.sort((a, b) => a.position - b.position);
  DB.packs = packs.filter(p => p.cards.length);
  for (const t of DB.titles.values()) {
    t.printings.sort((a, b) => a.pack.order - b.pack.order);
    const c = t.newest = t.printings[t.printings.length - 1];
    Object.assign(t, { title: c.title, side: c.side_code, faction: c.faction_code, type: c.type_code, deckLimit: c.deck_limit ?? 3 });
    t.rotated = t.printings.every(p => p.pack.cycle?.rotated);
    t.publishers = new Set(t.printings.map(p => p.pack.publisher));
    t.nameKey = norm(c.title);
    t.search = t.nameKey + ' ' + norm([c.stripped_text, c.keywords].join(' '));
  }
  DB.titleList = [...DB.titles.values()].sort((a, b) => a.title.localeCompare(b.title));
  const note = $('#db-note');
  if (note) note.textContent = `${DB.byCode.size} printings · ${DB.packs.length} products · fetched ${(DB.fetched || '').slice(0, 10)}`;
}

const imgUrl = (code, size = 'medium') => DB.tpl.replace('{code}', code).replace('/large/', `/${size}/`);

const NRDB_API = 'https://netrunnerdb.com/api/2.0/public/';
const NRDB_MAX_AGE = 7 * 24 * 3600e3;

// Fetches cards, cycles and packs straight from NetrunnerDB (it allows cross-origin requests) and caches them.
async function fetchNrdb() {
  const get = async name => {
    let r;
    try { r = await fetch(NRDB_API + name); } catch { throw new Error(offlineMsg('Could not reach NetrunnerDB.')); }
    if (!r.ok) throw new Error(`NetrunnerDB ${name}: HTTP ${r.status}`);
    return r.json();
  };
  const [cards, cycles, packs] = await Promise.all(['cards', 'cycles', 'packs'].map(get));
  const raw = {
    fetched: new Date().toISOString(), lastUpdated: cards.last_updated, imageUrlTemplate: cards.imageUrlTemplate,
    cycles: cycles.data, packs: packs.data, cards: cards.data,
  };
  await idb.put('nrdb', 'data', raw);
  channel?.postMessage({ type: 'nrdb' });
  return raw;
}

const offlineMsg = msg => navigator.onLine === false ? 'You are offline. ' + msg : msg;

/* ---------- storage (IndexedDB) ---------- */

// One database: the collection in `state`, cached NetrunnerDB data in `nrdb`, and `settings` for later use.
const idb = {
  conn: null,
  open() {
    return this.conn ||= new Promise((resolve, reject) => {
      const r = indexedDB.open('netrunner-collection', 1);
      r.onupgradeneeded = () => { for (const s of ['state', 'nrdb', 'settings']) r.result.createObjectStore(s); };
      r.onsuccess = () => {
        // Let a newer version of the app upgrade the database instead of blocking it.
        r.result.onversionchange = () => { r.result.close(); this.conn = null; };
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error('Close the app\'s other tabs and reload.'));
    });
  },
  async tx(store, mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      let out;
      fn(t.objectStore(store), v => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = t.onabort = () => reject(t.error || new Error('Storage aborted'));
    });
  },
  get(store, key) { return this.tx(store, 'readonly', (os, done) => { os.get(key).onsuccess = e => done(e.target.result); }); },
  put(store, key, v) { return this.tx(store, 'readwrite', os => os.put(v, key)); },
};

// Other open tabs reload the collection after this one saves, instead of later overwriting it with older data.
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('netrunner-collection') : null;

/* ---------- collection state ---------- */

let S = null;
// base: meta.updated of the version this tab last loaded or saved. A stored version with a different one was
// written by another tab, so this tab reloads rather than overwrite it.
let saveTimer = null, dirty = false, counted = false, base = null, flushing = Promise.resolve();

// Brings a stored or restored collection (version 1 or 2) up to the current format.
function migrate(s) {
  s = Object.assign({ owned: {}, decks: [], packStatus: {}, onboarded: false }, s);
  s.version = 2;
  s.meta = Object.assign({}, s.meta);
  if (!s.onboarded && Object.keys(s.owned).length) s.onboarded = true;
  return s;
}

// counts: the save changes the collection or decks, so it is a change a backup should cover.
// Lock, publisher and similar settings pass false.
function save(counts = true) {
  dirty = true;
  if (counts) counted = true;
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

// Saves run one after another, so a tab never mistakes its own previous save for another tab's.
function flush() {
  clearTimeout(saveTimer);
  return flushing = flushing.then(writeState);
}

async function writeState() {
  if (!dirty) return;
  const now = new Date().toISOString(), m = S.meta;
  m.updated = now;
  // meta.changed is the time of the last collection or deck change; restore compares it with the backup's date.
  if (counted) { m.changesSinceBackup = (m.changesSinceBackup || 0) + 1; m.changed = now; m.firstUnbackedChange ||= now; }
  dirty = counted = false;
  try {
    const ok = await idb.tx('state', 'readwrite', (os, done) => {
      os.get('collection').onsuccess = e => {
        const stored = e.target.result;
        if (stored && stored.meta?.updated !== base) return done(false);
        os.put(S, 'collection');
        done(true);
      };
    });
    if (!ok) {
      await reloadState();
      toast('The collection was changed in another tab, so this tab has reloaded it. Your last change here was not saved.');
      return;
    }
    base = now;
    channel?.postMessage({ type: 'state' });
    setSaveStatus('Saved');
    backupNote();
  } catch (e) {
    dirty = true;
    setSaveStatus('Not saved: ' + e.message, true);
  }
}

async function reloadState() {
  clearTimeout(saveTimer);
  dirty = counted = false;
  S = migrate(await idb.get('state', 'collection'));
  base = S.meta.updated ?? null;
  route();
}

function setSaveStatus(text, error) {
  const el = $('#save-status');
  el.textContent = text;
  el.classList.toggle('error', !!error);
}

// Phones kill hidden tabs without warning, so save as soon as the page is hidden. When it comes back,
// pick up anything another tab saved meanwhile (a frozen tab can miss the broadcast).
document.addEventListener('visibilitychange', async () => {
  if (!S) return;
  if (document.visibilityState === 'hidden') { if (dirty) flush(); return; }
  await flushing;
  const stored = await idb.get('state', 'collection');
  if (!dirty && stored && stored.meta?.updated !== base) reloadState();
});
window.addEventListener('beforeunload', e => { if (dirty) { flush(); e.preventDefault(); } });
channel?.addEventListener('message', async e => {
  if (!S) return;
  if (e.data.type === 'state') reloadState();
  if (e.data.type === 'nrdb') { loadDB(await idb.get('nrdb', 'data')); render(); }
});

const own = code => S.owned[code] || { n: 0, custom: 0 };

function setOwn(code, n, custom) {
  n = Math.max(0, n | 0);
  const c = Math.min(Math.max(0, (custom ?? own(code).custom) | 0), n);
  if (!n) delete S.owned[code];
  else S.owned[code] = { n, custom: c };
  save();
}

// The publisher setting hides the other publisher's products, and cards only they printed.
const pubOk = p => !S.publisher || S.publisher === 'all' || p.publisher === S.publisher;
const titleVisible = t => !S.publisher || S.publisher === 'all' || t.publishers.has(S.publisher);
const visiblePacks = () => DB.packs.filter(pubOk);

const titleOwned = key => DB.titles.get(key).printings.reduce((a, p) => a + own(p.code).n, 0);
const titleCustom = key => DB.titles.get(key).printings.reduce((a, p) => a + own(p.code).custom, 0);
const packOwned = p => p.cards.reduce((a, c) => a + (own(c.code).n ? 1 : 0), 0);
// Copies of this product's printings against one complete box, as Stats counts set completion
// (extra copies don't count, other printings don't either).
// What the side list's dot, the filter and the header show: none owned, some, or a complete box.
const packState = p => { const { have, need } = packCopies(p); return have >= need ? 'complete' : have ? 'some' : 'none'; };
const PACK_STATES = { none: ['Not owned', 'todo', ''], some: ['Incomplete', 'partial', '◐ '], complete: ['Complete', 'done', '✓ '] };
const packCopies = p => p.cards.reduce((a, c) => { const q = c.quantity || 1; a.need += q; a.have += Math.min(q, own(c.code).n); return a; }, { have: 0, need: 0 });

// The printing shown on a title tile and adjusted by its +/− buttons: newest one you own, else newest.
function mainPrinting(t) {
  const ps = t.printings.filter(p => pubOk(p.pack));
  const list = ps.length ? ps : t.printings;
  for (let i = list.length - 1; i >= 0; i--) if (own(list[i].code).n) return list[i];
  return list[list.length - 1];
}

function adjustTitle(key, d) {
  const t = DB.titles.get(key);
  const p = mainPrinting(t);
  if (d < 0 && !own(p.code).n) return;
  setOwn(p.code, own(p.code).n + d);
}

/* ---------- decks and availability ---------- */

function deckEntries(deck) {
  const m = new Map();
  for (const [code, q] of Object.entries(deck.cards)) {
    const card = DB.byCode.get(code);
    if (!card || q <= 0) continue;
    const e = m.get(card.key) || { key: card.key, code, qty: 0 };
    e.qty += q;
    m.set(card.key, e);
  }
  for (const e of m.values()) e.proxies = Math.min(e.qty, deck.proxies?.[e.key] || 0);
  return [...m.values()];
}

// Cards physically sitting in built decks, per title.
function computeLocks() {
  const locks = new Map();
  for (const d of S.decks) {
    if (!d.built) continue;
    for (const e of deckEntries(d)) {
      const qty = e.qty - e.proxies;
      if (qty <= 0) continue;
      if (!locks.has(e.key)) locks.set(e.key, []);
      locks.get(e.key).push({ deck: d, qty });
    }
  }
  return locks;
}

const lockedQty = (locks, key, exclude) => (locks.get(key) || []).reduce((a, l) => a + (l.deck === exclude ? 0 : l.qty), 0);

// For each card in the deck: how many come from free cards, how many from other built decks, how many must be printed.
function planDeck(deck, locks = computeLocks()) {
  const rows = [];
  const sum = { size: 0, have: 0, borrow: 0, print: 0, proxies: 0, decks: new Map(), printList: [] };
  for (const e of deckEntries(deck)) {
    const t = DB.titles.get(e.key);
    const owned = titleOwned(e.key);
    const need = e.qty - e.proxies;
    const others = (locks.get(e.key) || []).filter(l => l.deck !== deck);
    const elsewhere = others.reduce((a, l) => a + l.qty, 0);
    const have = Math.min(need, Math.max(0, owned - elsewhere));
    const print = need - Math.min(need, owned);
    let left = need - have - print;
    const borrow = [];
    for (const l of others) {
      if (left <= 0) break;
      const n = Math.min(left, l.qty);
      borrow.push({ deck: l.deck, n, has: l.qty });
      sum.decks.set(l.deck, (sum.decks.get(l.deck) || 0) + n);
      left -= n;
    }
    const borrowN = need - have - print;
    rows.push({ ...e, t, owned, need, have, borrow, borrowN, print });
    if (t.type !== 'identity') sum.size += e.qty;
    sum.have += have; sum.borrow += borrowN; sum.print += print; sum.proxies += e.proxies;
    if (print) sum.printList.push({ t, n: print });
  }
  sum.status = sum.print ? 'print' : sum.borrow ? 'borrow' : 'ok';
  return { rows, sum };
}

const deckIdentity = deck => deckEntries(deck).map(e => DB.titles.get(e.key)).find(t => t.type === 'identity');
function deckSide(deck) {
  const id = deckIdentity(deck);
  if (id) return id.side;
  const e = deckEntries(deck)[0];
  return e ? DB.titles.get(e.key).side : '';
}

function deckAdjust(deck, key, d) {
  const code = Object.keys(deck.cards).find(c => DB.byCode.get(c)?.key === key) || DB.titles.get(key).newest.code;
  const q = (deck.cards[code] || 0) + d;
  if (q <= 0) delete deck.cards[code]; else deck.cards[code] = q;
  const total = deckEntries(deck).find(e => e.key === key)?.qty || 0;
  if (deck.proxies?.[key] > total) deck.proxies[key] = total;
  if (deck.proxies && !deck.proxies[key]) delete deck.proxies[key];
}

function deckText(deck) {
  const rows = deckEntries(deck).map(e => ({ ...e, t: DB.titles.get(e.key) }));
  return TYPES.flatMap(type => {
    const rs = rows.filter(r => r.t.type === type);
    if (!rs.length) return [];
    return [`${TYPE_NAMES[type]} (${rs.reduce((a, r) => a + r.qty, 0)})`, ...rs.map(r => `${r.qty}x ${r.t.title}`), ''];
  }).join('\n').trim();
}

/* ---------- decklist parsing ---------- */

const NRDB_URL = /netrunnerdb\.com\/(?:[a-z]{2}\/)?(decklist|deck\/view)\/([A-Za-z0-9-]+)/i;

function matchTitle(s) {
  let k = norm(s), t = DB.titles.get(k);
  const tail = /\s*[([][^)\]]*[)\]]\s*$/;
  while (!t && tail.test(k)) { k = k.replace(tail, ''); t = DB.titles.get(k); }
  return t;
}

const isHeader = line => /^[\w &-]+\s*\(\d+\)$/.test(line) || /influence|cards up to|deck built|total|^\d+ cards/i.test(line);

function parseDeckText(text) {
  const cards = {}, unknown = [];
  let name = '';
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/[●•○◦★☆]/g, '').trim();
    if (!line) continue;
    let qty = 1, m, counted = false;
    if ((m = line.match(/^(\d+)\s*[x×]?\s+(.+)$/i))) { qty = +m[1]; line = m[2]; counted = true; }
    else if ((m = line.match(/^(.+?)\s+[x×]\s*(\d+)$/i))) { qty = +m[2]; line = m[1]; counted = true; }
    const t = matchTitle(line);
    if (t) {
      cards[t.newest.code] = (cards[t.newest.code] || 0) + qty;
    } else if (!counted && !name && !Object.keys(cards).length && !isHeader(line)) {
      name = line;
    } else if (counted || !isHeader(line)) {
      unknown.push(raw.trim());
    }
  }
  return { name, cards, unknown };
}

async function parseDeckInput(text) {
  const m = text.match(NRDB_URL);
  if (!m) return parseDeckText(text);
  const kind = m[1].toLowerCase() === 'decklist' ? 'decklist' : 'deck';
  let r;
  try { r = await fetch(`${NRDB_API}${kind}/${m[2]}`); }
  catch { throw new Error(offlineMsg('Could not reach NetrunnerDB to read the deck link. Paste the list as text instead.')); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.length) throw new Error('Deck not found on NetrunnerDB. Private decks must be shared to be readable.');
  const d = j.data[0];
  const cards = {}, unknown = [];
  for (const [code, q] of Object.entries(d.cards)) {
    if (DB.byCode.has(code)) cards[code] = q; else unknown.push(code);
  }
  return { name: d.name, cards, unknown, source: 'https://' + m[0] };
}

/* ---------- view state and routing ---------- */

const UI = {
  view: '', arg: '',
  filters: Object.assign({ q: '', side: '', faction: '', type: '', set: '', show: 'all', hideRotated: false, sort: 'name' }, store.get('filters', {})),
  setsFilter: store.get('setsFilter', 'all'), // all, none, some, complete (older values show all)
  setsHideRotated: store.get('setsHideRotated', false),
  wfocus: 0,
  welcome: { complete: {}, partial: {}, decks: '' },
  check: { text: '', result: null, error: '' },
  modal: null,
  // Stats screen options, remembered like the Collection filters.
  stats: Object.assign({ side: '', hideRotated: false, reprints: false, sort: 'release', hideUnowned: true }, store.get('stats', {})),
  statsAll: {}, // shopping lists opened with Show all (this visit only)
  only: null, // { label, keys }: a Stats tap limiting the Collection list to some titles; cleared on leaving it
};

function route() {
  const [view, ...rest] = location.hash.slice(1).split('/');
  UI.view = view || (S.onboarded ? 'collection' : 'welcome');
  UI.arg = decodeURIComponent(rest.join('/'));
  if (UI.view !== 'collection') UI.only = null;
  if (UI.view === 'sets' && !UI.arg) {
    const packs = visiblePacks();
    const next = packs.find(p => S.packStatus[p.code] === 'partial') || packs.find(p => packState(p) !== 'complete') || packs[0];
    location.replace('#sets/' + next.code);
    return;
  }
  render();
}

// Actions that change what you own. A locked collection refuses them; decks can still be built and edited.
const LOCKED_ACTS = new Set(['title-n', 'print-n', 'set-n', 'alt', 'pack-fill', 'add-list-open', 'add-list', 'welcome', 'w-finish', 'restore']);
const lockNote = '<p class="lock-note">Collection is locked, so counts can\'t be changed. Use the lock at the top to unlock it.</p>';
const LOCK_SVG = {
  true: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  false: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

function render() {
  const locked = !!S.locked, btn = $('#lock-btn');
  document.body.classList.toggle('locked', locked);
  btn.innerHTML = LOCK_SVG[locked];
  btn.title = locked ? 'Collection locked: tap to allow changes' : 'Lock collection against accidental changes';
  btn.setAttribute('aria-label', btn.title);
  btn.setAttribute('aria-pressed', locked);
  $('#menu-publisher').innerHTML = publisherSeg();
  backupNote();
  for (const a of $$('[data-nav]')) a.classList.toggle('on', a.dataset.nav === UI.view || (UI.view === 'deck' && a.dataset.nav === 'decks'));
  const app = $('#app');
  const views = { welcome: viewWelcome, collection: viewCollection, sets: viewSets, decks: viewDecks, deck: viewDeck, stats: viewStats };
  (views[UI.view] || viewCollection)(app);
  renderModal();
}

/* ---------- shared fragments ---------- */

// crossorigin: NetrunnerDB's image server allows it, and the service worker can then cache real responses
// (an opaque no-cors response counts as several MB against the storage quota).
function cardImg(code, title, size) {
  return `<img loading="lazy" crossorigin="anonymous" src="${imgUrl(code, size)}" alt=""><span class="ph">${esc(title)}</span>`;
}

function stepper(act, attrs, n, extra = '') {
  return `<span class="stepper ${extra}"><button data-act="${act}" ${attrs} data-d="-1" aria-label="Fewer">−</button><span class="n">${n}</span><button data-act="${act}" ${attrs} data-d="1" aria-label="More">+</button></span>`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3000);
}

/* ---------- welcome / onboarding ---------- */

function viewWelcome(app) {
  const W = UI.welcome;
  const cycles = groupByCycle(visiblePacks());
  app.innerHTML = `
  <div class="welcome">
    <h1>Let's catalogue your cards</h1>
    <p class="lead">Three quick steps. Nothing here is final: every count can be changed later.</p>
    ${isIOS && !isStandalone() ? `<p class="install-hint">On iPhone, tap Share → <b>Add to Home Screen</b> and use the app from there:
      Safari deletes the data of sites you haven't opened for 7 days, but not of home-screen apps.</p>` : ''}
    <p>Which products should this cover? ${publisherSeg()}</p>

    <section class="step">
      <h2><span class="num">1</span> Products you own</h2>
      <p>For each product, set how many <b>complete</b> copies you have. If you only have part of one, tick <b>Some</b>
        and you'll go through it card by card in step 3.</p>
      <div class="w-cycles">
        ${cycles.map(([cy, packs]) => `
          <div class="w-cycle">
            <h3>${setIcon(cy?.code)}${esc(cy?.name || 'Other')}${cy?.rotated ? ' <span class="tag">rotated</span>' : ''}</h3>
            ${packs.map(p => `
              <div class="w-pack ${W.complete[p.code] ? 'has' : ''} ${W.partial[p.code] ? 'some' : ''}">
                <span class="w-name">${esc(p.name)} <small>${p.cards.length} cards · ${(p.date_release || '').slice(0, 4)}</small></span>
                ${stepper('w-complete', `data-pack="${p.code}"`, W.complete[p.code] || 0)}
                <label class="w-some"><input type="checkbox" data-act="w-partial" data-pack="${p.code}" ${W.partial[p.code] ? 'checked' : ''}> Some</label>
              </div>`).join('')}
          </div>`).join('')}
      </div>
    </section>

    <section class="step">
      <h2><span class="num">2</span> Cards from starter or printed decks <small>(optional)</small></h2>
      <p>Paste deck lists (plain text, e.g. "3x Hedge Fund") or NetrunnerDB deck links, one link per line.
        Their cards are added on top of step 1.</p>
      <textarea id="w-decks" rows="6" placeholder="https://netrunnerdb.com/en/decklist/…&#10;or&#10;3x Hedge Fund&#10;2x Ice Wall">${esc(W.decks)}</textarea>
    </section>

    <section class="step">
      <h2><span class="num">3</span> Fill in the partial products</h2>
      <p id="w-summary">${welcomeSummary()}</p>
      <div class="row">
        <button class="primary" data-act="w-finish">Finish setup</button>
        <button data-act="w-skip">Skip. I'll add cards by hand.</button>
      </div>
    </section>
  </div>`;
}

function welcomeSummary() {
  const W = UI.welcome;
  const complete = Object.entries(W.complete).filter(([, k]) => k > 0);
  const partial = Object.keys(W.partial).filter(k => W.partial[k]);
  const cards = complete.reduce((a, [code, k]) => a + DB.packByCode.get(code).cards.reduce((s, c) => s + (c.quantity || 1) * k, 0), 0);
  const lists = W.decks.trim() ? ' Cards from the pasted lists are added too.' : '';
  if (!complete.length && !partial.length) return lists ? lists.trim() : 'Pick at least one product above, or skip.';
  return `${plural(complete.length, 'complete product')} (${cards} cards) will be added.${lists}` +
    (partial.length ? ` After that you'll go through ${plural(partial.length, 'partial product')} one card grid at a time.` : '');
}

async function finishWelcome() {
  const W = UI.welcome;
  W.decks = $('#w-decks').value;
  for (const [code, k] of Object.entries(W.complete)) {
    if (!k) continue;
    for (const c of DB.packByCode.get(code).cards) setOwn(c.code, (c.quantity || 1) * k);
    S.packStatus[code] = 'done';
  }
  for (const [code, on] of Object.entries(W.partial)) if (on && S.packStatus[code] !== 'done') S.packStatus[code] = 'partial';
  let added = 0;
  const failed = [];
  for (const chunk of splitDeckInputs(W.decks)) {
    try {
      const d = await parseDeckInput(chunk);
      for (const [code, q] of Object.entries(d.cards)) { setOwn(code, own(code).n + q); added += q; }
    } catch (e) { failed.push(e.message); }
  }
  S.onboarded = true;
  save();
  if (added) toast(`Added ${added} cards from deck lists.`);
  if (failed.length) alert('Some deck links could not be read:\n' + failed.join('\n'));
  const first = visiblePacks().find(p => S.packStatus[p.code] === 'partial');
  location.hash = first ? '#sets/' + first.code : '#collection';
}

// Deck links each count as one input; pasted text is split on blank lines between lists.
function splitDeckInputs(text) {
  const out = [];
  let buf = [];
  for (const line of text.split(/\r?\n/)) {
    if (NRDB_URL.test(line)) { out.push(line.trim()); continue; }
    buf.push(line);
  }
  if (buf.join('').trim()) out.push(buf.join('\n'));
  return out;
}

function publisherSeg() {
  const cur = S.publisher || 'all';
  return `<span class="seg">${[['all', 'All'], ['nsg', 'Null Signal only'], ['ffg', 'FFG only']]
    .map(([v, l]) => `<button class="${cur === v ? 'on' : ''}" data-act="publisher" data-v="${v}">${l}</button>`).join('')}</span>`;
}

function groupByCycle(packs) {
  const m = new Map();
  for (const p of packs) {
    if (!m.has(p.cycle_code)) m.set(p.cycle_code, [p.cycle, []]);
    m.get(p.cycle_code)[1].push(p);
  }
  return [...m.values()];
}

/* ---------- collection ---------- */

function filteredTitles(locks) {
  const f = UI.filters, q = norm(f.q);
  const list = DB.titleList.filter(t => {
    if (!titleVisible(t)) return false;
    if (f.side && t.side !== f.side) return false;
    if (f.faction && t.faction !== f.faction) return false;
    if (f.type && t.type !== f.type) return false;
    if (f.set && !t.printings.some(p => p.pack.cycle_code === f.set)) return false;
    if (f.hideRotated && t.rotated) return false;
    if (UI.only && !UI.only.keys.has(t.key)) return false;
    if (q && !t.search.includes(q)) return false;
    const n = titleOwned(t.key);
    switch (f.show) {
      case 'owned': return n > 0;
      case 'missing': return n === 0;
      case 'incomplete': return n > 0 && n < t.deckLimit;
      case 'alt': return titleCustom(t.key) > 0;
      case 'free': return n - lockedQty(locks, t.key) > 0;
      case 'used': return lockedQty(locks, t.key) > 0;
    }
    return true;
  });
  // Set order follows how cards sit in a binder: product release order, then card number.
  // Booster packs number their own cards from 1, so they go after the set's main run.
  const setKey = t => { const p = sortPrinting(t); return [p.pack.cycle?.order ?? 9998, /booster/i.test(p.pack.name), p.pack.order, p.position]; };
  if (f.sort === 'set') list.sort((a, b) => { const x = setKey(a), y = setKey(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]; });
  // Title matches before card-text matches.
  else if (q) list.sort((a, b) => (b.nameKey.includes(q) - a.nameKey.includes(q)) || a.title.localeCompare(b.title));
  return list;
}

// The printing a title is filed under: the one in the filtered set, else the one shown on the tile.
function sortPrinting(t) {
  return (UI.filters.set && t.printings.find(p => p.pack.cycle_code === UI.filters.set)) || mainPrinting(t);
}

function setLabel(t) {
  if (UI.filters.sort !== 'set') return '';
  const p = sortPrinting(t);
  return `<span class="setno muted" title="${esc(p.pack.name)} #${p.position}">${UI.filters.set ? '' : setIcon(p.pack.cycle_code)}${p.position}.</span> `;
}

// One entry per set symbol: a cycle, with all its products (Downfall + Uprising are both Ashes, numbered 1–130).
function setPicker() {
  const f = UI.filters, cur = DB.cycles.get(f.set);
  const sets = groupByCycle(visiblePacks()).filter(([cy]) => cy);
  return `<details class="dd" id="set-dd">
    <summary>${cur ? setIcon(cur.code) + esc(cur.name) : 'Any set'}</summary>
    <div class="dd-body">
      <button class="${f.set ? '' : 'on'}" data-act="f-set" data-v="">${setIcon('')}<span class="dd-name">Any set</span></button>
      ${sets.map(([cy, ps]) => `<button class="${f.set === cy.code ? 'on' : ''}" data-act="f-set" data-v="${cy.code}">${setIcon(cy.code)}<span class="dd-name">${esc(cy.name)}${
        ps.length > 1 || ps[0].name !== cy.name ? `<small>${ps.map(p => esc(p.name)).join(' · ')}</small>` : ''}</span></button>`).join('')}
    </div>
  </details>`;
}

function collectionStats(locks) {
  let cards = 0, titles = 0, alt = 0, used = 0;
  for (const o of Object.values(S.owned)) { cards += o.n; alt += o.custom; }
  let total = 0;
  for (const t of DB.titleList) if (titleVisible(t)) { total++; if (titleOwned(t.key)) titles++; }
  for (const ls of locks.values()) for (const l of ls) used += l.qty;
  return `<b>${cards}</b> cards · <b>${titles}</b> of ${total} titles · <b>${alt}</b> alt art · <b>${used}</b> in built decks`;
}

function viewCollection(app) {
  const f = UI.filters;
  const factions = f.side === 'corp' ? CORP_FACTIONS : f.side === 'runner' ? RUNNER_FACTIONS : [...RUNNER_FACTIONS, ...CORP_FACTIONS.filter(x => x !== 'neutral-corp')];
  const types = TYPES.filter(t => !f.side || (f.side === 'corp' ? !['event', 'hardware', 'resource', 'program'].includes(t) : !['agenda', 'asset', 'upgrade', 'operation', 'ice'].includes(t)));
  app.innerHTML = `
  <div class="toolbar">
    <input type="search" id="q" placeholder="Search titles and card text…" value="${esc(f.q)}" autofocus>
    <span class="seg">
      ${[['', 'All'], ['runner', 'Runner'], ['corp', 'Corp']].map(([v, l]) => `<button class="${f.side === v ? 'on' : ''}" data-act="f-side" data-v="${v}">${l}</button>`).join('')}
    </span>
    <select data-filter="faction"><option value="">Any faction</option>${factions.map(x => `<option value="${x}" ${f.faction === x ? 'selected' : ''}>${fname(x)}</option>`).join('')}</select>
    <select data-filter="type"><option value="">Any type</option>${types.map(x => `<option value="${x}" ${f.type === x ? 'selected' : ''}>${TYPE_NAMES[x]}</option>`).join('')}</select>
    ${setPicker()}
    <select data-filter="show">
      ${[['all', 'All cards'], ['owned', 'Owned'], ['missing', 'Not owned'], ['incomplete', 'Fewer than a playset'], ['alt', 'Has alt art'], ['free', 'Free (not in decks)'], ['used', 'In built decks']]
        .map(([v, l]) => `<option value="${v}" ${f.show === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <select data-filter="sort" aria-label="Sort">
      ${[['name', 'Sort by name'], ['set', 'Sort by set number']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <label class="check"><input type="checkbox" data-filter="hideRotated" ${f.hideRotated ? 'checked' : ''}> Hide rotated</label>
  </div>
  ${lockNote}
  ${UI.only ? `<p class="only-note">Showing only: ${esc(UI.only.label)} <button data-act="only-clear">Show all cards</button></p>` : ''}
  <div class="stats-row"><div class="stats" id="stats"></div><button data-act="add-list-open">+ Add cards from a list</button></div>
  <div id="results"></div>`;
  renderResults();
}

let resultsObserver = null;

function renderResults() {
  const locks = computeLocks();
  const list = filteredTitles(locks);
  UI.resultsCount = list.length;
  $('#stats').innerHTML = `${collectionStats(locks)} <span class="muted">· showing ${list.length}</span>`;
  // A list, not card images: browsing the collection downloads no images (images show in a card's details).
  const box = $('#results');
  box.innerHTML = '<table class="list"><thead><tr><th>Card</th><th>Type</th><th>Faction</th><th>Owned</th><th>Alt art</th><th>In decks</th><th>Free</th></tr></thead><tbody id="items"></tbody></table>';
  if (!list.length) box.innerHTML = '<p class="empty">No cards match these filters.</p>';
  const items = $('#items');
  let shown = 0;
  const more = () => {
    const chunk = list.slice(shown, shown + 150);
    shown += chunk.length;
    items.insertAdjacentHTML('beforeend', chunk.map(t => titleRow(t, locks)).join(''));
    if (shown >= list.length) resultsObserver?.disconnect();
  };
  resultsObserver?.disconnect();
  if (!items) return;
  more();
  const sentinel = document.createElement('div');
  box.append(sentinel);
  resultsObserver = new IntersectionObserver(es => { if (es[0].isIntersecting) more(); }, { rootMargin: '800px' });
  resultsObserver.observe(sentinel);
}

function titleRow(t, locks) {
  const n = titleOwned(t.key), alt = titleCustom(t.key), used = lockedQty(locks, t.key);
  return `<tr data-key="${esc(t.key)}" class="${n ? '' : 'unowned'}">
    <td><span class="dot" style="--fc:${fcolor(t.faction)}"></span>${setLabel(t)}<a href="javascript:" data-act="card" data-key="${esc(t.key)}">${esc(t.title)}</a></td>
    <td>${TYPE_NAMES[t.type] || t.type}</td><td>${fname(t.faction)}</td>
    <td>${stepper('title-n', `data-key="${esc(t.key)}"`, n)}</td>
    <td>${alt || ''}</td><td>${used || ''}</td><td>${n ? Math.max(0, n - used) : ''}</td>
  </tr>`;
}

/* ---------- add by set (wizard) ---------- */

function viewSets(app) {
  const pack = DB.packByCode.get(UI.arg) || visiblePacks()[0];
  if (UI.setsPack !== pack.code) { UI.setsPack = pack.code; UI.wfocus = 0; }
  // "N missing": only the cards short of a complete box, picked when it's turned on. A card you then fix stays
  // in view, so the grid doesn't jump while you edit.
  if (UI.setsShort?.pack !== pack.code) UI.setsShort = null;
  else UI.setsShort.codes ||= new Set(pack.cards.filter(c => own(c.code).n < (c.quantity || 1)).map(c => c.code));
  const cards = UI.setsShort ? pack.cards.filter(c => UI.setsShort.codes.has(c.code)) : pack.cards;
  const state = packState(pack);
  app.innerHTML = `
  <div class="sets">
    <aside class="sets-side" id="sets-side">${setsSidebar(pack)}</aside>
    <section class="sets-main">
      <div class="pack-head">
        <select class="pack-jump" id="pack-jump" aria-label="Product">${groupByCycle(visiblePacks()).map(([cy, ps]) =>
          `<optgroup label="${esc(cy?.name || 'Other')}">${ps.map(p => `<option value="${p.code}" ${p === pack ? 'selected' : ''}>${packOption(p)}</option>`).join('')}</optgroup>`).join('')}
        </select>
        <div>
          <h1>${setIcon(pack.cycle_code)}${esc(pack.name)}</h1>
          <div class="muted"><span class="hide-sm">${esc(pack.cycle?.name || '')} · released ${esc(pack.date_release || '?')} ·</span> ${plural(pack.cards.length, 'card')}
            · <span id="pack-progress">${packCopiesText(pack)}</span>
            · <span id="pack-state">${statePill(state)}</span></div>
        </div>
        <div class="pack-actions">
          <button data-act="pack-fill" data-k="1" title="Every card at least as many copies as came in the box">Own it complete</button>
          <button data-act="pack-fill" data-k="0">Clear</button>
          <button class="primary top-done" data-act="pack-done">Next →</button>
        </div>
      </div>
      ${lockNote}
      <p class="hint">Click a card or use the keyboard: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move ·
        <kbd>0</kbd>–<kbd>9</kbd> set count · <kbd>+</kbd>/<kbd>−</kbd> adjust · <kbd>A</kbd>/<kbd>Shift+A</kbd> alt art ·
        <kbd>Enter</kbd> next product</p>
      ${UI.setsShort ? `<p class="only-note">Showing only ${plural(cards.length, 'card')} short of a complete box
        <button data-act="sets-short" data-v="">Show all cards</button></p>` : ''}
      <div class="pgrid" id="pgrid">${cards.map((c, i) => printTile(c, i)).join('')}</div>
      <div class="pack-bar">
        <span id="pack-bar-progress">${packProgress(pack)}</span>
        <button class="primary" data-act="pack-done">Next →</button>
      </div>
    </section>
  </div>`;
  const side = $('#sets-side'), cur = $('.prow.cur', side);
  if (cur) side.scrollTop = cur.offsetTop - side.clientHeight / 2;
  window.scrollTo(0, 0);
}

const packProgress = p => `<b>${packOwned(p)}</b> of ${p.cards.length} cards owned`;
// "230 / 231 copies · 1 missing", the missing part showing only the cards short of the box.
function packCopiesText(p) {
  const { have, need } = packCopies(p), miss = need - have;
  return `${have} / ${need} copies${have && miss ? ` · <a href="javascript:" data-act="sets-short" data-v="${p.code}">${miss} missing</a>` : ''}`;
}

// In the side list: copies an incomplete product is short of a complete box.
function sideMissing(p) {
  const { have, need } = packCopies(p);
  return have && have < need ? ` <span class="pmiss" title="${need - have} copies short of a complete box">−${need - have}</span>` : '';
}

const statePill = state => `<span class="pill ${PACK_STATES[state][1]}">${PACK_STATES[state][0]}</span>`;
const packOption = p => `${PACK_STATES[packState(p)][2]}${esc(p.name)} (${packOwned(p)}/${p.cards.length})`;

function setsSidebar(cur) {
  const f = UI.setsFilter;
  const packs = DB.packs.filter(p => {
    if (!pubOk(p) && p !== cur) return false;
    if (UI.setsHideRotated && p.cycle?.rotated && p !== cur) return false;
    return !PACK_STATES[f] || p === cur || packState(p) === f;
  });
  return `
    <div class="seg small">${[['all', 'All'], ['none', 'Not owned'], ['some', 'Incomplete'], ['complete', 'Complete']]
      .map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-act="sets-filter" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-act="sets-rotated" ${UI.setsHideRotated ? 'checked' : ''}> Hide rotated</label>
    ${groupByCycle(packs).map(([cy, ps]) => `
      <div class="cyc"><div class="cyc-h">${setIcon(cy?.code)}${esc(cy?.name || 'Other')} <span class="pub">${PUBLISHERS[ps[0].publisher]}</span></div>
      ${ps.map(p => `<a class="prow ${p === cur ? 'cur' : ''} ${PACK_STATES[packState(p)][1]}" href="#sets/${p.code}">
        <span class="sdot"></span><span class="pname">${esc(p.name)}</span><span class="pcount">${packOwned(p)}/${p.cards.length}${sideMissing(p)}</span></a>`).join('')}
      </div>`).join('')}`;
}

function printTile(c, i) {
  const o = own(c.code), tot = titleOwned(c.key);
  const seg = [0, 1, 2, 3].map(k => `<button class="${o.n === k ? 'on' : ''}" data-act="set-n" data-code="${c.code}" data-n="${k}">${k}</button>`).join('')
    + `<button class="${o.n > 3 ? 'on' : ''}" data-act="set-n" data-code="${c.code}" data-n="${o.n + 1}" title="More">${o.n > 3 ? o.n : '+'}</button>`;
  return `<div class="ptile ${o.n ? '' : 'unowned'} ${i === UI.wfocus ? 'focus' : ''}" data-code="${c.code}" data-key="${esc(c.key)}" data-i="${i}" style="--fc:${fcolor(c.faction_code)}">
    <button class="tile-img" data-act="focus" data-i="${i}">
      ${cardImg(c.code, c.title)}
      ${o.custom ? `<span class="badge alt">${o.custom} alt art</span>` : ''}
    </button>
    <div class="tile-name"><span class="muted">${c.position}.</span> ${esc(c.title)}</div>
    <div class="pt-sub">${c.quantity || 1} in box${tot > o.n ? ` · ${tot} owned in total` : ''}
      · <a href="javascript:" data-act="card" data-key="${esc(c.key)}">details</a></div>
    <div class="seg count">${seg}</div>
    <div class="altrow">Alt art ${stepper('alt', `data-code="${c.code}"`, o.custom, 'small')}</div>
  </div>`;
}

function setFocus(i, scroll = true) {
  const tiles = $$('.ptile');
  if (!tiles.length) return;
  UI.wfocus = Math.max(0, Math.min(tiles.length - 1, i));
  tiles.forEach((t, j) => t.classList.toggle('focus', j === UI.wfocus));
  if (scroll) tiles[UI.wfocus].scrollIntoView({ block: 'nearest' });
}

function nextPack() {
  const packs = visiblePacks();
  const i = packs.findIndex(p => p.code === UI.setsPack);
  const order = [...packs.slice(i + 1), ...packs.slice(0, i)];
  // Products ticked as "Some" in setup and not gone through yet first, then the next one that isn't a complete box.
  const todo = order.filter(p => !(UI.setsHideRotated && p.cycle?.rotated));
  const next = todo.find(p => S.packStatus[p.code] === 'partial') || todo.find(p => packState(p) !== 'complete');
  if (next) location.hash = '#sets/' + next.code;
  else { toast('Every product is complete.'); render(); }
}

function onSetsKey(e) {
  if (UI.view !== 'sets' || UI.modal || e.target.closest('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  const tiles = $$('.ptile');
  const tile = tiles[UI.wfocus];
  if (!tile) return;
  const code = tile.dataset.code, o = own(code);
  const cols = tiles.filter(t => t.offsetTop === tiles[0].offsetTop).length || 1;
  const k = e.key;
  if (S.locked && /^([0-9]|[-+=_aA])$/.test(k)) { e.preventDefault(); return toast('Collection is locked. Use the lock at the top to change counts.'); }
  if (/^[0-9]$/.test(k)) setOwn(code, +k);
  else if (k === '+' || k === '=') setOwn(code, o.n + 1);
  else if (k === '-' || k === '_') setOwn(code, o.n - 1);
  else if (k === 'a') setOwn(code, o.n, o.custom >= o.n ? 0 : o.custom + 1);
  else if (k === 'A') setOwn(code, o.n, o.custom - 1);
  else if (k === 'ArrowRight') return e.preventDefault(), setFocus(UI.wfocus + 1);
  else if (k === 'ArrowLeft') return e.preventDefault(), setFocus(UI.wfocus - 1);
  else if (k === 'ArrowDown') return e.preventDefault(), setFocus(UI.wfocus + cols);
  else if (k === 'ArrowUp') return e.preventDefault(), setFocus(UI.wfocus - cols);
  else if (k === 'Enter') return e.preventDefault(), act.packDone();
  else return;
  e.preventDefault();
  refresh(DB.byCode.get(code).key);
}

/* ---------- decks ---------- */

function statusText(sum, built) {
  if (built && sum.status !== 'ok') {
    const n = sum.borrow + sum.print;
    return `Built, but ${n} ${n === 1 ? 'card is' : 'cards are'} short: ` +
      [sum.print && `${sum.print} not owned`, sum.borrow && `${sum.borrow} also in ${[...sum.decks.keys()].map(d => esc(d.name)).join(', ')}`].filter(Boolean).join(', ') + '.';
  }
  if (built) return `Built: ${plural(sum.have, 'card')} borrowed from your collection${sum.proxies ? `, ${sum.proxies} printed` : ''}.`;
  if (sum.status === 'ok') return `Ready to build from free cards${sum.proxies ? ` (plus ${sum.proxies} printed)` : ''}.`;
  const parts = [];
  if (sum.borrow) parts.push(`take ${sum.borrow} from ${[...sum.decks.keys()].map(d => esc(d.name)).join(', ')}`);
  if (sum.print) parts.push(`print ${sum.print}`);
  return 'To build: ' + parts.join(' and ') + '.';
}

function deckBadge(sum, built) {
  if (built) return `<span class="pill built">Built</span>${sum.status !== 'ok' ? ' <span class="pill print">Conflict</span>' : ''}`;
  return sum.status === 'ok' ? '<span class="pill ok">Buildable</span>'
    : `${sum.borrow ? `<span class="pill borrow">${sum.borrow} in other decks</span>` : ''} ${sum.print ? `<span class="pill print">${sum.print} to print</span>` : ''}`;
}

function viewDecks(app) {
  const locks = computeLocks();
  const C = UI.check;
  const built = S.decks.filter(d => d.built);
  app.innerHTML = `
  <div class="decks">
    <section class="check-panel">
      <h2>Can I build this?</h2>
      <p class="muted">Paste a deck list (plain text from NetrunnerDB, Jinteki.net, …) or a NetrunnerDB deck link.</p>
      <textarea id="check-in" rows="6" placeholder="https://netrunnerdb.com/en/decklist/…&#10;or&#10;Zahya Sadeghi: Versatile Smuggler&#10;3x Sure Gamble&#10;…">${esc(C.text)}</textarea>
      <div class="row">
        <button class="primary" data-act="check">Check</button>
        <button data-act="check-save" ${C.result ? '' : 'disabled'}>Save as deck</button>
        <button data-act="deck-new">New empty deck</button>
      </div>
      <div id="check-out">${C.error ? `<p class="error">${esc(C.error)}</p>` : C.result ? checkResult(C.result, locks) : ''}</div>
    </section>
    <section>
      <h2>Your decks <span class="muted">${S.decks.length ? `· ${built.length} built, holding ${[...locks.values()].flat().reduce((a, l) => a + l.qty, 0)} cards` : ''}</span></h2>
      ${S.decks.length ? `<div class="deck-grid">${S.decks.map(d => deckCard(d, locks)).join('')}</div>`
        : '<p class="empty">No decks yet. Check a list above and save it, or start an empty deck.</p>'}
    </section>
  </div>`;
}

function checkResult(deck, locks) {
  const { rows, sum } = planDeck(deck, locks);
  const problems = rows.filter(r => r.print || r.borrowN);
  return `
    <div class="banner ${sum.status}">${esc(deck.name || 'Deck')}: ${plural(sum.size, 'card')} · ${statusText(sum, false)}</div>
    ${problems.length ? `<table class="list compact"><tbody>${problems.map(r => planRow(r, null)).join('')}</tbody></table>` : ''}
    ${deck.unknown?.length ? `<details class="unknown"><summary>${plural(deck.unknown.length, 'line')} not recognised</summary><pre>${esc(deck.unknown.join('\n'))}</pre></details>` : ''}`;
}

function deckCard(d, locks) {
  const { sum } = planDeck(d, locks);
  const id = deckIdentity(d);
  return `<a class="deck-card ${d.built ? 'is-built' : ''}" href="#deck/${d.id}" style="--fc:${id ? fcolor(id.faction) : '#888'}">
    <div class="deck-id">${id ? cardImg(id.newest.code, id.title, 'small') : '<span class="ph">No identity</span>'}</div>
    <div class="deck-info">
      <b>${esc(d.name || 'Untitled deck')}</b>
      <span class="muted">${id ? esc(id.title) : ''}</span>
      <span class="muted">${plural(sum.size, 'card')}</span>
      <span>${deckBadge(sum, d.built)}</span>
    </div>
  </a>`;
}

function planRow(r, deck) {
  const t = r.t;
  const status = [];
  if (r.print) status.push(`<span class="st print">print ${r.print}</span>`);
  for (const b of r.borrow) status.push(`<span class="st borrow">take ${b.n} of the ${b.has} in <a href="#deck/${b.deck.id}">${esc(b.deck.name)}</a></span>`);
  if (r.proxies) status.push(`<span class="st proxy">${r.proxies} printed${deck ? ` <button class="x" data-act="unproxy" data-key="${esc(r.key)}" title="Stop counting as printed">×</button>` : ''}</span>`);
  if (!r.print && !r.borrowN) status.push('<span class="st ok">✓</span>');
  return `<tr data-key="${esc(r.key)}">
    <td class="q">${deck ? stepper('deck-q', `data-key="${esc(r.key)}"`, r.qty) : r.qty + '×'}</td>
    <td><span class="dot" style="--fc:${fcolor(t.faction)}"></span><a href="javascript:" data-act="card" data-key="${esc(r.key)}">${esc(t.title)}</a></td>
    <td class="muted">owned ${r.owned}</td>
    <td>${status.join(' ')}</td>
  </tr>`;
}

function viewDeck(app) {
  const deck = S.decks.find(d => d.id === UI.arg);
  if (!deck) { app.innerHTML = '<p class="empty">Deck not found. <a href="#decks">Back to decks</a></p>'; return; }
  const { rows, sum } = planDeck(deck);
  const id = deckIdentity(deck);
  const side = deckSide(deck);
  app.innerHTML = `
  <div class="deck-page">
    <a href="#decks" class="back">← Decks</a>
    <div class="deck-head">
      <div class="deck-id big">${id ? cardImg(id.newest.code, id.title) : '<span class="ph">No identity</span>'}</div>
      <div class="deck-meta">
        <input class="deck-name" data-deck-field="name" value="${esc(deck.name)}" placeholder="Deck name">
        <div class="muted">${side ? side[0].toUpperCase() + side.slice(1) : 'No cards yet'} · ${plural(sum.size, 'card')}
          ${deck.source ? ` · <a href="${esc(deck.source)}" target="_blank" rel="noopener">source</a>` : ''}</div>
        <div class="banner ${deck.built ? (sum.status === 'ok' ? 'built' : 'print') : sum.status}">${statusText(sum, deck.built)}</div>
        <div class="row">
          ${deck.built
            ? '<button class="primary" data-act="deck-unbuild">Deconstruct (return cards)</button>'
            : `<button class="primary" data-act="deck-build">${sum.status === 'ok' ? 'Build it (borrow cards)' : sum.print ? 'Build with printed cards…' : 'Take apart other decks and build…'}</button>`}
          ${!deck.built ? [...sum.decks.entries()].map(([d, n]) => `<button data-act="deck-unbuild" data-id="${d.id}">Deconstruct ${esc(d.name)} <span class="muted">(has ${n} you need)</span></button>`).join('') : ''}
          ${sum.print ? `<button data-act="show-print">Print list (${sum.print})</button>` : ''}
          <button data-act="copy-deck">Deck list</button>
          <button class="danger" data-act="deck-delete">Delete</button>
        </div>
        <textarea class="notes" data-deck-field="notes" rows="2" placeholder="Notes (e.g. which sleeves, which alt arts)">${esc(deck.notes || '')}</textarea>
      </div>
    </div>
    <div class="add-card">
      <input id="deck-add" placeholder="Add a card by name…" autocomplete="off">
      <div id="deck-add-results" class="ac"></div>
    </div>
    ${TYPES.map(type => {
      const rs = rows.filter(r => r.t.type === type);
      if (!rs.length) return '';
      return `<h3>${TYPE_NAMES[type]} <span class="muted">${rs.reduce((a, r) => a + r.qty, 0)}</span></h3>
        <table class="list compact"><tbody>${rs.map(r => planRow(r, deck)).join('')}</tbody></table>`;
    }).join('')}
  </div>`;
}

function addCardResults(q, deck) {
  const side = deckSide(deck);
  const k = norm(q);
  if (!k) return '';
  const hits = DB.titleList.filter(t => t.nameKey.includes(k) && (!side || t.side === side) && titleVisible(t))
    .sort((a, b) => b.nameKey.startsWith(k) - a.nameKey.startsWith(k)).slice(0, 10);
  return hits.map((t, i) => `<button class="${i ? '' : 'first'}" data-act="deck-add" data-key="${esc(t.key)}">
    <span class="dot" style="--fc:${fcolor(t.faction)}"></span>${esc(t.title)} <span class="muted">${TYPE_NAMES[t.type]} · owned ${titleOwned(t.key)}</span></button>`).join('');
}

/* ---------- statistics ---------- */

// Percent for display. Rounds down, so nothing short of complete ever reads 100%.
const pct = (a, b) => !b ? 0 : a >= b ? 100 : Math.floor(100 * a / b);
// Order of the By faction chart: Runner factions, then Corp, then the two neutrals.
const STATS_FACTIONS = ['anarch', 'criminal', 'shaper', 'adam', 'apex', 'sunny-lebeau',
  'haas-bioroid', 'jinteki', 'nbn', 'weyland-consortium', 'neutral-runner', 'neutral-corp'];
const STATS_TYPES = { runner: ['identity', 'event', 'hardware', 'resource', 'program'], corp: ['identity', 'agenda', 'asset', 'upgrade', 'operation', 'ice'] };
const STATS_TOP = 10;

// Walks the card data once and returns every number the Stats screen shows. Nothing here is stored.
// o: the screen's options (side, hideRotated, reprints).
function statsFor(o) {
  const locks = computeLocks();
  const titleOk = t => titleVisible(t) && (!o.side || t.side === o.side) && !(o.hideRotated && t.rotated);
  // Draft identities aren't legal in normal decks, so the Draft product is not a set here.
  const packOk = p => pubOk(p) && p.cycle_code !== 'draft' && !(o.hideRotated && p.cycle?.rotated);
  const s = { cards: 0, titles: 0, titlesAll: 0, playsets: 0, alt: 0, spare: 0, inDecks: 0, proxies: 0, unknown: 0,
    factions: new Map(), types: new Map(), sets: [], short: new Map(), deckBars: [], decks: 0 };
  const group = (m, k) => m.get(k) || m.set(k, { titles: 0, owned: 0, full: 0, cards: 0 }).get(k);

  // Copies of codes the card data doesn't know (a restore with old codes) count in Cards only.
  for (const [code, x] of Object.entries(S.owned)) if (!DB.byCode.has(code)) s.unknown += x.n;
  if (!o.side) s.cards += s.unknown;

  for (const t of DB.titleList) {
    if (!titleOk(t)) continue;
    const n = titleOwned(t.key), full = n >= t.deckLimit;
    s.titlesAll++;
    s.cards += n;
    s.alt += titleCustom(t.key);
    s.spare += Math.max(0, n - t.deckLimit);
    s.inDecks += Math.min(n, lockedQty(locks, t.key));
    if (n) s.titles++;
    if (full) s.playsets++;
    for (const g of [group(s.factions, t.faction), group(s.types, t.side + ':' + t.type)]) {
      g.titles++; g.cards += n;
      if (n) g.owned++;
      if (full) g.full++;
    }
  }

  // One complete box as sold: need is the card's quantity in the product, have is capped at it.
  for (const p of DB.packs) {
    if (!packOk(p)) continue;
    const cs = p.cards.filter(c => !o.side || c.side_code === o.side);
    if (!cs.length) continue;
    let have = 0, need = 0;
    for (const c of cs) {
      const q = c.quantity || 1;
      need += q;
      have += Math.min(q, o.reprints ? titleOwned(c.key) : own(c.code).n);
    }
    s.sets.push({ p, have, need });
  }

  // planDeck once per deck, shared by the deck bars, short-for-decks and the shopping list.
  for (const d of S.decks) {
    if (o.side && deckSide(d) !== o.side) continue;
    s.decks++;
    const { rows, sum } = planDeck(d, locks);
    if (d.built) s.deckBars.push({ d, n: sum.have });
    for (const r of rows) {
      if (titleOk(r.t)) s.proxies += r.proxies;
      if (!r.print) continue;
      // Each title once, at the most copies any one deck is short of.
      const x = s.short.get(r.key) || s.short.set(r.key, { t: r.t, n: 0, unbuilt: 0, decks: 0 }).get(r.key);
      x.decks++;
      x.n = Math.max(x.n, r.print);
      if (!d.built) x.unbuilt = Math.max(x.unbuilt, r.print);
    }
  }
  s.deckBars.sort((a, b) => b.n - a.n);
  return s;
}

// A bar: coloured segments on a track (the empty rest is "missing"), with its numbers as text beside it.
// parts: [{ pct, color, cls }]. The label is the readable value; the track is decoration.
function bar(parts, label) {
  return `<span class="sx-track" aria-hidden="true">${parts.map(p =>
    `<i class="${p.cls || ''}" style="width:${Math.max(0, Math.min(100, p.pct))}%${p.color ? `;--c:${p.color}` : ''}"></i>`).join('')}</span>
    <span class="sx-val">${label}</span>`;
}

// A donut of parts [{ n, color }] (circle strokes on a circumference of 100), with `center` in the hole.
function donut(parts, center) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  let at = 0;
  const ring = (color, len, off) => `<circle cx="18" cy="18" r="15.915" fill="none" stroke-width="5" style="stroke:${color}"
    stroke-dasharray="${len} ${100 - len}" stroke-dashoffset="${25 - off}"/>`;
  const arcs = total ? parts.map(p => { const len = 100 * p.n / total, s = len ? ring(p.color, len, at) : ''; at += len; return s; }) : [];
  return `<svg class="sx-donut" viewBox="0 0 36 36" aria-hidden="true">${ring('var(--panel2)', 100, 0)}${arcs.join('')}
    <text x="18" y="18" text-anchor="middle" dominant-baseline="central">${center}</text></svg>`;
}

const sxTile = (label, value, sub = '') => `<div class="sx-tile"><div class="sx-tl">${label}</div><div class="sx-tv">${value}</div>${sub ? `<div class="sx-ts">${sub}</div>` : ''}</div>`;
// Owned titles as two segments: a full playset solid, fewer than a playset lighter.
const playsetParts = (g, color) => [{ pct: 100 * g.full / g.titles, color }, { pct: 100 * (g.owned - g.full) / g.titles, color, cls: 'part' }];
const sxMore = (key, n) => n > STATS_TOP ? `<button class="sx-more" data-act="st-all" data-v="${key}">${UI.statsAll[key] ? 'Show fewer' : `Show all ${n}`}</button>` : '';

function viewStats(app) {
  const o = UI.stats;
  if (!Object.keys(S.owned).length) {
    app.innerHTML = `<div class="sx"><h1>Stats</h1>
      <p class="empty">Add some cards first: <a href="#welcome">run setup</a> or <a href="#sets">add by set</a>.</p></div>`;
    return;
  }
  const s = statsFor(o);
  const complete = s.sets.filter(x => x.have >= x.need).length;
  app.innerHTML = `
  <div class="sx">
    <div class="toolbar sx-opts">
      <span class="seg">${[['', 'All'], ['runner', 'Runner'], ['corp', 'Corp']].map(([v, l]) =>
        `<button class="${o.side === v ? 'on' : ''}" data-act="st-side" data-v="${v}">${l}</button>`).join('')}</span>
      <label class="check"><input type="checkbox" data-stat="hideRotated" ${o.hideRotated ? 'checked' : ''}> Hide rotated</label>
      <span class="sx-pub"><span class="muted">Products</span> ${publisherSeg()}</span>
    </div>
    <div class="sx-tiles">
      ${sxTile('Cards', s.cards)}
      ${sxTile('Titles', `${s.titles} <small>/ ${s.titlesAll}</small>`, `${pct(s.titles, s.titlesAll)}% owned`)}
      ${sxTile('Playsets', `${s.playsets} <small>/ ${s.titlesAll}</small>`, `${pct(s.playsets, s.titlesAll)}% of titles`)}
      ${sxTile('Sets complete', `${complete} <small>/ ${s.sets.length}</small>`, o.reprints ? 'counting reprints' : 'this printing only')}
      ${sxTile('Alt art', s.alt, `${pct(s.alt, s.cards)}% of cards`)}
      ${sxTile('Spare', s.spare, 'beyond a playset')}
    </div>
    ${s.unknown ? `<p class="muted">${plural(s.unknown, 'card')} not in the card data. ${s.unknown === 1 ? 'It counts' : 'They count'} in Cards${o.side ? ' (with no side picked)' : ''} only.</p>` : ''}
    ${statsSets(s, o)}
    ${statsDecks(s)}
    <div class="sx-cols">${statsFactions(s)}${statsTypes(s, o)}</div>
    ${statsShopping(s)}
  </div>`;
}

function statsSets(s, o) {
  const sets = o.hideUnowned ? s.sets.filter(x => x.have) : s.sets;
  const row = (x, icon) => `<a class="sx-row ${x.have ? '' : 'faded'}" href="#sets/${x.p.code}">
    <span class="sx-name">${icon ? setIcon(x.p.cycle_code) : ''}${esc(x.p.name)}</span>
    ${bar([{ pct: 100 * x.have / x.need }], `${x.have} / ${x.need} · ${pct(x.have, x.need)}%`)}</a>`;
  let rows;
  if (o.sort === 'release') {
    // Grouped by cycle; a cycle of several products gets its own total bar.
    const cycles = new Map();
    for (const x of sets) (cycles.get(x.p.cycle_code) || cycles.set(x.p.cycle_code, []).get(x.p.cycle_code)).push(x);
    rows = [...cycles.values()].map(xs => {
      if (xs.length === 1) return row(xs[0], true);
      const cy = xs[0].p.cycle, have = xs.reduce((a, x) => a + x.have, 0), need = xs.reduce((a, x) => a + x.need, 0);
      return `<div class="sx-row sx-cyc ${have ? '' : 'faded'}"><span class="sx-name">${setIcon(cy?.code)}${esc(cy?.name || 'Other')}</span>
        ${bar([{ pct: 100 * have / need }], `${have} / ${need} · ${pct(have, need)}%`)}</div>
        ${xs.map(x => row(x, false)).join('')}`;
    }).join('');
  } else {
    const key = o.sort === 'pct' ? x => x.have / x.need : x => x.need - x.have;
    rows = [...sets].sort((a, b) => key(b) - key(a) || a.p.order - b.p.order).map(x => row(x, true)).join('');
  }
  return `<section class="sx-sec">
    <h2>Set completion</h2>
    <p class="muted">One complete box as sold is 100%: the copies of each card the product came with.</p>
    <div class="toolbar">
      <label class="check" title="Count copies from any printing of a title"><input type="checkbox" data-stat="reprints" ${o.reprints ? 'checked' : ''}> Count reprints</label>
      <select data-stat="sort" aria-label="Sort sets">${[['release', 'Release order'], ['pct', '% complete'], ['missing', 'Most missing']]
        .map(([v, l]) => `<option value="${v}" ${o.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" data-stat="hideUnowned" ${o.hideUnowned ? 'checked' : ''}> Hide sets I don't own</label>
    </div>
    ${rows ? `<div class="sx-bars">${rows}</div>` : '<p class="muted">No sets match these options.</p>'}
  </section>`;
}

function statsDecks(s) {
  const free = s.cards - s.inDecks;
  const legend = [['Free', free, 'var(--accent)'], ['In built decks', s.inDecks, 'var(--built)']].map(([l, n, c]) =>
    `<li><span class="sx-sw" style="background:${c}"></span>${l} <b>${n}</b> <span class="muted">${pct(n, s.cards)}%</span></li>`).join('');
  const max = Math.max(1, ...s.deckBars.map(x => x.n));
  const short = [...s.short.values()].filter(x => x.unbuilt);
  const shortN = short.reduce((a, x) => a + x.unbuilt, 0);
  const unbuilt = S.decks.some(d => !d.built);
  return `<section class="sx-sec">
    <h2>Free vs in decks</h2>
    <div class="sx-donut-row">
      ${donut([{ n: free, color: 'var(--accent)' }, { n: s.inDecks, color: 'var(--built)' }], s.cards)}
      <ul class="sx-legend">${legend}
        ${s.proxies ? `<li><span class="sx-sw proxy"></span>Proxies <b>${s.proxies}</b> <span class="muted">printed, not counted</span></li>` : ''}</ul>
    </div>
    ${!S.decks.length ? '<p class="muted">No decks yet. Add one under <a href="#decks">Decks</a>.</p>' : `
      <h3>Per built deck</h3>
      ${s.deckBars.length ? `<div class="sx-bars">${s.deckBars.map(({ d, n }) => {
        const id = deckIdentity(d), c = id ? fcolor(id.faction) : '#888';
        return `<a class="sx-row" href="#deck/${d.id}"><span class="sx-name"><span class="dot" style="--fc:${c}"></span>${esc(d.name || 'Untitled deck')}</span>
          ${bar([{ pct: 100 * n / max, color: c }], `${plural(n, 'card')}`)}</a>`;
      }).join('')}</div>` : '<p class="muted">No built decks.</p>'}
      <h3>Short for saved decks</h3>
      <p>${!unbuilt ? '<span class="muted">Every saved deck is built.</span>'
        : !shortN ? 'Nothing to print: you own every card your unbuilt decks need.'
        : `<a href="javascript:" data-act="st-short"><b>${shortN}</b> ${shortN === 1 ? 'copy' : 'copies'} of ${plural(short.length, 'title')}</a>
          <span class="muted">to print to build every unbuilt deck</span>`}</p>`}
  </section>`;
}

function statsFactions(s) {
  const fs = STATS_FACTIONS.filter(f => s.factions.get(f)?.titles);
  const both = fs.some(f => RUNNER_FACTIONS.includes(f)) && fs.some(f => CORP_FACTIONS.includes(f));
  const name = f => both && f.startsWith('neutral') ? `Neutral ${f === 'neutral-corp' ? 'Corp' : 'Runner'}` : fname(f);
  return `<section class="sx-sec">
    <h2>By faction</h2>
    <p class="muted">Cards owned · % of titles with a full playset (solid; light: some copies).</p>
    <div class="sx-bars">${fs.map(f => {
      const g = s.factions.get(f);
      return `<a class="sx-row" href="javascript:" data-act="st-faction" data-v="${f}"><span class="sx-name"><span class="dot" style="--fc:${fcolor(f)}"></span>${name(f)}</span>
        ${bar(playsetParts(g, fcolor(f)), `${plural(g.cards, 'card')} · ${pct(g.full, g.titles)}%`)}</a>`;
    }).join('')}</div>
  </section>`;
}

function statsTypes(s, o) {
  const sides = o.side ? [o.side] : ['runner', 'corp'];
  return `<section class="sx-sec">
    <h2>By type</h2>
    <p class="muted">Titles owned / titles · % with a full playset (solid; light: some copies).</p>
    ${sides.map(side => `${sides.length > 1 ? `<h3>${side === 'runner' ? 'Runner' : 'Corp'}</h3>` : ''}
      <div class="sx-bars">${STATS_TYPES[side].filter(t => s.types.get(side + ':' + t)?.titles).map(t => {
        const g = s.types.get(side + ':' + t);
        return `<a class="sx-row" href="javascript:" data-act="st-type" data-v="${t}" data-side="${side}"><span class="sx-name">${TYPE_NAMES[t]}</span>
          ${bar(playsetParts(g), `${g.owned} / ${g.titles} · ${pct(g.full, g.titles)}%`)}</a>`;
      }).join('')}</div>`).join('')}
  </section>`;
}

function statsShopping(s) {
  const need = [...s.short.values()].sort((a, b) => b.decks - a.decks || b.n - a.n || a.t.title.localeCompare(b.t.title));
  const close = s.sets.filter(x => x.have < x.need && x.have / x.need >= .8).sort((a, b) => b.have / b.need - a.have / a.need || a.p.order - b.p.order);
  const top = (key, list) => UI.statsAll[key] ? list : list.slice(0, STATS_TOP);
  return `<section class="sx-sec">
    <h2>Shopping list</h2>
    <div class="sx-cols">
      ${s.decks ? `<div>
        <h3>Most needed for your decks</h3>
        ${need.length ? `<table class="list compact"><tbody>${top('need', need).map(x => `<tr>
          <td class="q">${x.n}×</td>
          <td><span class="dot" style="--fc:${fcolor(x.t.faction)}"></span><a href="javascript:" data-act="card" data-key="${esc(x.t.key)}">${esc(x.t.title)}</a></td>
          <td class="muted">${x.decks === 1 ? '1 deck' : `${x.decks} decks`}</td></tr>`).join('')}</tbody></table>${sxMore('need', need.length)}`
          : '<p class="muted">Your decks need nothing you don\'t own.</p>'}
      </div>` : ''}
      <div>
        <h3>Closest sets</h3>
        ${close.length ? `<table class="list compact"><tbody>${top('close', close).map(x => `<tr>
          <td>${setIcon(x.p.cycle_code)}<a href="#sets/${x.p.code}">${esc(x.p.name)}</a></td>
          <td><a href="javascript:" data-act="sets-short" data-v="${x.p.code}">${plural(x.need - x.have, 'card')} missing</a></td>
          <td class="q">${pct(x.have, x.need)}%</td></tr>`).join('')}</tbody></table>${sxMore('close', close.length)}`
          : '<p class="muted">No sets between 80 and 99% complete.</p>'}
      </div>
    </div>
  </section>`;
}

// Opens the Collection list from a Stats tap, with only the filters that tap is about.
function collectionFrom(changes, only = null) {
  Object.assign(UI.filters, { q: '', side: '', faction: '', type: '', set: '', show: 'all', hideRotated: UI.stats.hideRotated }, changes);
  saveFilters();
  UI.only = only;
  location.hash = '#collection';
}

/* ---------- card details modal ---------- */

const SYMBOLS = { credit: '¢', click: '⏱', 'recurring-credit': '↺¢', subroutine: '↳', trash: '🗑', mu: 'MU', link: '⛓', interrupt: '⚡' };
const cardText = s => (s || '').replace(/\[([a-z-]+)\]/g, (m, k) => SYMBOLS[k] ? `<span class="sym">${SYMBOLS[k]}</span>` : fname(k)).replace(/\n/g, '<br>');

function renderAddList(el) {
  el.hidden = false;
  el.innerHTML = `
  <div class="modal-box narrow" role="dialog" aria-label="Add cards from a list">
    <button class="close" data-act="modal-close" aria-label="Close">×</button>
    <div class="modal-body">
      <h2>Add cards from a list</h2>
      <p class="muted">For a new starter deck, a trade, a booster… Paste a list ("3x Hedge Fund") or NetrunnerDB deck links.
        The counts are added to what you already have.</p>
      <textarea id="add-list-in" rows="8" placeholder="3x Hedge Fund&#10;2x Ice Wall"></textarea>
      <div class="row"><button class="primary" data-act="add-list">Add to collection</button></div>
      <div id="add-list-out"></div>
    </div>
  </div>`;
  $('#add-list-in').focus();
}

function renderModal() {
  const el = $('#modal');
  if (UI.modal === ':add-list') return renderAddList(el);
  if (UI.modal === ':text') return renderText(el);
  const t = UI.modal && DB.titles.get(UI.modal);
  if (!t) { el.hidden = true; el.innerHTML = ''; return; }
  const shown = DB.byCode.get(UI.modalCode) || mainPrinting(t);
  const decks = S.decks.map(d => ({ d, e: deckEntries(d).find(e => e.key === t.key) })).filter(x => x.e);
  const c = t.newest;
  el.hidden = false;
  el.innerHTML = `
  <div class="modal-box" role="dialog" aria-label="${esc(t.title)}">
    <button class="close" data-act="modal-close" aria-label="Close">×</button>
    <div class="modal-img">${cardImg(shown.code, t.title, 'large')}</div>
    <div class="modal-body">
      <h2>${esc(t.title)}</h2>
      <div class="muted">${fname(t.faction)} · ${TYPE_NAMES[t.type] || t.type}${c.keywords ? ': ' + esc(c.keywords) : ''}${c.faction_cost ? ' · influence ' + c.faction_cost : ''}</div>
      <p class="text">${cardText(c.text)}</p>
      <h3>Your copies</h3>
      <table class="list compact"><thead><tr><th>Printing</th><th>Owned</th><th>Alt art</th></tr></thead><tbody>
      ${t.printings.filter(p => pubOk(p.pack) || own(p.code).n || p === shown).map(p => {
        const o = own(p.code);
        return `<tr class="${p === shown ? 'cur' : ''}">
          <td>${setIcon(p.pack.cycle_code)}<a href="javascript:" data-act="modal-show" data-code="${p.code}">${esc(p.pack.name)}</a> <span class="muted">#${p.position} · ${PUBLISHERS[p.pack.publisher]}</span></td>
          <td>${stepper('print-n', `data-code="${p.code}"`, o.n)}</td>
          <td>${stepper('alt', `data-code="${p.code}"`, o.custom, 'small')}</td></tr>`;
      }).join('')}
      </tbody></table>
      <h3>In decks</h3>
      ${decks.length ? `<ul class="plain">${decks.map(({ d, e }) => `<li><a href="#deck/${d.id}" data-act="modal-close-nav">${esc(d.name)}</a>: ${e.qty}× ${d.built ? '<span class="pill built">Built</span>' : '<span class="muted">not built</span>'}${e.proxies ? ` (${e.proxies} printed)` : ''}</li>`).join('')}</ul>`
        : '<p class="muted">Not in any deck.</p>'}
      <p><a href="https://netrunnerdb.com/en/card/${shown.code}" target="_blank" rel="noopener">View on NetrunnerDB ↗</a></p>
    </div>
  </div>`;
}

/* ---------- refresh after a count change ---------- */

// Swap a tile for freshly rendered HTML, keeping its already loaded image so it doesn't flicker.
function replaceTile(el, html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  const fresh = tpl.content.firstElementChild;
  const oldImg = $('.tile-img img', el), newImg = $('.tile-img img', fresh);
  if (oldImg && newImg && oldImg.src === newImg.src) newImg.replaceWith(oldImg);
  el.replaceWith(fresh);
}

function refresh(key) {
  const locks = computeLocks();
  const t = DB.titles.get(key);
  for (const el of $$(`#items tr${sel(key)}`)) el.outerHTML = titleRow(t, locks);
  if ($('#stats')) $('#stats').innerHTML = `${collectionStats(locks)} <span class="muted">· showing ${UI.resultsCount}</span>`;
  for (const el of $$(`.ptile${sel(key)}`)) replaceTile(el, printTile(DB.byCode.get(el.dataset.code), +el.dataset.i));
  if (UI.view === 'sets') {
    const pack = DB.packByCode.get(UI.setsPack);
    const side = $('#sets-side'), top = side.scrollTop;
    side.innerHTML = setsSidebar(pack);
    side.scrollTop = top;
    $('#pack-progress').innerHTML = packCopiesText(pack);
    $('#pack-state').innerHTML = statePill(packState(pack));
    $('#pack-bar-progress').innerHTML = packProgress(pack);
    const opt = $(`#pack-jump option[value="${pack.code}"]`);
    if (opt) opt.innerHTML = packOption(pack);
  }
  if (UI.view === 'deck' || UI.view === 'decks' || UI.view === 'stats') render();
  else renderModal();
}

/* ---------- actions ---------- */

const currentDeck = () => S.decks.find(d => d.id === UI.arg);

const act = {
  'card': el => { UI.modal = el.dataset.key; UI.modalCode = null; renderModal(); },
  'modal-close': () => { UI.modal = null; renderModal(); },
  'add-list-open': () => { UI.modal = ':add-list'; renderModal(); },
  'add-list': async () => {
    let added = 0;
    const unknown = [], failed = [];
    for (const chunk of splitDeckInputs($('#add-list-in').value)) {
      try {
        const d = await parseDeckInput(chunk);
        for (const [code, q] of Object.entries(d.cards)) { setOwn(code, own(code).n + q); added += q; }
        unknown.push(...d.unknown);
      } catch (e) { failed.push(e.message); }
    }
    UI.modal = null;
    renderModal();
    render();
    toast(`Added ${plural(added, 'card')} to your collection.` + (unknown.length ? ` ${plural(unknown.length, 'line')} not recognised: ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}` : ''));
    if (failed.length) alert('Some deck links could not be read:\n' + failed.join('\n'));
  },
  'modal-close-nav': () => { UI.modal = null; renderModal(); },
  'modal-show': el => { UI.modalCode = el.dataset.code; renderModal(); },
  'title-n': el => { adjustTitle(el.dataset.key, +el.dataset.d); refresh(el.dataset.key); },
  'print-n': el => { const c = el.dataset.code; setOwn(c, own(c).n + +el.dataset.d); refresh(DB.byCode.get(c).key); },
  'set-n': el => { const c = el.dataset.code; setOwn(c, +el.dataset.n); refresh(DB.byCode.get(c).key); },
  'alt': el => {
    const c = el.dataset.code, o = own(c), d = +el.dataset.d;
    // Adding alt art to a card you don't have yet means you have that copy.
    setOwn(c, Math.max(o.n, o.custom + d), o.custom + d);
    refresh(DB.byCode.get(c).key);
  },
  'focus': el => setFocus(+el.dataset.i),

  'f-side': el => { UI.filters.side = el.dataset.v; UI.filters.faction = ''; UI.filters.type = ''; saveFilters(); render(); },
  'f-set': el => { UI.filters.set = el.dataset.v; saveFilters(); render(); },
  'only-clear': () => { UI.only = null; render(); },

  'st-side': el => { UI.stats.side = el.dataset.v; store.set('stats', UI.stats); render(); },
  'st-all': el => { UI.statsAll[el.dataset.v] = !UI.statsAll[el.dataset.v]; render(); },
  'st-faction': el => { const f = el.dataset.v; collectionFrom({ faction: f, side: CORP_FACTIONS.includes(f) ? 'corp' : 'runner' }); },
  'st-type': el => collectionFrom({ type: el.dataset.v, side: el.dataset.side }),
  'st-short': () => {
    const keys = [...statsFor(UI.stats).short.values()].filter(x => x.unbuilt).map(x => x.t.key);
    collectionFrom({}, { label: 'cards short for saved decks', keys: new Set(keys) });
  },
  'lock': () => {
    S.locked = !S.locked;
    save(false);
    render();
    toast(S.locked ? 'Collection locked. Counts can\'t be changed until you unlock it.' : 'Collection unlocked.');
  },

  // data-v: the product to show only its missing cards of; empty shows every card again.
  'sets-short': el => {
    const code = el.dataset.v;
    UI.setsShort = code ? { pack: code, codes: null } : null;
    if (code && location.hash !== '#sets/' + code) location.hash = '#sets/' + code; else render();
  },
  'sets-filter': el => { UI.setsFilter = el.dataset.v; store.set('setsFilter', UI.setsFilter); render(); },
  'sets-rotated': el => { UI.setsHideRotated = el.checked; store.set('setsHideRotated', el.checked); render(); },
  'pack-fill': el => {
    const k = +el.dataset.k, pack = DB.packByCode.get(UI.setsPack);
    if (!k && !confirm(`Set every card in ${pack.name} to 0?`)) return;
    // Complete: at least one box's worth of each card; copies beyond that are kept.
    for (const c of pack.cards) setOwn(c.code, k ? Math.max(own(c.code).n, c.quantity || 1) : 0);
    // Cleared: back to not started (setOwn would otherwise have marked it in progress).
    if (k) S.packStatus[pack.code] = 'done'; else delete S.packStatus[pack.code];
    save();
    render();
  },
  // packStatus is only setup's walk-through now: 'partial' = still to go through, 'done' = gone through.
  // It's kept in the stored collection (and backups) as before, but no longer shown.
  packDone() { S.packStatus[UI.setsPack] = 'done'; save(); nextPack(); },
  'pack-done': () => act.packDone(),

  'w-complete': el => {
    const W = UI.welcome, p = el.dataset.pack;
    W.complete[p] = Math.max(0, (W.complete[p] || 0) + +el.dataset.d);
    if (W.complete[p]) W.partial[p] = false;
    const row = el.closest('.w-pack');
    row.querySelector('.n').textContent = W.complete[p];
    row.classList.toggle('has', W.complete[p] > 0);
    row.querySelector('input').checked = !!W.partial[p];
    row.classList.toggle('some', !!W.partial[p]);
    $('#w-summary').textContent = welcomeSummary();
  },
  'w-partial': el => {
    const W = UI.welcome;
    W.partial[el.dataset.pack] = el.checked;
    el.closest('.w-pack').classList.toggle('some', el.checked);
    $('#w-summary').textContent = welcomeSummary();
  },
  'w-finish': () => finishWelcome(),
  'w-skip': () => { S.onboarded = true; save(false);location.hash = '#collection'; },
  'publisher': el => {
    S.publisher = el.dataset.v;
    if (UI.filters.set && !visiblePacks().some(p => p.cycle_code === UI.filters.set)) { UI.filters.set = ''; saveFilters(); }
    save(false);
    $('.menu').open = false;
    if (UI.view === 'sets' && !pubOk(DB.packByCode.get(UI.setsPack))) { location.hash = '#sets'; return; }
    render();
  },
  'welcome': () => { $('.menu').open = false; location.hash = '#welcome'; },

  'check': async () => {
    const C = UI.check;
    C.text = $('#check-in').value;
    C.error = ''; C.result = null;
    try {
      const d = await parseDeckInput(C.text);
      if (!Object.keys(d.cards).length) throw new Error('No cards recognised in that list.');
      C.result = { id: 'check', name: d.name || 'Checked deck', cards: d.cards, proxies: {}, unknown: d.unknown, source: d.source || '' };
    } catch (e) { C.error = e.message; }
    render();
  },
  'check-save': () => {
    const r = UI.check.result;
    if (!r) return;
    const deck = newDeck(r.name, r.cards, r.source);
    UI.check = { text: '', result: null, error: '' };
    location.hash = '#deck/' + deck.id;
  },
  'deck-new': () => { location.hash = '#deck/' + newDeck('New deck', {}).id; },
  'deck-build': () => {
    const deck = currentDeck(), { sum } = planDeck(deck);
    if (sum.status !== 'ok') {
      const msg = [];
      if (sum.decks.size) msg.push(`Deconstruct ${[...sum.decks.keys()].map(d => d.name).join(', ')}`);
      if (sum.print) msg.push(`count ${sum.print} missing cards as printed proxies`);
      if (!confirm(`To build this deck: ${msg.join(' and ')}. Continue?`)) return;
      for (const d of sum.decks.keys()) d.built = false;
      if (sum.print) markPrinted(deck);
    }
    deck.built = true;
    save(); render();
  },
  'deck-unbuild': el => {
    const deck = el.dataset.id ? S.decks.find(d => d.id === el.dataset.id) : currentDeck();
    deck.built = false;
    save(); render();
    toast(`${deck.name} deconstructed; its cards are free again.`);
  },
  'deck-delete': () => {
    const deck = currentDeck();
    if (!confirm(`Delete ${deck.name}? Its cards return to your collection.`)) return;
    S.decks = S.decks.filter(d => d !== deck);
    save();
    location.hash = '#decks';
  },
  'deck-q': el => { const deck = currentDeck(); deckAdjust(deck, el.dataset.key, +el.dataset.d); save(); render(); },
  'deck-add': el => {
    const deck = currentDeck();
    deckAdjust(deck, el.dataset.key, 1);
    save(); render();
    $('#deck-add').focus();
  },
  'unproxy': el => { const deck = currentDeck(); delete deck.proxies[el.dataset.key]; save(); render(); },
  'mark-printed': () => { markPrinted(currentDeck()); UI.modal = null; save(); render(); toast('Missing cards are now counted as printed copies in this deck.'); },
  'show-print': () => {
    const { sum } = planDeck(currentDeck());
    showText('Cards to print', sum.printList.map(p => `${p.n}x ${p.t.title}`).join('\n'),
      `You don't own enough of ${plural(sum.printList.length, 'card')} (${sum.print} copies). Once they're printed, mark them so this deck counts them.`,
      `<button data-act="mark-printed">I printed them</button>`);
  },
  'copy-deck': () => showText('Deck list', deckText(currentDeck())),
  'copy-text': () => copyText(),

  'refresh-db': async () => {
    $('.menu').open = false;
    toast('Fetching card data from NetrunnerDB…');
    try {
      loadDB(await fetchNrdb());
      render();
      toast(`Card data updated: ${DB.byCode.size} printings.`);
    } catch (e) { alert(e.message); }
  },
  'backup': () => {
    $('.menu').open = false;
    const now = new Date().toISOString();
    Object.assign(S.meta, { lastBackup: now, changesSinceBackup: 0, firstUnbackedChange: null });
    downloadBackup(backupName(now), now);
    save(false);
    toast('Backup downloaded.');
  },
  'restore': () => { $('.menu').open = false; $('#restore-file').click(); },
  'update-reload': async () => {
    // Save first: the reload must not lose a change still waiting for its debounced save.
    await flush();
    const w = PWA.waiting;
    if (!w || w.state === 'activated') return location.reload(); // another tab already switched
    PWA.reloading = true;
    w.postMessage('skip-waiting');
  },
};

/* ---------- backup and restore ---------- */

// People already keep backup files, so the format must stay compatible: every old backup must still restore
// (through migrate()), and anything new must be optional. Breaking it is not an option.
const BACKUP_APP = 'netrunner-collection';
const backupName = (iso, suffix = '') => `netrunner-collection-${localDate(iso)}${suffix}.json`;
// YYYY-MM-DD in local time, for file names.
const localDate = iso => { const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const niceDate = iso => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const cardCount = c => Object.values(c.owned).reduce((a, o) => a + (o.n || 0), 0);

function downloadBackup(name, exportedAt) {
  const file = { app: BACKUP_APP, exportedAt, collection: S };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
}

function backupNote() {
  const m = S.meta, n = m.changesSinceBackup || 0;
  $('#backup-note').textContent = (m.lastBackup ? `Last backup ${niceDate(m.lastBackup)}` : 'Not backed up yet') +
    (n ? ` · ${plural(n, 'change')} since` : '');
}

// Accepts a backup file, or a version 1 export / collection.json from the Go version (the bare collection).
function readBackup(data, file) {
  if (data?.app === BACKUP_APP && data.collection) return { c: data.collection, date: data.exportedAt };
  if (data?.owned && data.decks) return { c: data, date: data.meta?.updated || new Date(file.lastModified).toISOString() };
  throw new Error('That file is not a Netrunner Collection backup.');
}

async function restoreFile(file) {
  try {
    if (S.locked) throw new Error('The collection is locked. Unlock it before restoring a backup.');
    const { c, date } = readBackup(JSON.parse(await file.text()), file);
    if (!c.owned || !Array.isArray(c.decks)) throw new Error('That backup has no collection in it.');
    const changed = S.meta.changed;
    const newer = changed && date && changed > date;
    const msg = [`Restore ${file.name}?`,
      `Backup from ${date ? niceDate(date) : 'an unknown date'}: ${plural(cardCount(c), 'card')}, ${plural(c.decks.length, 'deck')}.`];
    if (newer) msg.push(`This backup is from ${niceDate(date)}. This device has newer changes (last one ${niceDate(changed)}` +
      `${S.meta.changesSinceBackup ? `, ${plural(S.meta.changesSinceBackup, 'change')} since your last backup` : ''}). Replace them anyway?`);
    const hasData = Object.keys(S.owned).length || S.decks.length;
    if (hasData) msg.push('Your current collection is downloaded first as a safety copy.');
    if (!confirm(msg.join('\n\n'))) return;
    await flush();
    // The safety copy is not a backup, so it doesn't reset the change counter.
    const now = new Date().toISOString();
    if (hasData) downloadBackup(backupName(now, '-before-restore'), now);
    S = migrate(c);
    // The device now matches the backup, so nothing is waiting to be backed up.
    Object.assign(S.meta, { changesSinceBackup: 0, firstUnbackedChange: null, lastBackup: date || now, changed: S.meta.changed || date || now });
    save(false);
    UI.modal = null;
    // The page shown may be a deck the backup doesn't have.
    if (location.hash === '#collection') route(); else location.hash = '#collection';
    toast(`Restored ${plural(cardCount(S), 'card')} and ${plural(S.decks.length, 'deck')}.`);
  } catch (e) { alert(e.message); }
  $('#restore-file').value = '';
}

function newDeck(name, cards, source = '') {
  const deck = { id: uid(), name, built: false, cards: { ...cards }, proxies: {}, source, notes: '', created: new Date().toISOString() };
  S.decks.push(deck);
  save();
  return deck;
}

function markPrinted(deck) {
  deck.proxies = deck.proxies || {};
  for (const r of planDeck(deck).rows) if (r.print) deck.proxies[r.key] = (deck.proxies[r.key] || 0) + r.print;
}

// Shows text in a sheet with a copy button. Works over plain http on a phone, where the clipboard API is blocked.
function showText(title, text, note = '', actions = '') {
  UI.modal = ':text';
  UI.modalText = { title, text, note, actions };
  renderModal();
}

function renderText(el) {
  const T = UI.modalText;
  el.hidden = false;
  el.innerHTML = `
  <div class="modal-box narrow" role="dialog" aria-label="${esc(T.title)}">
    <button class="close" data-act="modal-close" aria-label="Close">×</button>
    <div class="modal-body">
      <h2>${esc(T.title)}</h2>
      ${T.note ? `<p class="muted">${T.note}</p>` : ''}
      <textarea id="text-out" rows="${Math.min(14, T.text.split('\n').length + 1)}" readonly>${esc(T.text)}</textarea>
      <div class="row"><button class="primary" data-act="copy-text">Copy</button>${T.actions}</div>
    </div>
  </div>`;
}

async function copyText() {
  const ta = $('#text-out');
  try { await navigator.clipboard.writeText(ta.value); }
  catch {
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    if (!document.execCommand('copy')) return toast('Select the text and copy it manually.');
  }
  toast('Copied.');
}

function saveFilters() { store.set('filters', UI.filters); }

/* ---------- events ---------- */

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  const ptile = e.target.closest('.ptile');
  if (ptile) setFocus(+ptile.dataset.i, false);
  for (const d of $$('details.menu[open], details.dd[open]')) if (!d.contains(e.target) || el?.dataset.act === 'f-set') d.open = false;
  if (el && act[el.dataset.act] && el.type !== 'checkbox') {
    if (el.tagName === 'A' && el.getAttribute('href') === 'javascript:') e.preventDefault();
    if (S.locked && LOCKED_ACTS.has(el.dataset.act)) {
      $('.menu').open = false;
      return toast(el.dataset.act === 'restore' ? 'Collection is locked. Unlock it before restoring a backup.'
        : 'Collection is locked. Use the lock at the top to change counts.');
    }
    act[el.dataset.act](el, e);
    return;
  }
  if (e.target.id === 'modal') act['modal-close']();
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.type === 'checkbox' && el.dataset.act) return act[el.dataset.act](el);
  if (el.dataset.filter) {
    UI.filters[el.dataset.filter] = el.type === 'checkbox' ? el.checked : el.value;
    saveFilters();
    renderResults();
  }
  if (el.dataset.stat) {
    UI.stats[el.dataset.stat] = el.type === 'checkbox' ? el.checked : el.value;
    store.set('stats', UI.stats);
    render();
  }
  if (el.dataset.deckField) {
    currentDeck()[el.dataset.deckField] = el.value;
    save();
  }
  if (el.id === 'restore-file' && el.files[0]) restoreFile(el.files[0]);
  if (el.id === 'pack-jump') location.hash = '#sets/' + el.value;
});

let searchTimer;
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'q') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { UI.filters.q = el.value; saveFilters(); renderResults(); }, 150);
  }
  if (el.id === 'deck-add') $('#deck-add-results').innerHTML = addCardResults(el.value, currentDeck());
  if (el.id === 'check-in') UI.check.text = el.value;
  if (el.id === 'w-decks') { UI.welcome.decks = el.value; $('#w-summary').textContent = welcomeSummary(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && UI.modal) { act['modal-close'](); return; }
  if (e.target.id === 'deck-add' && e.key === 'Enter') { $('#deck-add-results button')?.click(); return; }
  if (e.target.id === 'check-in' && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { act.check(); return; }
  onSetsKey(e);
});

// Card images that NetrunnerDB doesn't have fall back to the title placeholder.
document.addEventListener('error', e => { if (e.target.tagName === 'IMG') e.target.classList.add('broken'); }, true);

window.addEventListener('hashchange', () => { UI.modal = null; route(); });

/* ---------- offline, installing and updates ---------- */

const PWA = { waiting: null, reloading: false, storage: '' };
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// The service worker (sw.js) makes the app work offline. A new version waits until the user taps Reload,
// so the app never reloads on its own and nothing unsaved is lost.
async function registerWorker() {
  if (!('serviceWorker' in navigator)) return; // e.g. plain http on a LAN address: works, but not offline
  const reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
  const offer = w => {
    // Without a controller this is the first install, not an update.
    if (!w || !navigator.serviceWorker.controller) return;
    PWA.waiting = w;
    $('#update').hidden = false;
  };
  offer(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (PWA.reloading) location.reload(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
}

// Asks the browser to keep the data even when space runs low. Chrome usually agrees for installed apps,
// Firefox asks the user, Safari 17+ decides itself.
async function checkStorage() {
  const s = navigator.storage;
  if (!s?.persist) PWA.storage = 'unsupported';
  else PWA.storage = (await s.persisted() || await s.persist()) ? 'protected' : 'not protected';
  storageNote();
}

function storageNote() {
  const el = $('#storage-note');
  if (PWA.storage === 'protected') el.innerHTML = 'Storage: <span class="storage-ok">protected ✓</span>';
  else if (PWA.storage) el.innerHTML = `Storage: not protected. The browser may delete the collection when it runs short of space${
    isIOS ? ' or after 7 days unused' : ''}. ${isStandalone() ? '' : `Installing the app (${isIOS ? 'Share → Add to Home Screen' : 'Install in the browser menu'}) usually protects it. `}Keep a backup either way.`;
}

window.addEventListener('appinstalled', () => checkStorage());

/* ---------- start ---------- */

(async function start() {
  try {
    // Card data comes from the cache when there is one; only the very first start waits for NetrunnerDB.
    let raw = await idb.get('nrdb', 'data');
    const cached = !!raw;
    if (!raw) raw = await fetchNrdb();
    loadDB(raw);
    // The product filter became a set filter; keep the set of a product picked before.
    if (UI.filters.pack) { UI.filters.set = DB.packByCode.get(UI.filters.pack)?.cycle_code || ''; delete UI.filters.pack; saveFilters(); }
    // "Missing from a complete set" was removed (Add by set's "N missing" does it); it falls back to all cards.
    if (UI.filters.show === 'short') { UI.filters.show = 'all'; saveFilters(); }
    S = migrate(await idb.get('state', 'collection'));
    base = S.meta.updated ?? null;
    setSaveStatus('');
    route();
    registerWorker().catch(e => console.warn('Service worker not registered:', e));
    checkStorage().catch(() => {});
    if (cached && navigator.onLine !== false && !(Date.now() - Date.parse(raw.fetched) < NRDB_MAX_AGE)) {
      fetchNrdb().then(r => { loadDB(r); render(); toast('Card data updated from NetrunnerDB.'); })
        .catch(e => console.warn('Background card data refresh failed:', e));
    }
  } catch (e) {
    $('#app').innerHTML = `<p class="error">Could not start: ${esc(e.message)}</p>`;
  }
})();
