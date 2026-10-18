// ui/pluginFrame.js — the host side of an interface plugin (DESIGN §32.8, shared/plugins/ui.js).
// Imported for its effect from screens/game.js (the match already loads the battle runner). It does not import the
// art compositor, the plugin panel or the asset store. With no interface plugin switched on, and on a server that
// reports none, it does not ask for the catalogue.
//
// Each switched-on plugin is one <iframe sandbox="allow-scripts"> (no allow-same-origin: an opaque origin, so it has
// no site storage and no credentials). The same `sandbox allow-scripts` is on the /p/ response (UI_FRAME_CSP), because
// the attribute is not there when the URL is opened at the top level. The parent posts with targetOrigin '*' because
// that origin is the string "null" — 'null' does not tell the entry document from a later opaque one.
// Loads: 1 is the entry (the iframe points straight at it), 2+ destroys the frame and stops the feed. A message is applied on
// the next turn so a load event already queued runs first. A message is accepted only from that iframe's window,
// and only when event.origin is "null".
// The iframe is parked on #sp-ui-park until its slot element exists, then moved into [data-ui-slot]. The slot div
// opts out of Preact's children (dangerouslySetInnerHTML) so a re-render does not drop the frame; if a screen
// unmounts the slot, the frame is moved back to the park in the same mutation.
//
// [ASSUMED] the first declared slot that has an element is granted when the frame is created, otherwise the first
// free declared slot, so the frame has a home before its own `slot` message. The protocol table stays one plugin
// per slot. When several plugins prefer the same slot, the first by name is shown and the player switches the
// others with tabs in the slot. Nothing here calls net.send. A match intent is rejected locally.

import { store } from '../store.js';
import { battleRunner } from '../battle/runner.js';
import { catalog, loadCatalog, installedCount, pluginName } from '../content.js';
import { toast } from './toasts.js';
import { getLang, t } from '../../../shared/i18n.js';
import { PROTOCOL_VERSION } from '../../../shared/constants.js';
import { uiPlugins, uiPluginEntries } from './uiPlugins.js';
import {
  UI_ERRORS, UI_LIMITS, UI_SLOTS, UI_UNIT_VARIANTS, battlePayload, checkStorageWrite, clampFrame, clampHeight, clampNotice, createNoticeLimiter,
  createRateLimiter, createSlotTable, frameLoadDecision, framePageUrl, hostFrame, hostLimit, hostNet, hostRejected, hostResult,
  hostState, hostWelcome, isIntentType, namespacedStorageKey, netSlot, subsetRoom, validatePluginMessage,
} from '../../../shared/plugins/ui.js';

const SLOT_MS = Math.round(1000 / UI_LIMITS.battleHz);
const STATE_MS = 250;
const LIMIT_MS = 2000;
/** The battle HUD class `effect: dj-rotate` maps onto (public/css/screens/game.css). */
const EFFECT_CLASS = 'is-dj-rotate';
/** `dj-rotate`'s other half: the field view's canvas transform (public/js/render/djRotate.js). */
const ROTATE_EFFECT = 'dj-rotate';
/**
 * The HUD's own custom properties a `dj-rotate` `tune` overrides (public/css/screens/game.css). The stylesheet holds
 * the reference mod's numbers as their defaults, so a plugin that sends no `tune` writes nothing at all — and a plugin
 * that lets go while another still asks for the effect hands the HUD back to that plugin's own values (or to the
 * stylesheet's, when it has none). One entry per `UI_ROTATE_TUNE` key, plus the unit the value is written in.
 */
const ROTATE_VARS = Object.freeze({
  turn: Object.freeze({ prop: '--gm-dj-turn-dur', suffix: 's' }),
  squash: Object.freeze({ prop: '--gm-dj-depth', suffix: '' }),
  pulse: Object.freeze({ prop: '--gm-dj-pulse-dur', suffix: 's' }),
});
/** The field view's stand-in layer (`effect: units-gif`, public/js/render/unitsGif.js). */
const GIF_EFFECT = 'units-gif';
/** The host's decorative layers (`effect: dj-neon`, public/css/screens/game.css). */
const NEON_EFFECT = 'dj-neon';
/** The class of the box `dj-neon` puts on the body; removing that one node is the whole undo. */
const NEON_CLASS = 'gm__neon';
/** The strategy a `units-gif` message draws with when it names no variant (the one dj-amiya has always used). */
const DEFAULT_UNIT_VARIANT = UI_UNIT_VARIANTS[0];
/** The match screen the frame is placed on. It fills the viewport (devices.css), so its box is the play area. */
const MATCH_SELECTOR = '.screen.gm';

/** The guarded field view the match screen hands over (`setFieldView`), or null when no match is mounted. */
let fieldView = null;
/** The one `dj-neon` box on the body, if it is up. */
let neonEl = null;
/** Orders the `dj-rotate` requesters: the most recent press is the one whose numbers are in force. */
let rotateSeq = 0;

/** @type {Map<string, FrameRec>} */
const frames = new Map();
/** Plugins stopped for leaving their entry page: not mounted again until this page reloads (no re-mount loop). */
const blocked = new Set();
const slots = createSlotTable();
/** slot → plugin the player chose to see. Absent: the first by name. */
const chosenSlot = new Map();
const limiter = createRateLimiter();
const noticeLimiter = createNoticeLimiter();
const rejected = [];
/** @type {{ last: object | null, rejected: string[], debugBattle: (events: unknown) => void, frames: () => string[] }} */
const api = {
  blocked: () => [...blocked],
  rejected,
  last: null,
  frames: () => [...frames.keys()],
  debugBattle(events) {
    const msg = battlePayload({ fieldId: 'debug', gt: 0, events, snap: null });
    api.last = msg;
    for (const rec of frames.values()) post(rec, msg);
  },
};

/**
 * @typedef {{ id: string, iframe: HTMLIFrameElement, declared: string[], entry: any, ready: boolean,
 *   preview?: any, entries: Record<string, string>, limitAt: number, loads: number, closed: boolean,
 *   effects: Set<string>, variant: string | null, tune: { turn?: number, squash?: number, pulse?: number } | null,
 *   tuneAt: number, netAt?: number | null, netText?: string }} FrameRec
 */

let park = null;
let booted = false;
let stateTimer = 0;
let lastState = '';
let netTimer = 0;
let lastResultText = '';
let battleTimer = 0;
/** @type {unknown[]} */
let battleQueue = [];
let battleField = null;
let battleGt = null;
let lastSnap = null;

