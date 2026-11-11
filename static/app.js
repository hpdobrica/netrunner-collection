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

/* ---------- collection state ---------- */

let S = null;
let saveTimer = null, dirty = false;

function save() {
  dirty = true;
  setSaveStatus('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
}

async function flush() {
  clearTimeout(saveTimer);
  try {
    const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
    if (!r.ok) throw new Error((await r.json()).error || r.statusText);
    dirty = false;
    setSaveStatus('Saved');
  } catch (e) {
    setSaveStatus('Not saved: ' + e.message, true);
  }
}

function setSaveStatus(text, error) {
  const el = $('#save-status');
  el.textContent = text;
  el.classList.toggle('error', !!error);
}

window.addEventListener('beforeunload', e => { if (dirty) { flush(); e.preventDefault(); } });

const own = code => S.owned[code] || { n: 0, custom: 0 };

function setOwn(code, n, custom) {
  n = Math.max(0, n | 0);
  const c = Math.min(Math.max(0, (custom ?? own(code).custom) | 0), n);
  if (!n) delete S.owned[code];
  else S.owned[code] = { n, custom: c };
  // Editing a product in the set wizard starts it; changes from elsewhere don't.
  const card = DB.byCode.get(code);
  if (UI.view === 'sets' && card && S.packStatus[card.pack_code] == null) S.packStatus[card.pack_code] = 'partial';
  save();
}

// The publisher setting hides the other publisher's products, and cards only they printed.
const pubOk = p => !S.publisher || S.publisher === 'all' || p.publisher === S.publisher;
const titleVisible = t => !S.publisher || S.publisher === 'all' || t.publishers.has(S.publisher);
const visiblePacks = () => DB.packs.filter(pubOk);

const titleOwned = key => DB.titles.get(key).printings.reduce((a, p) => a + own(p.code).n, 0);
const titleCustom = key => DB.titles.get(key).printings.reduce((a, p) => a + own(p.code).custom, 0);
const packOwned = p => p.cards.reduce((a, c) => a + (own(c.code).n ? 1 : 0), 0);

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
  const r = await fetch(`/api/${kind}/${m[2]}`);
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.length) throw new Error(j.error || 'Deck not found on NetrunnerDB. Private decks must be shared to be readable.');
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
  filters: Object.assign({ q: '', side: '', faction: '', type: '', set: '', show: 'all', hideRotated: false, mode: 'grid', sort: 'name' }, store.get('filters', {})),
  setsFilter: store.get('setsFilter', 'all'),
  setsHideRotated: store.get('setsHideRotated', false),
  wfocus: 0,
  welcome: { complete: {}, partial: {}, decks: '' },
  check: { text: '', result: null, error: '' },
  modal: null,
};

function route() {
  const [view, ...rest] = location.hash.slice(1).split('/');
  UI.view = view || (S.onboarded ? 'collection' : 'welcome');
  UI.arg = decodeURIComponent(rest.join('/'));
  if (UI.view === 'sets' && !UI.arg) {
    const packs = visiblePacks();
    const next = packs.find(p => S.packStatus[p.code] === 'partial') || packs.find(p => !S.packStatus[p.code]) || packs[0];
    location.replace('#sets/' + next.code);
    return;
  }
  render();
}

// Actions that change what you own. A locked collection refuses them; decks can still be built and edited.
const LOCKED_ACTS = new Set(['title-n', 'print-n', 'set-n', 'alt', 'pack-fill', 'add-list-open', 'add-list', 'welcome', 'w-finish', 'import']);
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
  for (const a of $$('[data-nav]')) a.classList.toggle('on', a.dataset.nav === UI.view || (UI.view === 'deck' && a.dataset.nav === 'decks'));
  const app = $('#app');
  const views = { welcome: viewWelcome, collection: viewCollection, sets: viewSets, decks: viewDecks, deck: viewDeck };
  (views[UI.view] || viewCollection)(app);
  renderModal();
}

/* ---------- shared fragments ---------- */