function parkEl() {
  if (park && park.isConnected) return park;
  park = document.createElement('div');
  park.id = 'sp-ui-park';
  park.hidden = true;
  park.setAttribute('aria-hidden', 'true');
  document.body.appendChild(park);
  return park;
}

/** @param {FrameRec} rec @param {object} msg */
/** Private feed only while the entry document is the one that finished loading. */
function feeding(rec) {
  return !rec.closed && frames.get(rec.id) === rec && rec.ready && frameLoadDecision(rec.loads) === 'entry';
}

function post(rec, msg) {
  if (rec.closed || frames.get(rec.id) !== rec) return;
  const w = rec.iframe.contentWindow;
  if (!w) return;
  try {
    w.postMessage(msg, '*');
    api.last = msg;
  } catch { /* the frame is gone */ }
}

/** @param {string} id */
function destroy(id) {
  const rec = frames.get(id);
  if (!rec) return;
  rec.closed = true;
  rec.ready = false;
  frames.delete(id);
  for (const [slot, held] of chosenSlot) if (held === id) chosenSlot.delete(slot);
  slots.release(id);
  limiter.reset(id);
  noticeLimiter.reset(id);
  rec.iframe.remove();
}

/** A frame left its entry document: destroy it and keep the plugin off for the rest of this page. @param {string} id */
function stopForLeaving(id) {
  if (!frames.has(id)) return;
  blocked.add(id);
  destroy(id);
  try { toast(t('界面插件离开了自己的页面，本页已停用它（刷新后恢复）'), 'warn'); } catch { /* the toast host may be absent */ }
}

function destroyAll() {
  for (const id of [...frames.keys()]) destroy(id);
}

/**
 * A slot that left the document took its frame with it. Move that frame back to the park.
 * A frame we just moved ourselves is still connected, so it is left where it is (moving it again would loop).
 * @param {Node} node
 * @returns {boolean}
 */
function rescue(node) {
  if (!node || node.nodeType !== 1) return false;
  const el = /** @type {Element} */ (node);
  if (el.isConnected) return false;
  const frame = el.classList && el.classList.contains('ui-slot__frame') ? el : (el.querySelector ? el.querySelector('.ui-slot__frame') : null);
  if (!frame || frame.isConnected) return false;
  // only a live frame is re-parked: a destroyed one (no record any more) stays removed instead of coming back as an
  // orphan that reloads the plugin's page
  const rec = frames.get(/** @type {HTMLElement} */ (frame).dataset.plugin || '');
  if (!rec || rec.iframe !== frame || rec.closed) return false;
  moveFrame(rec, parkEl());
  return true;
}

/**
 * The host moves a frame. A browser reloads an iframe that changes parent, from its `src` — the entry — so the load
 * count and the handshake start over (the plugin answers the new `welcome` with a new `ready`). A navigation the
 * plugin starts itself still counts past the entry and destroys the frame.
 * @param {FrameRec} rec @param {Element} home
 */
function moveFrame(rec, home) {
  rec.loads = 0;
  rec.ready = false;
  rec.netAt = null;
  rec.netText = '';
  // hidden again until this new document's own load: the reload starts from a blank document
  rec.iframe.classList.remove('is-ready');
  home.appendChild(rec.iframe);
}

/** @param {FrameRec} rec */
function place(rec) {
  const slot = slots.slotOf(rec.id);
  const el = slot ? document.querySelector(`[data-ui-slot="${slot}"]`) : null;
  const home = rec.preview?.host || el || parkEl();
  if (rec.iframe.parentElement !== home) moveFrame(rec, home);
  // A frame the plugin asked for before this slot existed (its page loads first) is applied now instead
  if (rec.frameReq) applyFrameRequest(rec);
}

function byPluginName(a, b) {
  const an = pluginName(a.entry) || a.id;
  const bn = pluginName(b.entry) || b.id;
  return an.localeCompare(bn) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The first declared slot that currently has an element. */
function preferredSlot(rec) {
  const allowed = rec.declared.filter((s) => UI_SLOTS.includes(s));
  return allowed.find((s) => document.querySelector(`[data-ui-slot="${s}"]`)) || null;
}

/**
 * One holder per slot. Several plugins may prefer it: the player's tab wins, otherwise the first by name.
 * The others stay mounted and parked until a tab shows them. [ASSUMED] that initial order is the name order.
 */
function assignSlots() {
  /** @type {Map<string, FrameRec[]>} */
  const groups = new Map();
  for (const rec of frames.values()) {
    if (rec.preview || rec.closed) continue;
    const slot = preferredSlot(rec);
    if (!slot) continue;
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(rec);
  }
  for (const [slot, list] of groups) {
    list.sort(byPluginName);
    const want = chosenSlot.get(slot);
    const pick = (want && list.find((r) => r.id === want)) || list[0];
    if (slots.holder(slot) !== pick.id) {
      const holder = slots.holder(slot);
      if (holder) slots.release(holder);
      if (slots.slotOf(pick.id)) slots.release(pick.id);
      slots.request(pick.id, slot, pick.declared);
    }
    for (const rec of list) if (rec.id !== pick.id && slots.slotOf(rec.id) === slot) slots.release(rec.id);
  }
}

/** Tabs for a slot that more than one switched-on plugin prefers. One is visible; the rest are listed here. */
function renderSlotTabs() {
  for (const slot of UI_SLOTS) {
    const el = document.querySelector(`[data-ui-slot="${slot}"]`);
    if (!el) continue;
    const list = [];
    for (const rec of frames.values()) {
      if (rec.preview || rec.closed) continue;
      if (preferredSlot(rec) === slot) list.push(rec);
    }
    list.sort(byPluginName);
    const old = el.querySelector(':scope > .ui-slot__tabs');
    if (list.length < 2) { if (old) old.remove(); continue; }
    const bar = old || document.createElement('div');
    bar.className = 'ui-slot__tabs';
    bar.setAttribute('role', 'tablist');
    bar.setAttribute('aria-label', t('界面插件'));
    const holder = slots.holder(slot);
    bar.replaceChildren(...list.map((rec) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ui-slot__tab';
      b.setAttribute('role', 'tab');
      const label = pluginName(rec.entry) || rec.id;
      b.textContent = label;
      b.title = label;
      b.setAttribute('aria-selected', holder === rec.id ? 'true' : 'false');
      b.addEventListener('click', () => {
        chosenSlot.set(slot, rec.id);
        assignSlots();
        for (const frame of frames.values()) place(frame);
        renderSlotTabs();
      });
      return b;
    }));
    if (!old) el.prepend(bar);
  }
}

function placeAll() {
  assignSlots();
  for (const rec of frames.values()) place(rec);
  renderSlotTabs();
}

/**
 * [ASSUMED] grant the first declared slot that currently has an element and is free, else the first free one.
 * @param {string} id @param {string[]} declared
 */
function autoGrant(id, declared) {
  const allowed = declared.filter((s) => UI_SLOTS.includes(s));
  const withEl = allowed.find((s) => document.querySelector(`[data-ui-slot="${s}"]`) && !slots.holder(s));
  const pick = withEl || allowed.find((s) => !slots.holder(s));
  if (!pick) return;
  slots.request(id, pick, allowed);
}

/** @param {any} entry */
function mount(entry, preview = null) {
  const id = entry.id;
  if (frames.has(id) || frames.size >= UI_LIMITS.maxPlugins) return;
  const rel = typeof entry.entry === 'string' ? entry.entry : null;
  const sha = rel && entry.frameFiles && typeof entry.frameFiles[rel] === 'string' ? entry.frameFiles[rel] : null;
  const src = rel && sha ? framePageUrl(id, rel, sha) : null;
  if (!src) return;
  const declared = Array.isArray(entry.slots) ? entry.slots.filter((s) => typeof s === 'string') : [];
  const iframe = document.createElement('iframe');
  iframe.className = 'ui-slot__frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.referrerPolicy = 'no-referrer';
  iframe.setAttribute('credentialless', '');
  iframe.setAttribute('allow', '');
  iframe.title = pluginName(entry) || id;
  iframe.dataset.plugin = id;
  /** @type {FrameRec} */
  // `effects` and the two `dj-rotate` fields are the record's own effect state: `effectWanted` / `effectVariant` /
  // `rotateHolder` read them for EVERY mounted frame — they must exist from the moment the frame is mounted, or the
  // first `setFieldView` after a plugin is on (the match screen's handover, public/js/ui/fieldHost.js useFieldView)
  // throws `Cannot read properties of undefined (reading 'has')` and the board never loads.
  const rec = { id, iframe, declared, entry, ready: false, preview, entries: preview ? Object.create(null) : loadEntries(id), limitAt: 0, loads: 0, closed: false, effects: new Set(), variant: null, tune: null, tuneAt: 0 };
  frames.set(id, rec);
  autoGrant(id, declared);
  iframe.addEventListener('load', () => {
    if (frames.get(id) !== rec || rec.closed) return;
    rec.loads += 1;
    const decision = frameLoadDecision(rec.loads);
    if (decision === 'destroy') { stopForLeaving(id); return; }
    // The entry document. welcome does not include the private view; ready (accepted only at this count) does.
    // `net` is not the private view: the panel reads it during mount, before ready.
    if (decision === 'entry') {
      if (!rec.preview) postNetNow(rec);
      post(rec, hostWelcome(id, declared, rec.preview ? undefined : welcomeInfo(rec)));
      // The entry painted: show it. Until now the frame was hidden (components.css, `.ui-slot__frame` without
      // `is-ready`) so its blank first document could not flash a backdrop over the game.
      rec.iframe.classList.add('is-ready');
      // and tell it where its frame is and how big the play area is, so a drag has an origin and a saved place can be
      // restored as a fraction of it
      postFrame(rec);
    }
  });
  iframe.src = src;
  place(rec);
}

/** @param {string} id @returns {Record<string, string>} */
function loadEntries(id) {
  /** @type {Record<string, string>} */
  const entries = Object.create(null);
  const prefix = `sp.plugin.${id}.`;
  let ls;
  try { ls = globalThis.localStorage; } catch { return entries; }
  if (!ls) return entries;
  try {
    for (let i = 0; i < ls.length; i++) {
      const full = ls.key(i);
      if (!full || !full.startsWith(prefix)) continue;
      const key = full.slice(prefix.length);
      if (!namespacedStorageKey(id, key)) continue;
      const raw = ls.getItem(full);
      if (raw != null) entries[key] = raw;
    }
  } catch { /* privacy mode */ }
  return entries;
}

/** Scalar prefs already in the host page's storage. Objects are not sent. Intent-typed keys are not sent. */
function welcomeInfo(rec) {
  const room = subsetRoom(store.get().room);
  /** @type {Record<string, string | number | boolean>} */
  const prefs = {};
  let n = 0;
  for (const key of Object.keys(rec.entries || {})) {
    if (n >= 32) break;
    if (isIntentType(key)) continue;
    let value;
    try { value = JSON.parse(rec.entries[key]); } catch { continue; }
    if (typeof value === 'string') {
      if (value.length > 4096) continue;
      prefs[key] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) prefs[key] = value;
    else if (typeof value === 'boolean') prefs[key] = value;
    else continue;
    n += 1;
  }
  return {
    version: PROTOCOL_VERSION,
    lang: getLang(),
    plugins: room && Array.isArray(room.plugins) ? room.plugins : [],
    cs: room && room.cs,
    prefs,
  };
}

/** @param {FrameRec} rec */
function postNetNow(rec) {
  if (rec.netAt != null) return;
  const msg = hostNet(store.get().connection);
  try { rec.netText = JSON.stringify(msg); } catch { return; }
  rec.netAt = Date.now();
  post(rec, msg);
}

function scheduleState() {
  if (stateTimer) return;
  stateTimer = window.setTimeout(() => {
    stateTimer = 0;
    const s = store.get();
    const m = s.match;
    const msg = hostState(m && m.public, m && m.private, s.room);
    let text = '';
    try { text = JSON.stringify(msg); } catch { return; }
    if (text === lastState) return;
    lastState = text;
    for (const rec of frames.values()) if (feeding(rec)) post(rec, msg);
  }, STATE_MS);
}

function scheduleNet() {
  if (netTimer) return;
  const msg = hostNet(store.get().connection);
  let text = '';
  try { text = JSON.stringify(msg); } catch { return; }
  const now = Date.now();
  let wait = Infinity;
  // Delivery is tracked per document: initializing a sibling must not consume a pending broadcast.
  for (const rec of frames.values()) {
    if (!feeding(rec) || rec.preview || text === rec.netText) continue;
    const slot = netSlot(rec.netAt, now, Math.round(1000 / UI_LIMITS.netHz));
    if (!slot.send) { wait = Math.min(wait, slot.wait); continue; }
    rec.netAt = now;
    rec.netText = text;
    post(rec, msg);
  }
  if (Number.isFinite(wait)) netTimer = window.setTimeout(() => { netTimer = 0; scheduleNet(); }, wait);
}