function cardImg(code, title, size) {
  return `<img loading="lazy" src="${imgUrl(code, size)}" alt=""><span class="ph">${esc(title)}</span>`;
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
    <span class="seg">
      <button class="${f.mode === 'grid' ? 'on' : ''}" data-act="f-mode" data-v="grid">Grid</button>
      <button class="${f.mode === 'list' ? 'on' : ''}" data-act="f-mode" data-v="list">List</button>
    </span>
  </div>
  ${lockNote}
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
  const box = $('#results');
  const grid = UI.filters.mode === 'grid';
  box.innerHTML = grid ? '<div class="grid" id="items"></div>'
    : '<table class="list"><thead><tr><th>Card</th><th>Type</th><th>Faction</th><th>Owned</th><th>Alt art</th><th>In decks</th><th>Free</th></tr></thead><tbody id="items"></tbody></table>';
  if (!list.length) box.innerHTML = '<p class="empty">No cards match these filters.</p>';
  const items = $('#items');
  let shown = 0;
  const more = () => {
    const chunk = list.slice(shown, shown + 150);
    shown += chunk.length;
    items.insertAdjacentHTML('beforeend', chunk.map(t => grid ? titleTile(t, locks) : titleRow(t, locks)).join(''));
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

function titleTile(t, locks) {
  const n = titleOwned(t.key), alt = titleCustom(t.key), used = lockedQty(locks, t.key);
  return `<div class="tile ${n ? '' : 'unowned'}" data-key="${esc(t.key)}" style="--fc:${fcolor(t.faction)}">
    <button class="tile-img" data-act="card" data-key="${esc(t.key)}" title="${esc(t.title)}">
      ${cardImg(mainPrinting(t).code, t.title)}
      ${alt ? `<span class="badge alt">${alt} alt art</span>` : ''}
      ${used ? `<span class="badge used">${used} in decks</span>` : ''}
    </button>
    <div class="tile-foot">
      <span class="tile-name" title="${esc(t.title)}">${setLabel(t)}${esc(t.title)}</span>
      ${stepper('title-n', `data-key="${esc(t.key)}"`, n)}
    </div>
  </div>`;
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
  const status = S.packStatus[pack.code];
  app.innerHTML = `
  <div class="sets">
    <aside class="sets-side" id="sets-side">${setsSidebar(pack)}</aside>
    <section class="sets-main">
      <div class="pack-head">
        <select class="pack-jump" id="pack-jump" aria-label="Product">${groupByCycle(visiblePacks()).map(([cy, ps]) =>
          `<optgroup label="${esc(cy?.name || 'Other')}">${ps.map(p => `<option value="${p.code}" ${p === pack ? 'selected' : ''}>${
            S.packStatus[p.code] === 'done' ? '✓ ' : S.packStatus[p.code] === 'partial' ? '◐ ' : ''}${esc(p.name)} (${packOwned(p)}/${p.cards.length})</option>`).join('')}</optgroup>`).join('')}
        </select>
        <div>
          <h1>${setIcon(pack.cycle_code)}${esc(pack.name)}</h1>
          <div class="muted"><span class="hide-sm">${esc(pack.cycle?.name || '')} · released ${esc(pack.date_release || '?')} ·</span> ${plural(pack.cards.length, 'card')}
            · <span id="pack-progress">${packOwned(pack)} owned</span>
            · <span class="pill ${status || 'todo'}">${status === 'done' ? 'Done' : status === 'partial' ? 'In progress' : 'Not started'}</span></div>
        </div>
        <div class="pack-actions">
          <span class="muted">Own it complete:</span>
          <span class="seg">${[1, 2, 3].map(k => `<button data-act="pack-fill" data-k="${k}">×${k}</button>`).join('')}</span>
          <button data-act="pack-fill" data-k="0">Clear</button>
          <button class="primary top-done" data-act="pack-done">${status === 'done' ? 'Next product →' : 'Mark done, next →'}</button>
        </div>
      </div>
      ${lockNote}
      <p class="hint">Click a card or use the keyboard: <kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move ·
        <kbd>0</kbd>–<kbd>9</kbd> set count · <kbd>+</kbd>/<kbd>−</kbd> adjust · <kbd>A</kbd>/<kbd>Shift+A</kbd> alt art ·
        <kbd>Enter</kbd> mark done and go to the next product</p>
      <div class="pgrid" id="pgrid">${pack.cards.map((c, i) => printTile(c, i)).join('')}</div>
      <div class="pack-bar">
        <span id="pack-bar-progress">${packProgress(pack)}</span>
        <button class="primary" data-act="pack-done">${status === 'done' ? 'Next product →' : 'Done, next →'}</button>
      </div>
    </section>
  </div>`;
  const side = $('#sets-side'), cur = $('.prow.cur', side);
  if (cur) side.scrollTop = cur.offsetTop - side.clientHeight / 2;
  window.scrollTo(0, 0);
}

const packProgress = p => `<b>${packOwned(p)}</b> of ${p.cards.length} cards owned`;

function setsSidebar(cur) {
  const f = UI.setsFilter;
  const packs = DB.packs.filter(p => {
    if (!pubOk(p) && p !== cur) return false;
    if (UI.setsHideRotated && p.cycle?.rotated && p !== cur) return false;
    const s = S.packStatus[p.code];
    return f === 'all' || p === cur || (f === 'todo' ? !s : f === s);
  });
  return `
    <div class="seg small">${[['all', 'All'], ['todo', 'To do'], ['partial', 'In progress'], ['done', 'Done']]
      .map(([v, l]) => `<button class="${f === v ? 'on' : ''}" data-act="sets-filter" data-v="${v}">${l}</button>`).join('')}</div>
    <label class="check"><input type="checkbox" data-act="sets-rotated" ${UI.setsHideRotated ? 'checked' : ''}> Hide rotated</label>
    ${groupByCycle(packs).map(([cy, ps]) => `
      <div class="cyc"><div class="cyc-h">${setIcon(cy?.code)}${esc(cy?.name || 'Other')} <span class="pub">${PUBLISHERS[ps[0].publisher]}</span></div>
      ${ps.map(p => `<a class="prow ${p === cur ? 'cur' : ''} ${S.packStatus[p.code] || 'todo'}" href="#sets/${p.code}">
        <span class="sdot"></span><span class="pname">${esc(p.name)}</span><span class="pcount">${packOwned(p)}/${p.cards.length}</span></a>`).join('')}
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
  // Only products you've started; untouched ones are ones you don't own, so don't march through them.
  const next = order.find(p => S.packStatus[p.code] === 'partial');
  if (next) location.hash = '#sets/' + next.code;
  else { toast('All products in progress are done. Pick any other product from the list to add more.'); location.hash = '#collection'; }
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
  for (const el of $$(`.tile${sel(key)}`)) replaceTile(el, titleTile(t, locks));
  for (const el of $$(`#items tr${sel(key)}`)) el.outerHTML = titleRow(t, locks);
  if ($('#stats')) $('#stats').innerHTML = `${collectionStats(locks)} <span class="muted">· showing ${UI.resultsCount}</span>`;
  for (const el of $$(`.ptile${sel(key)}`)) replaceTile(el, printTile(DB.byCode.get(el.dataset.code), +el.dataset.i));
  if (UI.view === 'sets') {
    const pack = DB.packByCode.get(UI.setsPack);
    const side = $('#sets-side'), top = side.scrollTop;
    side.innerHTML = setsSidebar(pack);
    side.scrollTop = top;
    $('#pack-progress').textContent = `${packOwned(pack)} owned`;
    $('#pack-bar-progress').innerHTML = packProgress(pack);
    const opt = $(`#pack-jump option[value="${pack.code}"]`);
    if (opt) opt.textContent = opt.textContent.replace(/\(\d+\//, `(${packOwned(pack)}/`);
  }
  if (UI.view === 'deck' || UI.view === 'decks') render();
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
  'f-mode': el => { UI.filters.mode = el.dataset.v; saveFilters(); render(); },
  'f-set': el => { UI.filters.set = el.dataset.v; saveFilters(); render(); },
  'lock': () => {
    S.locked = !S.locked;
    save();
    render();
    toast(S.locked ? 'Collection locked. Counts can\'t be changed until you unlock it.' : 'Collection unlocked.');
  },

  'sets-filter': el => { UI.setsFilter = el.dataset.v; store.set('setsFilter', UI.setsFilter); render(); },
  'sets-rotated': el => { UI.setsHideRotated = el.checked; store.set('setsHideRotated', el.checked); render(); },
  'pack-fill': el => {
    const k = +el.dataset.k, pack = DB.packByCode.get(UI.setsPack);
    if (!k && !confirm(`Set every card in ${pack.name} to 0?`)) return;
    for (const c of pack.cards) setOwn(c.code, (c.quantity || 1) * k);
    if (k) S.packStatus[pack.code] = 'done';
    save();
    render();
  },
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
  'w-skip': () => { S.onboarded = true; save(); location.hash = '#collection'; },
  'publisher': el => {
    S.publisher = el.dataset.v;
    if (UI.filters.set && !visiblePacks().some(p => p.cycle_code === UI.filters.set)) { UI.filters.set = ''; saveFilters(); }
    save();
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
      const r = await fetch('/api/nrdb?refresh=1');
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      loadDB(j);
      render();
      toast(`Card data updated: ${DB.byCode.size} printings.`);
    } catch (e) { alert(e.message); }
  },
  'export': () => {
    $('.menu').open = false;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
    a.download = `netrunner-collection-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  },
  'import': () => { $('.menu').open = false; $('#import-file').click(); },
};

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
      return toast('Collection is locked. Use the lock at the top to change counts.');
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
  if (el.dataset.deckField) {
    currentDeck()[el.dataset.deckField] = el.value;
    save();
  }
  if (el.id === 'import-file' && el.files[0]) importFile(el.files[0]);
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

async function importFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.owned || !data.decks) throw new Error('That file is not a collection export.');
    if (!confirm(`Replace your collection with ${file.name}? (${Object.keys(data.owned).length} printings, ${data.decks.length} decks)`)) return;
    S = Object.assign({ packStatus: {}, onboarded: true }, data);
    save();
    route();
  } catch (e) { alert(e.message); }
  $('#import-file').value = '';
}

/* ---------- start ---------- */

(async function start() {
  try {
    const [db, state] = await Promise.all([fetch('/api/nrdb'), fetch('/api/state')]);
    const raw = await db.json();
    if (!db.ok) throw new Error(raw.error);
    loadDB(raw);
    // The product filter became a set filter; keep the set of a product picked before.
    if (UI.filters.pack) { UI.filters.set = DB.packByCode.get(UI.filters.pack)?.cycle_code || ''; delete UI.filters.pack; saveFilters(); }
    S = Object.assign({ version: 1, owned: {}, decks: [], packStatus: {}, onboarded: false }, await state.json());
    if (!S.onboarded && Object.keys(S.owned).length) S.onboarded = true;
    setSaveStatus('');
    route();
  } catch (e) {
    $('#app').innerHTML = `<p class="error">Could not start: ${esc(e.message)}</p>`;
  }
})();