function scheduleResult() {
  const m = store.get().match;
  const msg = hostResult(m && m.result);
  let text = '';
  try { text = JSON.stringify(msg); } catch { return; }
  if (text === lastResultText) return;
  lastResultText = text;
  for (const rec of frames.values()) if (feeding(rec) && !rec.preview) post(rec, msg);
}

function flushBattle() {
  battleTimer = 0;
  const events = battleQueue;
  battleQueue = [];
  const msg = battlePayload({ fieldId: battleField, gt: battleGt, events, snap: lastSnap });
  for (const rec of frames.values()) if (feeding(rec)) post(rec, msg);
}

function scheduleBattle() {
  if (battleTimer) return;
  battleTimer = window.setTimeout(flushBattle, SLOT_MS);
}

/** @param {FrameRec} rec */
function noteLimit(rec) {
  const now = Date.now();
  if (now - rec.limitAt < LIMIT_MS) return;
  rec.limitAt = now;
  post(rec, hostLimit('rate'));
  try { toast(t('界面插件发送得太快，请稍后再试'), 'warn'); } catch { /* the toast host may be absent */ }
}

/** @param {FrameRec} rec @param {Record<string, unknown>} msg */
function onStorage(rec, msg) {
  const op = msg.op;
  const key = typeof msg.key === 'string' ? msg.key : '';
  if (op === 'keys') {
    post(rec, { v: 1, t: 'storage', op: 'keys', keys: Object.keys(rec.entries), ok: true });
    return;
  }
  const full = namespacedStorageKey(rec.id, key);
  if (!full) {
    post(rec, { v: 1, t: 'storage', op, key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    return;
  }
  if (op === 'get') {
    const text = rec.entries[key];
    if (text == null) {
      post(rec, { v: 1, t: 'storage', op: 'get', key, value: null, ok: true });
      return;
    }
    try {
      post(rec, { v: 1, t: 'storage', op: 'get', key, value: JSON.parse(text), ok: true });
    } catch {
      post(rec, { v: 1, t: 'storage', op: 'get', key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    }
    return;
  }
  if (op === 'delete') {
    delete rec.entries[key];
    try { if (!rec.preview) globalThis.localStorage?.removeItem(full); } catch { /* ignore */ }
    post(rec, { v: 1, t: 'storage', op: 'delete', key, ok: true });
    return;
  }
  const checked = checkStorageWrite(rec.entries, key, msg.value);
  if (!checked.ok) {
    post(rec, { v: 1, t: 'storage', op: 'set', key, ok: false, error: checked.error });
    return;
  }
  rec.entries[key] = checked.text;
  try { if (!rec.preview) globalThis.localStorage?.setItem(full, checked.text); } catch {
    delete rec.entries[key];
    post(rec, { v: 1, t: 'storage', op: 'set', key, ok: false, error: UI_ERRORS.PLUGIN_STORAGE });
    return;
  }
  post(rec, { v: 1, t: 'storage', op: 'set', key, ok: true });
}

/** @param {FrameRec} rec @param {Record<string, unknown>} msg */
function handle(rec, msg) {
  if (msg.t === 'ready') {
    // Only the entry document may initialize, once. Duplicate ready must not bypass feed throttling.
    // welcome is posted from the load handler, not from here, so a plugin that answers welcome cannot loop.
    if (rec.ready || frameLoadDecision(rec.loads) !== 'entry') return;
    rec.ready = true;
    const live = store.get();
    const m = rec.preview?.state || live.match;
    post(rec, hostState(m && m.public, m && m.private, rec.preview ? undefined : live.room));
    if (!rec.preview) {
      postNetNow(rec);
      scheduleNet();
      const result = hostResult(m && m.result);
      post(rec, result);
    }
    return;
  }
  if (msg.t === 'slot') {
    const r = slots.request(rec.id, /** @type {string} */ (msg.slot), rec.declared);
    post(rec, { v: 1, t: 'slot', slot: msg.slot, ok: r.ok === true, ...(r.ok ? {} : { error: r.error }) });
    // asking for a slot again is letting go of the box it placed itself in (`frame`): the slot's own box comes back
    if (r.ok && rec.frame) clearFrame(rec);
    if (r.ok) place(rec);
    return;
  }
  if (msg.t === 'resize') {
    const h = clampHeight(/** @type {number} */ (msg.height));
    if (h == null) { post(rec, hostRejected('shape')); return; }
    rec.iframe.style.height = `${h}px`;
    return;
  }
  if (msg.t === 'notice') {
    const text = clampNotice(msg.text);
    if (!text) { post(rec, hostRejected('shape')); return; }
    // A different line waits 2s. The same line still reaches the toast host, which merges it. No toast on the limit
    // itself (the token-bucket warning already has its own 2s debounce).
    if (!noticeLimiter.allow(rec.id, text)) { post(rec, hostLimit('notice')); return; }
    try { toast(text, 'info'); } catch { /* ignore */ }
    return;
  }
  if (msg.t === 'stats') {
    const unitId = /** @type {number} */ (msg.unitId);
    const fieldId = typeof msg.fieldId === 'string' ? msg.fieldId : null;
    let stats = null;
    try {
      stats = rec.preview ? { dmg: 120, heal: 0, taken: 0 } : battleRunner && typeof battleRunner.unitStats === 'function' ? battleRunner.unitStats(unitId, fieldId) : null;
    } catch { stats = null; }
    post(rec, { v: 1, t: 'stats', unitId, fieldId, stats: stats && typeof stats === 'object' ? stats : null });
    return;
  }
  if (msg.t === 'frame') {
    // (x, y) in play-area (match screen) CSS px; the host clamps the box and moves the slot, so the page is not
    // reloaded and a drag in progress keeps its pointer capture (applyFrame). A plugin usually posts this before the
    // match screen's slot exists (its page loads first), so the request is remembered and applied when it does.
    rec.frameReq = { x: msg.x, y: msg.y, w: msg.w, h: msg.h };
    applyFrameRequest(rec);
    return;
  }
  if (msg.t === 'effect') {
    // One of UI_EFFECTS (validatePluginMessage already refused anything else), the requester's own switch.
    setEffect(rec, /** @type {string} */ (msg.name), msg.on === true,
      typeof msg.variant === 'string' ? msg.variant : null,
      typeof msg.strategy === 'string' ? msg.strategy : null,
      msg.tune && typeof msg.tune === 'object' ? msg.tune : null);
    return;
  }
  if (msg.t === 'storage') onStorage(rec, msg);
}

function onWindowMessage(ev) {
  let rec = null;
  for (const item of frames.values()) {
    if (item.iframe.contentWindow && item.iframe.contentWindow === ev.source) { rec = item; break; }
  }
  if (!rec) return;
  if (ev.origin !== 'null') return;
  const verdict = validatePluginMessage(ev.data);
  const allowed = limiter.allow(rec.id);
  if (!verdict.ok && verdict.reason === 'intent') {
    if (rejected.length < 50) rejected.push('intent');
    post(rec, hostRejected('intent'));
  }
  if (!allowed) { noteLimit(rec); return; }
  if (!verdict.ok) {
    if (verdict.reason !== 'intent') post(rec, hostRejected(verdict.reason));
    return;
  }
  const msg = verdict.msg;
  // The child's script runs before the parent's load event, and postMessage is queued before that load.
  // Applying the message on the next turn lets a navigation that already queued its load destroy the frame first,
  // so ready on the new document does not pull state. A task that was queued even earlier can still post once
  // (DESIGN §32.8 [ASSUMED]).
  setTimeout(() => {
    if (frames.get(rec.id) !== rec || rec.closed) return;
    if (frameLoadDecision(rec.loads) === 'destroy') { stopForLeaving(rec.id); return; }
    handle(rec, msg);
  }, 0);
}

function sync() {
  const ids = uiPlugins.get().ids;
  if (!ids.length) { destroyAll(); return; }
  if (!installedCount(store.get())) return;
  const cat = catalog.get();
  if (cat.status !== 'ready') {
    if (cat.status !== 'loading') loadCatalog();
    return;
  }
  const entries = uiPluginEntries(cat.plugins);
  const want = [];
  for (const id of ids) {
    if (want.length >= UI_LIMITS.maxPlugins) break;
    if (blocked.has(id)) continue;
    if (entries.some((p) => p.id === id)) want.push(id);
  }
  const keep = new Set(want);
  for (const id of [...frames.keys()]) if (!keep.has(id)) destroy(id);
  for (const id of want) {
    if (!frames.has(id)) mount(entries.find((p) => p.id === id));
  }
  placeAll();
}

function boot() {
  if (booted || typeof window === 'undefined' || typeof document === 'undefined') return;
  booted = true;
  globalThis.__SP_UI_PLUGINS__ = api;
  window.addEventListener('message', onWindowMessage);
  const obs = new MutationObserver((records) => {
    let changed = false;
    for (const rec of records) {
      for (const node of rec.removedNodes) if (rescue(node)) changed = true;
      for (const node of rec.addedNodes) {
        if (node.nodeType !== 1) continue;
        const el = /** @type {Element} */ (node);
        if ((el.getAttribute && el.getAttribute('data-ui-slot')) || (el.querySelector && el.querySelector('[data-ui-slot]'))) changed = true;
      }
    }
    if (changed) placeAll();
  });
  const arm = () => {
    if (!document.body) return;
    parkEl();
    obs.observe(document.body, { childList: true, subtree: true });
    sync();
  };
  if (document.body) arm();
  else document.addEventListener('DOMContentLoaded', arm, { once: true });
  uiPlugins.subscribe(() => sync());
  catalog.subscribe(() => sync());
  store.subscribe((s, prev) => {
    if (!prev || s.installedPlugins !== prev.installedPlugins) sync();
    if (!prev || s.match !== prev.match || s.room !== prev.room) scheduleState();
    if (!prev || s.connection !== prev.connection) scheduleNet();
    if (!prev || s.match !== prev.match || (s.match && prev.match && s.match.result !== prev.match.result)) scheduleResult();
  });
  if (battleRunner && typeof battleRunner.on === 'function') {
    battleRunner.on('ev', (payload) => {
      const list = payload && Array.isArray(payload.ev) ? payload.ev : [];
      for (const ev of list) battleQueue.push(ev);
      while (battleQueue.length > UI_LIMITS.battleBatch) battleQueue.shift();
      if (payload && typeof payload.fieldId === 'string') battleField = payload.fieldId;
      if (payload && typeof payload.gt === 'number') battleGt = payload.gt;
      scheduleBattle();
    });
    battleRunner.on('snap', (frame) => {
      lastSnap = frame;
      if (frame && typeof frame.fieldId === 'string') battleField = frame.fieldId;
      if (frame && typeof frame.gt === 'number') battleGt = frame.gt;
      scheduleBattle();
    });
  }
}

/** Studio preview through the exact game host. [ASSUMED] Only fake state and volatile storage; never gameplay data. */
export function mountPluginPreview(entry, host) {
  if (!host || !entry || entry.class !== 'ui') return null;
  destroy(entry.id);
  const preview = { host, state: { public: { phase: 'COMBAT', round: 1, players: [] }, private: { playerId: 'preview', funds: 10 } } };
  mount(entry, preview);
  const rec = frames.get(entry.id);
  if (!rec) return null;
  let gt = 0;
  const timer = setInterval(() => {
    if (!feeding(rec)) return;
    gt += 1;
    post(rec, battlePayload({ fieldId: 'preview', gt, events: [['dmg', 1, 120, 'phys']], snap: null }));
  }, 1000);
  return { close() { clearInterval(timer); if (frames.get(entry.id) === rec) destroy(entry.id); } };
}

boot();


// ---- the ui host surface added on this line: a placed `frame` and the three `effect` visuals --------------

/** The element a frame's slot lives in (`[data-ui-slot]`), or null while there is no such screen. @param {FrameRec} rec */
function slotElement(rec) {
  const slot = slots.slotOf(rec.id);
  return slot ? document.querySelector(`[data-ui-slot="${slot}"]`) : null;
}

/** The match screen and its size: the play area a `frame` message places the plugin's box in. */
function playArea() {  const el = document.querySelector(MATCH_SELECTOR);
  if (!el) return null;
  const w = el.clientWidth;
  const h = el.clientHeight;
  return w > 0 && h > 0 ? { el, w, h } : null;
}

/**
 * The frame's place in play-area coordinates, read off its slot (the host owns the slot's style; the plugin never does).
 * @param {FrameRec} rec @param {Element} slot @param {{ el: Element, w: number, h: number }} area
 */
function frameOf(rec, slot, area) {
  const r = slot.getBoundingClientRect();
  const a = area.el.getBoundingClientRect();
  return {
    x: Math.round(r.left - a.left),
    y: Math.round(r.top - a.top),
    w: Math.round(r.width) || rec.frame?.w || UI_LIMITS.frameMinWidth,
    h: Math.round(r.height) || rec.frame?.h || UI_LIMITS.heightMin,
  };
}

/**
 * The host's answer: where the frame now is and how big the play area is. A plugin needs both to turn a pointer
 * position into a place (and to remember that place as a fraction).
 * @param {FrameRec} rec
 */
function postFrame(rec) {
  const area = playArea();
  const slot = slotElement(rec);
  if (!area || !slot) return;
  post(rec, hostFrame(rec.frame || frameOf(rec, slot, area), area.w, area.h));
}

/**
 * Put a frame at a clamped rect. The slot moves (not the iframe), so the page is not reloaded and a drag in progress
 * keeps its pointer capture. `right`/`bottom` are cleared so the slot has one source of coordinates.
 * @param {FrameRec} rec @param {{ x: number, y: number, w: number, h: number }} box
 */
function applyFrame(rec, box) {
  const slot = slotElement(rec);
  if (!slot) return;
  rec.frame = box;
  slot.classList.add('is-placed');
  slot.style.left = `${box.x}px`;
  slot.style.top = `${box.y}px`;
  slot.style.right = 'auto';
  slot.style.bottom = 'auto';
  slot.style.width = `${box.w}px`;
  slot.style.height = `${box.h}px`;
  rec.iframe.style.height = `${box.h}px`;
}

/**
 * Apply the box the plugin last asked for (`frame`), now: clamp it against the play area and move the slot. Returns
 * false while there is nothing to move (no match screen / no slot yet) — the request stays on the record, and `place()`
 * applies it again as soon as the slot exists (a plugin's page loads before the match screen's slot does).
 * @param {FrameRec} rec @returns {boolean}
 */
function applyFrameRequest(rec) {
  const req = rec.frameReq;
  const area = playArea();
  const slot = slotElement(rec);
  if (!req || !area || !slot) return false;
  const box = clampFrame({ x: req.x, y: req.y, w: req.w ?? area.w, h: req.h ?? rec.frame?.h ?? area.h }, area.w, area.h);
  if (!box) return false;
  applyFrame(rec, box);
  postFrame(rec);
  return true;
}

/** Forget the inline place (a slot that was re-created keeps the stylesheet's default). @param {FrameRec} rec */
function clearFrame(rec) {
  const slot = slotElement(rec);
  rec.frame = undefined;
  rec.frameReq = null;                // the slot's own box is the request now, so a late `place()` must not re-apply it
  if (!slot) return;
  slot.classList.remove('is-placed');
  for (const prop of ['left', 'top', 'right', 'bottom', 'width', 'height']) slot.style.removeProperty(prop);
}

/** @returns {boolean} whether the user asked for reduced motion (the browser setting, or a CSS-level media query) */
function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** @param {string} name @returns {boolean} whether any mounted plugin still holds that effect switched on */
function effectWanted(name) {
  for (const other of frames.values()) if (other.effects.has(name)) return true;
  return false;
}

/**
 * The strategy a still-wanted `units-gif` should draw with: the variant the plugin that still asks for it recorded
 * (the first mounted one wins; a plugin that never sent one means the default `amiya2`). Called when the plugin that
 * asked for another strategy lets go, so the remaining plugin's choice comes back rather than being switched off.
 * @param {string} name @param {FrameRec} [except]
 * @returns {string}
 */
function effectVariant(name, except) {
  for (const rec of frames.values()) {
    if (rec === except || !rec.effects.has(name)) continue;
    return rec.variant || DEFAULT_UNIT_VARIANT;
  }
  return DEFAULT_UNIT_VARIANT;
}

/**
 * `units-gif` on the field view. The view applies it (render/unitsGif.js) and answers whether it is on; without a view
 * (no match, the DOM fallback) there is nothing to replace. `variant` names the strategy (`UI_UNIT_VARIANTS`;
 * absent / null = the default `amiya2`). Reduced motion leaves it off.
 * @param {boolean} on @param {string | null} [variant]
 * @returns {boolean} whether the field is showing the stand-ins
 */
function setFieldUnitsGif(on, variant) {
  if (!on) { fieldView?.setUnitsGif?.(false); return false; }
  if (!fieldView || typeof fieldView.setUnitsGif !== 'function') return false;
  try { return fieldView.setUnitsGif(true, variant || DEFAULT_UNIT_VARIANT) === true; } catch { return false; }
}

/**
 * `dj-rotate` on the field view: the canvas half of the 整活 (public/js/render/djRotate.js — pieces, enemies and items
 * on the board turn and are squashed with the HUD). The view answers whether it is on; without a view (no match, the
 * DOM fallback) only the HUD class is left. Reduced motion leaves it off.
 * @param {boolean} on @param {{ turn?: number, squash?: number, pulse?: number } | null} [tune] the requester's numbers
 * @returns {boolean} whether the field is turning
 */
function setFieldDjRotate(on, tune) {
  if (!on) { fieldView?.setDjRotate?.(false); return false; }
  if (!fieldView || typeof fieldView.setDjRotate !== 'function') return false;
  try { return fieldView.setDjRotate(true, tune || null) === true; } catch { return false; }
}

/**
 * Write a `dj-rotate` tuning on the HUD as the custom properties the stylesheet reads
 * (`--gm-dj-turn-dur`, `--gm-dj-depth`, `--gm-dj-pulse-dur`), or take them all off for a plugin that sends none / a
 * handover to a plugin without one — so the stylesheet's reference numbers apply again and nothing of the previous
 * requester is left in the inline style.
 * @param {HTMLElement} hud @param {{ turn?: number, squash?: number, pulse?: number } | null} tune
 */
function applyRotateVars(hud, tune) {
  const t = tune || {};
  for (const [key, spec] of Object.entries(ROTATE_VARS)) {
    const v = t[key];
    if (typeof v === 'number' && Number.isFinite(v)) hud.style.setProperty(spec.prop, v + spec.suffix);
    else hud.style.removeProperty(spec.prop);
  }
}

/**
 * The mounted plugin whose numbers the one HUD (and the one field) draw with: the **most recent** one that still holds
 * `dj-rotate` (a press is a request, so the button just pressed is the one whose look is shown). There is one HUD and one
 * board, so only one tuning can be in force at a time; this is what makes "one plugin's values never leak into another's"
 * hold in both directions: a plugin that lets go hands the effect to the previous requester's own numbers (or to the
 * stylesheet's, for one that sent no `tune`) instead of switching it off or leaving the released plugin's values behind.
 * @returns {FrameRec | null}
 */
function rotateHolder() {
  let best = null;
  for (const rec of frames.values()) {
    if (!rec.effects.has(ROTATE_EFFECT)) continue;
    if (!best || rec.tuneAt > best.tuneAt) best = rec;
  }
  return best;
}

/**
 * Put the `dj-rotate` visual where the plugins that ask for it say it should be: the class plus the requester's three
 * numbers on the HUD, and the same numbers on the field view's root containers. No plugin left = both halves off, the
 * class and every inline property removed (nothing of the effect survives).
 * @returns {boolean} whether the visual is on
 */
function applyDjRotate() {
  const holder = rotateHolder();
  const hud = document.querySelector('.gm__hud');
  if (!holder) {
    if (hud) { hud.classList.remove(EFFECT_CLASS); applyRotateVars(hud, null); }
    setFieldDjRotate(false);
    return false;
  }
  const tune = holder.tune || null;
  setFieldDjRotate(true, tune);
  if (hud) { hud.classList.add(EFFECT_CLASS); applyRotateVars(hud, tune); }
  return true;
}

/** Take the `dj-neon` box away, if there is one. Removing the node is the whole undo: its classes, children and
 *  animations go with it, so the document is what it was (nothing is hidden or reset in place). The document is the
 *  authority, not the `neonEl` handle: a box left behind by an earlier handle (a remount, a second plugin) must go too,
 *  or a plugin that turned the effect off would still see the lighting. */
function removeNeon() {
  neonEl = null;
  if (typeof document === 'undefined') return;
  for (const node of document.querySelectorAll(`.${NEON_CLASS}`)) node.remove();
}

/** A fresh non-zero 32-bit seed for one `dj-neon` box (crypto when the page has it, the clock otherwise). */
function neonSeed() {
  try {
    const a = new Uint32Array(1);
    globalThis.crypto.getRandomValues(a);
    if (a[0]) return a[0];
  } catch { /* no crypto in this context */ }
  return ((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0) || 1;
}

/** Plain integer PRNG (mulberry32) over one seed, so every blob of a box comes from that box's own seed. */
function neonRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `dj-neon`'s defaults — the one place to tune the look. The effect is a host capability shared by every ui plugin
 * that names it (no plugin brings code or style of its own): one palette, one set of ranges, one blob count. A new
 * random seed per playback draws a layout out of these ranges; changing the strength, the palette or the count is a
 * change here and nowhere else.
 */
const NEON_TUNING = Object.freeze({
  /** inclusive blob count per playback (4–8) */
  blobs: Object.freeze([4, 8]),
  /** the fixed palette (hue degrees) each blob's hue is drawn around */
  palette: Object.freeze([330, 288, 205, 168, 96, 42, 16, 252]),
  /** ± degrees a blob's hue may sit off its palette entry */
  hueJitter: 26,
  /** the peak opacity one blob reaches (the effect stays soft) */
  peak: Object.freeze([0.28, 0.42]),
  /** per-blob blur (the feather; never a blur of the whole layer) */
  blurPx: Object.freeze([40, 72]),
  /** the flash cycle a blob's brightness jumps on */
  flashSec: Object.freeze([0.74, 1.18]),
  /** the slow drift: direction and distance in CSS px, and how long one leg takes */
  driftPx: Object.freeze([-70, 70]),
  driftSec: Object.freeze([9, 13]),
  /** the blob's box and where it sits (percent of the viewport) */
  widthPct: Object.freeze([22, 42]),
  heightPct: Object.freeze([26, 50]),
  xPct: Object.freeze([-12, 82]),
  yPct: Object.freeze([-14, 76]),
});

/**
 * `dj-neon` on the match screen: two host-owned decorative layers over the whole match, drawn from CSS classes only
 * (public/css/screens/game.css). One fixed, full-screen box lives on the body — never inside `.screen.gm` or
 * `.gm__hud`: Preact re-renders the match screen's children and would drop a foreign node there, and the HUD's own
 * `scale` (the `dj-rotate` effect) must not reach this layer, so the rim keeps covering all four corners at every
 * phase of the turn. Its z-index is above the screen and below banners/dialogs/toasts, and `pointer-events: none`
 * keeps every click on the game.
 *
 * Layer A is the rim (the box's own class: the masked conic rainbow, the breathing and the fade-in). Layer B is a
 * set of 4–8 blobs whose box, hue, timing, drift and blur are chosen here from a NEW random seed on every `on: true`
 * out of `NEON_TUNING` (the box writes them as custom properties once; the motion is CSS), so two playbacks never
 * look the same. One box per match: asking again while it is up changes nothing (idempotent) and keeps the same seed,
 * a second plugin asking for the same effect keeps the one box, and without a match screen there is nothing to
 * decorate (the effect is not remembered). Removing the node is the whole undo, so nothing is hidden or reset in
 * place. Reduced motion never creates it.
 * @param {boolean} on
 * @returns {boolean} whether the layers are up
 */
function setNeon(on) {
  if (!on) { removeNeon(); return false; }
  if (!playArea()) return false;
  if (neonEl && neonEl.isConnected) return true;
  removeNeon();
  const root = document.createElement('div');
  root.className = NEON_CLASS;
  root.setAttribute('aria-hidden', 'true');
  const seed = neonSeed();
  root.dataset.seed = String(seed);
  const rnd = neonRandom(seed);
  const range = ([lo, hi]) => lo + (hi - lo) * rnd();
  const edge = document.createElement('div');
  edge.className = 'gm__neon__edge';
  const rainbow = document.createElement('div');
  rainbow.className = 'gm__neon__rainbow';
  edge.appendChild(rainbow);
  root.appendChild(edge);
  const count = Math.round(range(NEON_TUNING.blobs));
  for (let i = 0; i < count; i += 1) {
    const blob = document.createElement('div');
    blob.className = 'gm__neon__blob';
    // where, how big, which hue, how fast it flashes and how it drifts — one draw each, never the same twice
    const hue = NEON_TUNING.palette[Math.floor(rnd() * NEON_TUNING.palette.length)] + (rnd() * 2 - 1) * NEON_TUNING.hueJitter;
    blob.style.setProperty('--gm-neon-x', `${range(NEON_TUNING.xPct).toFixed(1)}%`);
    blob.style.setProperty('--gm-neon-y', `${range(NEON_TUNING.yPct).toFixed(1)}%`);
    blob.style.setProperty('--gm-neon-w', `${range(NEON_TUNING.widthPct).toFixed(1)}%`);
    blob.style.setProperty('--gm-neon-h', `${range(NEON_TUNING.heightPct).toFixed(1)}%`);
    blob.style.setProperty('--gm-neon-hue', String(Math.round((hue + 360) % 360)));
    blob.style.setProperty('--gm-neon-dur', `${range(NEON_TUNING.flashSec).toFixed(2)}s`);
    blob.style.setProperty('--gm-neon-delay', `${(-range([0, 1.1])).toFixed(2)}s`);
    blob.style.setProperty('--gm-neon-peak', range(NEON_TUNING.peak).toFixed(2));
    blob.style.setProperty('--gm-neon-blur', `${Math.round(range(NEON_TUNING.blurPx))}px`);
    blob.style.setProperty('--gm-neon-dx', `${Math.round(range(NEON_TUNING.driftPx))}px`);
    blob.style.setProperty('--gm-neon-dy', `${Math.round(range(NEON_TUNING.driftPx) * 0.85)}px`);
    blob.style.setProperty('--gm-neon-drift-dur', `${range(NEON_TUNING.driftSec).toFixed(1)}s`);
    blob.style.setProperty('--gm-neon-drift-delay', `${(-range(NEON_TUNING.driftSec)).toFixed(1)}s`);
    root.appendChild(blob);
  }
  document.body.appendChild(root);
  neonEl = root;
  return true;
}

/**
 * One named, reversible host visual (the three names of shared/plugins/ui.js UI_EFFECTS — validatePluginMessage
 * already refused anything else).
 *
 * `dj-rotate` is one class on the battle HUD plus one transform of each field view's root container: added while a
 * plugin asks for it, removed when none does, so the HUD's parts are back at their own `transform` and every unit
 * container at its own `scale` at once. Its `tune` (three bounded numbers, `UI_ROTATE_TUNE`) is remembered on the
 * plugin's own record and written as the HUD's custom properties — so the look is the requester's, and a handover to
 * another plugin (or back to the stylesheet's reference defaults) rewrites all three, never only some. `units-gif` is
 * the field view's stand-in layer: while a plugin asks for it every unit on the field is hidden and an animated GIF
 * follows it, and when none does the stand-ins are destroyed and the views show themselves again (render/unitsGif.js —
 * visibility only, nothing is recomputed). Its `variant` is the strategy that session draws (`DEFAULT_UNIT_VARIANT`
 * when absent); its `strategy` is the fixed-sheet parameter (`amiya`), which wins when a message carries it. A plugin
 * that lets go while another still asks for `units-gif` hands the visual back to that plugin's own strategy instead of
 * switching it off. `dj-neon` is the one decorative box on the body (`setNeon`). Reduced motion leaves any of them
 * off, and a message whose visual could not be applied is not remembered (an `off` then has nothing to undo).
 * @param {FrameRec} rec @param {string} name @param {boolean} on @param {string | null} [variant]
 * @param {string | null} [strategy] @param {{ turn?: number, squash?: number, pulse?: number } | null} [tune]
 */
function setEffect(rec, name, on, variant, strategy, tune) {
  if (name !== ROTATE_EFFECT && name !== GIF_EFFECT && name !== NEON_EFFECT) return;
  if (on) {
    if (reducedMotion()) return;
    // The request is recorded FIRST, then applied best-effort: a half of the visual that is not ready yet (the field
    // view still mounting, the match screen not in the document) must not drop the whole request — `setFieldView` and
    // the next `place()` re-apply what is recorded, so a plugin that asked early still gets its effect.
    if (name === GIF_EFFECT) {
      // the controlled parameters: `variant` is one of UI_UNIT_VARIANTS, `strategy` one of UI_UNIT_STRATEGIES (the
      // validator refused anything else, and refused both at once); absent = the default strategy
      rec.variant = typeof strategy === 'string'
        ? strategy
        : (typeof variant === 'string' ? variant : DEFAULT_UNIT_VARIANT);
    }
    // `dj-rotate`'s own numbers (`tune`): the validator already refused another name, an unknown key or a wide value;
    // absent = the stylesheet's reference defaults (nothing is written for it). `tuneAt` orders the requesters: the
    // most recent press is the one whose numbers are in force while several plugins ask for the same visual.
    if (name === ROTATE_EFFECT) { rec.tune = tune || null; rec.tuneAt = ++rotateSeq; }
    rec.effects.add(name);
    if (name === GIF_EFFECT) { setFieldUnitsGif(true, rec.variant); return; }
    if (name === NEON_EFFECT) { setNeon(true); return; }
    applyDjRotate();
    return;
  } else {
    rec.effects.delete(name);
    if (name === GIF_EFFECT) rec.variant = null;
    if (name === ROTATE_EFFECT) { rec.tune = null; rec.tuneAt = 0; }
    // another mounted plugin still asks for it: the visual stays on, at that plugin's own strategy / numbers
    if (effectWanted(name)) {
      if (name === GIF_EFFECT) setFieldUnitsGif(true, effectVariant(name, rec));
      else if (name === ROTATE_EFFECT) applyDjRotate();
      return;
    }
    if (name === GIF_EFFECT) { setFieldUnitsGif(false); return; }
    if (name === NEON_EFFECT) { setNeon(false); return; }
  }
  if (name !== ROTATE_EFFECT) return;
  applyDjRotate();
}

/**
 * The match screen hands over the field view it mounted (`useFieldView`, screens/game.js) — the host visuals that draw
 * on the field live on it. A new view gets the effects the plugins currently ask for re-applied, so a remount can never
 * leave a stand-in layer behind on a dead view; `null` (the screen unmounted) means there is no field any more.
 * @param {any} view the guarded view (public/js/ui/fieldHost.js) or null
 */
export function setFieldView(view) {
  fieldView = view && typeof view === 'object' ? view : null;
  setFieldUnitsGif(effectWanted(GIF_EFFECT), effectVariant(GIF_EFFECT));
  // the same numbers the mounted requester chose (no requester = off), never the stylesheet's by accident
  applyDjRotate();
  // The neon box lives on the body, not on the view: a screen that unmounts must take it with it, and a screen that
  // mounts while a plugin still asks for it gets it back (one box, never two).
  setNeon(view ? effectWanted(NEON_EFFECT) : false);
}
