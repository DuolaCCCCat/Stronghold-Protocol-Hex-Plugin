// Emotes (交流, research 09 §4): the 36 official in-match emotes of 盟约 — 6 themes × 6 (shared/constants.js
// EMOTE_THEMES / EMOTES, generated reference data/emotes.json) — plus the custom packs of 2026-10-18 (two more wheel
// pages, EMOTE_WHEEL_THEMES / CUSTOM_EMOTE_THEMES, art under /img/emotes/). Emotes are pictures only: nothing here ever
// renders an emote's text (our labels are aria-labels only).
//
//   EmoteArt    the emote picture: the local-client art (data/local-assets.json → emoticon/<dir>/<picId>) first, else
//               the copy setup downloads from the public mirror (data/assets.json → ui['emoticon/<dir>/<picId>'];
//               GitHub issue #42), each tried in turn when one fails to load; a neutral glyph when neither is there.
//               An empty box only while a manifest is still in flight; a timeout or a failed manifest (GitHub #99)
//               uses that glyph, and a later success replaces it.
//   EmoteBubble the pop bubble beside the sender's avatar in the team panel (official emoji_bubble_bkg: a dark rounded
//               square with a tail pointing left + the icon only); pop-in, 3 s, fade. The parent keys it by the emote's
//               seq so a newer emote replaces the old one and pops again, and passes the arrival time (`at`) so a
//               bubble mounted late resumes its timeline instead of restarting it.
//   EmoteWheel  bottom-left 交流 button (official emoji_btn / emoji_btn_disable) + panel (emoji_bkg): one page per theme
//               with 3×2 cells (emoji_cell_bkg), pager dots, swipe / drag / arrow keys / wheel to change the page (the
//               wheel turns one page per gesture, a plain vertical mouse wheel included, like Unity's ScrollRect). The
//               panel reopens on the theme of the last emote sent (localStorage). Sending closes the panel and greys
//               the button for the 1 s cooldown (chatCD), counted from the send so a remount keeps it.
//   EmotePanel  the panel alone (the watch-emote picker selects instead of sends).
//   WatchEmoteButton  the 观战 emote slot: an empty face + a picker key, filled by the 交流 list; its face sends
//               `g.emote { id, watch }` and the fall is played on both screens (ui/watchEmote.js).
// Official UI sprites come from the local ui/battle extraction when present; CSS draws look-alikes otherwise.
// Styles: public/css/emotes.css (injected on first use when the page does not link it).

import { useEffect, useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { EMOTE_WHEEL_THEMES, EMOTE_COOLDOWN_MS, EMOTE_BUBBLE_MS, SENDABLE_EMOTES, WATCH_EMOTE_RANDOM_MAX_IDS, emoteInfo, emoteArtGroup } from '../../../shared/constants.js';
import { html, Icon } from './components.js';
import { GIcon } from './gameComponents.js';
import { data, useData, localAsset, artUrls, nextArtUrl } from '../data.js';
import { loadPref, savePref, removePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const EMOTE_CSS_HREF = '/css/emotes.css';
const PREF_THEME = 'emoteTheme';
const SWIPE_PX = 40;      // horizontal drag distance that turns the page
const DRAG_SLOP_PX = 8;   // below this a press is a tap, not a drag
export const WHEEL_STEP_PX = 60;  // wheel / trackpad scroll that turns the page
export const WHEEL_GAP_MS = 180;  // a pause this long ends a wheel gesture (a trackpad's momentum tail included)
// Watch-emote clicks are merged into one message per window (a click storm must not flood the
// socket). 200 ms ⇒ at most 5 messages/s per player, even at an impossible click rate.
export const WATCH_EMOTE_PULSE_MS = 200;
// The watch-emote button is draggable (the 2026-10-18 request): a press that travels more than this many CSS
// px is a drag (no send / no picker); the position is remembered in localStorage under `sp.pref.watchEmotePos` (one
// global spot — the button belongs to the screen, not to a seat) and clamped to the viewport with this margin.
export const WATCH_EMOTE_DRAG_PX = 5;
export const WATCH_EMOTE_EDGE_PX = 8;
export const WATCH_EMOTE_POS_KEY = 'watchEmotePos';
// The two display switches (the 2026-10-18 request): persisted globally, both default on.
export const WATCH_EMOTE_COMBO_KEY = 'watchEmoteCombo';
// "在自己屏幕显示弹幕" (the sender's own falls; renamed from the ambiguous 显示图标): the face always shows the picked
// emote, this switch only decides whether the sender's own screen also plays the falls.
export const WATCH_EMOTE_OWN_RAIN_KEY = 'watchEmoteOwnRain';
// The watch picker's current choice (an emote id or '?' for random) is remembered across rounds / matches / reloads;
// the key stores a plain string, and an id that no longer exists falls back to the empty face (the bad record is
// removed) instead of failing.
export const WATCH_EMOTE_SELECTION_KEY = 'watchEmoteSelection';
/** A random emoji id from everything the wire accepts (the `?` option of the watch picker). */
export function pickRandomEmote(rand = Math.random) {
  const n = SENDABLE_EMOTES.length;
  const i = Math.min(n - 1, Math.max(0, Math.floor((Number(rand()) || 0) * n)));
  return SENDABLE_EMOTES[i];
}

/**
 * Validate a stored watch selection. `'?'` is the random mode, any sendable id is a fixed emote, `null` is no record;
 * anything else (an emote removed from the packs) is invalid and the caller removes it.
 * @param {unknown} raw
 * @returns {{ random: boolean, picked: string|null, valid: boolean }}
 */
export function normalizeWatchSelection(raw) {
  if (raw === '?') return { random: true, picked: null, valid: true };
  if (typeof raw === 'string' && SENDABLE_EMOTES.includes(raw)) return { random: false, picked: raw, valid: true };
  return { random: false, picked: null, valid: raw == null };
}

/** Read the persisted selection, dropping a stale id. */
function readWatchSelection() {
  const sel = normalizeWatchSelection(loadPref(WATCH_EMOTE_SELECTION_KEY, null));
  if (!sel.valid) removePref(WATCH_EMOTE_SELECTION_KEY);
  return sel;
}

/** Whether a pointer moved far enough to be a drag rather than a click (the 5 px threshold). */
export function watchDragMoved(dx, dy, threshold = WATCH_EMOTE_DRAG_PX) {
  return Math.hypot(Number(dx) || 0, Number(dy) || 0) > threshold;
}

/**
 * Clamp a button's top-left (relative to its host) into the host with an edge margin.
 * @param {{x:number,y:number}} pos @param {{width:number,height:number}} rect host size
 * @param {number} w @param {number} h button size @param {number} [margin]
 */
export function clampWatchPos(pos, rect, w, h, margin = WATCH_EMOTE_EDGE_PX) {
  const maxX = Math.max(margin, (Number(rect?.width) || 0) - (Number(w) || 0) - margin);
  const maxY = Math.max(margin, (Number(rect?.height) || 0) - (Number(h) || 0) - margin);
  const x = Math.min(maxX, Math.max(margin, Math.round(Number(pos?.x) || 0)));
  const y = Math.min(maxY, Math.max(margin, Math.round(Number(pos?.y) || 0)));
  return { x, y };
}

/**
 * The watch-emote pulse counter (exported so the accumulation is testable without a browser): every `click(id)`
 * counts per id, and the first click of a window arms one timer; when it fires, `onSend(id, count)` runs once per id
 * of the window (a random pulse may pick several ids; each id is one message). `maxIds` caps those messages — a click
 * that would add a 7th id is folded into the first id, so no click is ever lost. `flush()` sends the open window now,
 * `discard()` drops it. Timers are injectable for a fake clock; `pending` is the clicks of the open window.
 * @param {{ onSend: (id:string, count:number)=>void, windowMs?: number, maxIds?: number,
 *   setTimer?: Function, clearTimer?: Function }} o
 */
export function createEmotePulse({ onSend, windowMs = WATCH_EMOTE_PULSE_MS, maxIds = Infinity, setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id) } = {}) {
  let counts = new Map();
  let timer = 0;
  const stop = () => { if (timer) { clearTimer(timer); timer = 0; } };
  const total = () => [...counts.values()].reduce((n, v) => n + v, 0);
  const take = () => { const entries = [...counts.entries()].map(([id, count]) => ({ id, count })); counts = new Map(); return entries; };
  const send = (entries) => { for (const e of entries) if (e.id && e.count > 0) onSend(e.id, e.count); };
  return {
    click(emoteId) {
      if (typeof emoteId !== 'string' || !emoteId) return total();
      if (counts.has(emoteId)) counts.set(emoteId, counts.get(emoteId) + 1);
      else if (counts.size < maxIds) counts.set(emoteId, 1);
      else { const first = counts.keys().next().value; counts.set(first, counts.get(first) + 1); } // cap reached: keep the click
      if (!timer) timer = setTimer(() => { timer = 0; send(take()); }, windowMs);
      return total();
    },
    flush() { stop(); const entries = take(); send(entries); return entries.reduce((n, e) => n + e.count, 0); },
    discard() { stop(); take(); },
    get pending() { return total(); },
  };
}

// Time of the last send, shared by every wheel on the page: the 1 s cooldown survives a remount of the wheel (the
// server enforces chatCD too and silently drops an emote sent early).
let lastSentAt = -Infinity;

/** Link public/css/emotes.css once when the host page does not (dev harnesses); no-op outside a browser. */
export function ensureEmoteCss(doc = globalThis.document) {
  if (!doc?.head || typeof doc.querySelector !== 'function') return false;
  if (doc.querySelector(`link[rel="stylesheet"][href$="${EMOTE_CSS_HREF}"]`)) return false;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = EMOTE_CSS_HREF;
  doc.head.appendChild(link);
  return true;
}

/**
 * URLs of an emote's official art, best first: the local-client picture, then the mirror copy (data.js artUrls). Empty
 * when the id is unknown or neither manifest lists the picture (a path that is not listed is never requested).
 * @param {string} id official emoji id
 * @returns {string[]}
 */
export function emoteArtUrls(id) {
  const e = emoteInfo(id);
  if (!e) return [];
  if (e.art) return [e.art]; // custom packs: one committed picture, no manifest lookup
  return artUrls(emoteArtGroup(id), e.picId);
}

/**
 * URL of an emote's official art (the first of emoteArtUrls), or null.
 * @param {string} id official emoji id
 */
export function emoteArtUrl(id) {
  return emoteArtUrls(id)[0] || null;
}

/** True while local or assets is still in flight (idle or loading). A timeout or a failure is `missing`: the glyph. */
const artManifestsPending = () => ['local', 'assets'].some((n) => { const st = data.status(n); return st === 'loading' || st === 'idle'; });

/** Official emote UI sprite (ui/battle: emoji_bubble_bkg, emoji_bkg, emoji_cell_bkg, emoji_btn, emoji_btn_disable). */
export const emoteUiSprite = (name) => localAsset('ui/battle', name);

/** Index of a theme in the wheel (0 when unknown). */
export function themeIndex(themeId) {
  const i = EMOTE_WHEEL_THEMES.findIndex((t) => t.themeId === themeId);
  return i < 0 ? 0 : i;
}

/** Wheel page to open on: the theme of the last emote sent (remembered in localStorage), else the first. */
export function lastThemeIndex() {
  const v = loadPref(PREF_THEME, null);
  return typeof v === 'string' ? themeIndex(v) : 0;
}

/** Remember the theme of a sent emote. */
export function rememberTheme(themeId) {
  if (EMOTE_WHEEL_THEMES.some((t) => t.themeId === themeId)) savePref(PREF_THEME, themeId);
}

/** Clamp a page index into the wheel. */
export const clampPage = (i) => Math.max(0, Math.min(EMOTE_WHEEL_THEMES.length - 1, Math.trunc(Number(i)) || 0));

/**
 * Page change for a finished horizontal drag / swipe: -1 (previous), +1 (next) or 0.
 * @param {number} dx pointer travel in px (negative = leftwards = next page)
 * @param {number} [threshold]
 */
export const swipeStep = (dx, threshold = SWIPE_PX) => (dx <= -threshold ? 1 : dx >= threshold ? -1 : 0);

/**
 * Scroll distance of a wheel event along the pager, in px. Like Unity's horizontal-only ScrollRect, a mostly vertical
 * wheel (a plain mouse wheel) drives the horizontal pager too: down / right = next page.
 * @param {{ deltaX?: number, deltaY?: number, deltaMode?: number }} e
 * @param {number} [pagePx] px per "page" delta (deltaMode 2)
 */
export function wheelDelta(e, pagePx = 300) {
  const x = Number(e?.deltaX) || 0;
  const y = Number(e?.deltaY) || 0;
  const d = Math.abs(x) >= Math.abs(y) ? x : y;
  const unit = e?.deltaMode === 1 ? 16 : e?.deltaMode === 2 ? pagePx : 1; // lines / pages → px
  return d * unit;
}

/**
 * Wheel / trackpad paging, at most one page per gesture. A gesture is a run of wheel events less than WHEEL_GAP_MS
 * apart; once it has turned the page the rest of it (the momentum tail of a trackpad swipe) is ignored, so one swipe
 * never skips several themes.
 * @param {{ x: number, t: number, spent: boolean }} acc gesture state (mutated)
 * @param {number} d scroll distance of this event (wheelDelta)
 * @param {number} now event time (ms)
 * @returns {-1|0|1} page change
 */
export function wheelStep(acc, d, now) {
  if (!(now - acc.t < WHEEL_GAP_MS) || now < acc.t) { acc.x = 0; acc.spent = false; } // a new gesture
  acc.t = now;
  if (acc.spent || !d) return 0;
  acc.x += d;
  if (Math.abs(acc.x) < WHEEL_STEP_PX) return 0;
  acc.spent = true;
  return acc.x > 0 ? 1 : -1;
}

/**
 * Cooldown left (ms) of the 交流 button after a send at `sentAt` (chatCD).
 * @param {number} sentAt
 * @param {number} now
 * @param {number} [cooldownMs]
 */
export function cooldownLeft(sentAt, now, cooldownMs = EMOTE_COOLDOWN_MS) {
  const left = sentAt + cooldownMs - now;
  return left > 0 && left <= cooldownMs ? left : 0; // a clock that went backwards never locks the button
}

/**
 * Age (ms) of a bubble received at `at` — so a bubble mounted late (the team panel re-rendered from scratch) resumes
 * its animation instead of popping in again for a full chatTime. 0 when unknown.
 * @param {number|undefined} at receipt time (Date.now() clock)
 * @param {number} now
 * @param {number} ttl
 */
export function bubbleAge(at, now, ttl = EMOTE_BUBBLE_MS) {
  const age = Number.isFinite(at) && Number.isFinite(now) ? now - at : 0;
  return age > 0 ? Math.min(age, Math.max(0, ttl)) : 0;
}

/** Neutral stand-in for a missing emote picture (a glyph, never text). */
function EmoteGlyph({ class: cls }) {
  return html`<span class=${cx('eart', 'eart--glyph', cls)} aria-hidden="true"><${GIcon} name="emote" /></span>`;
}

/**
 * Official emote picture (the local-client art, else the mirror copy; the next one when a picture fails to load);
 * neutral glyph when unavailable.
 * @param {{ id: string, class?: string }} props
 */
export function EmoteArt({ id, class: cls }) {
  useData('local', 'assets');
  const [bad, setBad] = useState(() => new Set()); // URLs that failed to load
  const src = nextArtUrl(emoteArtUrls(id), bad);
  if (src) {
    return html`<img key=${src} class=${cx('eart', cls)} src=${src} alt="" draggable=${false} decoding="async"
      onError=${() => setBad((s) => new Set(s).add(src))} />`;
  }
  if (emoteInfo(id) && artManifestsPending()) return html`<span class=${cx('eart', 'eart--pending', cls)} aria-hidden="true"></span>`;
  return html`<${EmoteGlyph} class=${cls} />`;
}

/**
 * Pop bubble (picture only) beside the sender's avatar. Unknown ids show the neutral glyph. Key it by the emote's seq
 * (a newer emote replaces the bubble and pops again).
 * @param {{ id: string, class?: string, ttl?: number, at?: number, text?: string, n?: number }} props ttl = display time
 *   in ms (fade-out at the end); at = when the emote arrived (Date.now() clock): a bubble mounted after that resumes
 *   its pop / fade timeline instead of restarting it; text = the name in the SAME bubble shell (the watch notice,
 *   compact `名字 ×n`); n = the count appended as `×{n}` and kept visible while a long name is ellipsized.
 */
export function EmoteBubble({ id, class: cls, ttl = EMOTE_BUBBLE_MS, at, text = null, n = null }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const life = Math.max(300, Number(ttl) || EMOTE_BUBBLE_MS);
  const [age] = useState(() => bubbleAge(at, Date.now(), life)); // fixed at mount: the CSS animation runs from there
  const bg = emoteUiSprite('emoji_bubble_bkg');
  const e = emoteInfo(id);
  const style = [`--ebubble-ttl:${life}ms`, age && `--ebubble-age:${Math.round(age)}ms`, bg && !text && `--ebubble-bg:url("${bg}")`].filter(Boolean).join(';');
  if (typeof text === 'string' && text) {
    const count = Math.trunc(Number(n) || 0);
    return html`<div class=${cx('ebubble', 'ebubble--text', cls)} style=${style} role="status" aria-live="polite"
      data-emote="" data-watch-notice="1"><span class="ebubble__txt">${text}</span>${count > 0 ? html`<b class="ebubble__n">${t('×{n}', { n: count })}</b>` : null}</div>`;
  }
  return html`<div class=${cx('ebubble', bg && 'has-sprite', cls)} style=${style} role="img"
    aria-label=${e ? t(e.label) : t('表情')} data-emote=${e ? e.id : ''}>
    <span class="ebubble__icon"><${EmoteArt} id=${id} /></span>
  </div>`;
}

/**
 * The 交流 panel, without the button: one page per theme, 3×2 cells, pager dots, swipe / drag / arrow keys / wheel.
 * Shared by the 交流 wheel and the watch-emote picker (which selects instead of sending).
 * @param {{ open: boolean, onPick: (id:string)=>void, onClose: ()=>void, disabled?: boolean, container?: string,
 *   label?: string, onRandom?: ()=>void }} props container = the closest element that is "inside" (a press there does
 *   not close it); onRandom adds the `?` (随机) option for a picker that can draw a random emote
 */
export function EmotePanel({ open, onPick, onClose, disabled = false, container = '.ewheel', label = '', onRandom = null }) {
  useData('local');
  const [page, setPage] = useState(lastThemeIndex);
  const [dir, setDir] = useState(0);          // direction of the last page change (slide-in animation)
  const [dx, setDx] = useState(0);            // live drag offset (px)
  const drag = useRef(null);                  // { id, x0, moved }
  const swallowClick = useRef(false);
  const wheelAcc = useRef({ x: 0, t: -Infinity, spent: false });
  const live = useRef({});
  live.current = { page, onClose };

  const go = (to) => {
    const next = clampPage(to);
    if (next === live.current.page) return;
    setDir(next > live.current.page ? 1 : -1);
    setPage(next);
    live.current.page = next; // several key presses before the next render still step one page each
  };

  // reopen on the last used theme
  useEffect(() => { if (open) { setPage(lastThemeIndex()); setDir(0); setDx(0); } }, [open]);

  // outside press closes; ← / → change the page
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!(e.target instanceof Element) || !e.target.closest(container)) live.current.onClose(); };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        go(live.current.page + (e.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [open, container]);

  const pick = (id) => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    const e = emoteInfo(id);
    if (!e || disabled) return;
    rememberTheme(e.themeId);
    onPick(id);
  };

  // swipe / drag (touch, pen and mouse)
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    drag.current = { id: e.pointerId, x0: e.clientX, moved: false };
    swallowClick.current = false;
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.pointerType === 'mouse' && !(e.buttons & 1)) { drag.current = null; setDx(0); return; } // released outside
    const off = e.clientX - d.x0;
    if (!d.moved && Math.abs(off) < DRAG_SLOP_PX) return;
    if (!d.moved) { d.moved = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } }
    const edge = (off > 0 && live.current.page === 0) || (off < 0 && live.current.page === EMOTE_WHEEL_THEMES.length - 1);
    setDx(edge ? off / 3 : off); // rubber band at the first / last page
  };
  const endDrag = (e, cancelled) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    swallowClick.current = true;               // the click that follows a drag is not a pick
    setTimeout(() => { swallowClick.current = false; }, 0);
    setDx(0);
    if (!cancelled) { const step = swipeStep(e.clientX - d.x0); if (step) go(live.current.page + step); }
  };
  const onWheel = (e) => {
    const d = wheelDelta(e, e.currentTarget?.clientWidth || 300);
    if (!d) return;
    e.preventDefault();
    const step = wheelStep(wheelAcc.current, d, performance.now());
    if (step) go(live.current.page + step);
  };

  if (!open) return null;
  const theme = EMOTE_WHEEL_THEMES[clampPage(page)];
  const panelBg = emoteUiSprite('emoji_bkg');
  const cellBg = emoteUiSprite('emoji_cell_bkg');
  const panelStyle = [panelBg && `--ewheel-bg:url("${panelBg}")`, cellBg && `--ewheel-cell:url("${cellBg}")`].filter(Boolean).join(';');
  return html`<div class=${cx('ewheel__panel', panelBg && 'has-sprite', cellBg && 'has-cell')} style=${panelStyle} role="dialog"
      aria-label=${label || t('交流')} data-emote-panel>
    <div class="ewheel__viewport" onPointerDown=${onPointerDown} onPointerMove=${onPointerMove}
      onPointerUp=${(e) => endDrag(e, false)} onPointerCancel=${(e) => endDrag(e, true)} onWheel=${onWheel}>
      <div key=${theme.themeId} class=${cx('ewheel__page', dir > 0 && 'is-from-right', dir < 0 && 'is-from-left', dx !== 0 && 'is-dragging')}
        style=${dx ? `transform:translateX(${dx}px)` : ''} role="group" aria-label=${t(theme.name)} data-theme=${theme.themeId}>
        ${theme.emotes.map((e) => html`<button key=${e.id} type="button" class="ewheel__item" data-emote=${e.id} aria-label=${t(e.label)}
            disabled=${disabled} onClick=${() => pick(e.id)}>
          <${EmoteArt} id=${e.id} />
        </button>`)}
      </div>
    </div>
    <button type="button" class="ewheel__nav is-prev" aria-label=${t('上一组表情')} disabled=${page <= 0} onClick=${() => go(page - 1)}><${GIcon} name="chevronLeft" /></button>
    <button type="button" class="ewheel__nav is-next" aria-label=${t('下一组表情')} disabled=${page >= EMOTE_WHEEL_THEMES.length - 1} onClick=${() => go(page + 1)}><${GIcon} name="chevronRight" /></button>
    ${onRandom ? html`<button type="button" class="ewheel__random" aria-label=${t('随机')} title=${t('随机')}
      disabled=${disabled} onClick=${() => onRandom()} data-testid="emote-random">?</button>` : null}
    <div class="ewheel__dots" role="tablist" aria-label=${t('表情主题')}>
      ${EMOTE_WHEEL_THEMES.map((th, i) => html`<button key=${th.themeId} type="button" role="tab" class=${cx('ewheel__dot', i === page && 'is-on')}
        aria-selected=${i === page ? 'true' : 'false'} aria-label=${`${t(th.name)} ${i + 1}/${EMOTE_WHEEL_THEMES.length}`} onClick=${() => go(i)}></button>`)}
    </div>
  </div>`;
}

/**
 * 交流 button + emote panel.
 * @param {{ onSend: (id:string)=>void, open: boolean, onToggle: (open:boolean)=>void, disabled?: boolean,
 *   cooldownMs?: number }} props
 */
export function EmoteWheel({ onSend, open, onToggle, disabled = false, cooldownMs = EMOTE_COOLDOWN_MS }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const [cooling, setCooling] = useState(() => cooldownLeft(lastSentAt, Date.now(), cooldownMs) > 0);

  // cooldown: the button is greyed for chatCD after a send (from the send time, so a remounted wheel keeps it)
  useEffect(() => {
    if (!cooling) return undefined;
    const t = setTimeout(() => setCooling(false), cooldownLeft(lastSentAt, Date.now(), cooldownMs));
    return () => clearTimeout(t);
  }, [cooling]);

  const send = (id) => {
    const e = emoteInfo(id);
    const now = Date.now();
    if (!e || cooling || disabled || cooldownLeft(lastSentAt, now, cooldownMs) > 0) return;
    lastSentAt = now;
    setCooling(true);
    onSend(id);
    onToggle(false);
  };

  const btnSprite = emoteUiSprite(disabled || cooling ? 'emoji_btn_disable' : 'emoji_btn');
  return html`<div class="ewheel">
    <button type="button" class=${cx('ewheel__btn', btnSprite && 'has-sprite', open && 'is-on', cooling && 'is-cooling')}
      style=${btnSprite ? `--ewheel-btn:url("${btnSprite}")` : ''} onClick=${() => onToggle(!open)}
      aria-expanded=${open ? 'true' : 'false'} aria-haspopup="dialog" disabled=${disabled || cooling}>
      ${btnSprite ? null : html`<${GIcon} name="emote" />`}<span class="ewheel__label">${t('交流')}</span>
    </button>
    <${EmotePanel} open=${open} onPick=${send} onClose=${() => onToggle(false)} disabled=${disabled || cooling} />
  </div>`;
}

/**
 * Watch-emote button (观战 another player): an emote slot whose face is empty until the picker fills it, plus the
 * picker key that opens the same 交流 list as a selection panel and a small gear with two display switches. The face
 * accumulates clicks and every WATCH_EMOTE_PULSE_MS sends the window as one `g.emote { id, watch, count }` per id (a
 * random draw may pick several ids) for the watched player's screen; there is no life gate — the button is usable
 * whenever another player's board is on screen (the parent renders it only then) and greys out only while the
 * connection is offline. `onClick` fires on every face click (the parent's 连击 counter, only while 显示连击 is on);
 * `onReset` when the face changes / the combo is switched off / the button goes away. The button is draggable and
 * remembers its spot; both display switches are persisted.
 * @param {{ targetName?: string, onSend: (id:string, count:number)=>void, ownRains?: boolean, onOwnRains?: (v:boolean)=>void,
 *   open?: boolean, onToggle?: (open:boolean)=>void, disabled?: boolean, onClick?: ()=>void, onReset?: ()=>void,
 *   class?: string }} props
 */
export function WatchEmoteButton({ targetName = '', onSend, ownRains = true, onOwnRains, open = false, onToggle, disabled = false, onClick, onReset, class: cls }) {
  useData('local');
  useEffect(() => { ensureEmoteCss(); }, []);
  const [selection, setSelection] = useState(readWatchSelection); // persisted: { random, picked }
  const { picked, random } = selection;
  const [pending, setPending] = useState(0);         // the clicks of the open window, shown as a small badge
  const [localOpen, setLocalOpen] = useState(false);
  const [comboOn, setComboOn] = useState(() => loadPref(WATCH_EMOTE_COMBO_KEY, true) !== false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const pulse = useRef(null);
  if (!pulse.current) {
    pulse.current = createEmotePulse({
      maxIds: WATCH_EMOTE_RANDOM_MAX_IDS,
      onSend: (id, count) => { setPending(0); lastSentAt = Date.now(); onSendRef.current(id, count); },
    });
  }
  // draggable position (a global pref: the button belongs to the screen). `null` = the CSS default (near bottom-left).
  const rootRef = useRef(null);
  const [pos, setPos] = useState(() => {
    const saved = loadPref(WATCH_EMOTE_POS_KEY, null);
    return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? { x: saved.x, y: saved.y } : null;
  });
  const [dragging, setDragging] = useState(false);
  const posRef = useRef(pos);
  posRef.current = pos;
  const remRef = useRef(100);
  const drag = useRef(null);
  const suppress = useRef(false);
  const hostRect = (el) => {
    const host = el?.closest('.gm');
    return host ? host.getBoundingClientRect() : { width: 0, height: 0 };
  };
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    try { remRef.current = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100; } catch { /* default */ }
    const rect = hostRect(el);
    const w = el.offsetWidth || 56, h = el.offsetHeight || 56;
    const saved = posRef.current;
    const start = saved || { x: Math.round(.24 * remRef.current), y: Math.round(rect.height - h - 1.46 * remRef.current) };
    const p = clampWatchPos(start, rect, w, h);
    setPos(p);
    posRef.current = p;
    if (saved && (saved.x !== p.x || saved.y !== p.y)) savePref(WATCH_EMOTE_POS_KEY, p); // a stored off-screen spot is clamped
  }, []);
  useEffect(() => {
    const onResize = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = hostRect(el);
      const p = clampWatchPos(posRef.current || { x: 0, y: 0 }, rect, el.offsetWidth || 56, el.offsetHeight || 56);
      if (!posRef.current || p.x !== posRef.current.x || p.y !== posRef.current.y) { setPos(p); posRef.current = p; savePref(WATCH_EMOTE_POS_KEY, p); }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    // a press inside the picker / the settings popover is a control press, never a drag of the button
    if (e.target instanceof Element && e.target.closest('.ewheel__panel, .wemote__settings, .wemote__gear')) return;
    const el = rootRef.current;
    if (!el) return;
    const rect = hostRect(el);
    drag.current = {
      id: e.pointerId, sx: e.clientX, sy: e.clientY,
      bx: posRef.current?.x ?? el.offsetLeft, by: posRef.current?.y ?? el.offsetTop,
      rect, w: el.offsetWidth || 56, h: el.offsetHeight || 56, moved: false,
    };
    suppress.current = false;
  };
  // Window-level move/up: once a press starts, a fast drag leaves the small button before it could capture the
  // pointer, so the button never sees the move that would let it capture. Listening on the window costs nothing
  // outside a drag and works for mouse, pen and touch.
  useEffect(() => {
    const move = (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      if (!d.moved) {
        if (!watchDragMoved(dx, dy)) return;
        d.moved = true;
        setDragging(true);
      }
      e.preventDefault();
      const p = clampWatchPos({ x: d.bx + dx, y: d.by + dy }, d.rect, d.w, d.h);
      posRef.current = p;
      setPos(p);
    };
    const up = (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      drag.current = null;
      if (!d.moved) return;
      suppress.current = true; // the click after a drag is not a send / picker toggle
      setDragging(false);
      if (posRef.current) savePref(WATCH_EMOTE_POS_KEY, posRef.current);
      setTimeout(() => { suppress.current = false; }, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  const swallow = () => { if (!suppress.current) return false; suppress.current = false; return true; };
  const shownOpen = onToggle ? open : localOpen;
  const setOpen = (v) => { if (onToggle) onToggle(v); else setLocalOpen(v); };
  const locked = !!disabled;
  const canPick = !locked;
  const flush = () => { pulse.current.flush(); setPending(0); };
  const setCombo = (v) => {
    setComboOn(v);
    savePref(WATCH_EMOTE_COMBO_KEY, v);
    if (!v) onResetRef.current?.();
  };
  const setOwnRains = (v) => onOwnRains?.(v);

  // a new face flushes the old one's window and resets the combo; unmounting (back home / the watch ended) does both
  useEffect(() => { flush(); onResetRef.current?.(); }, [picked]);
  useEffect(() => () => { pulse.current?.flush(); onResetRef.current?.(); }, []);
  // offline while clicks were waiting: drop them (the request could not be sent anyway)
  useEffect(() => { if (locked) { pulse.current.discard(); setPending(0); } }, [locked]);
  // a settings popover closes on a press outside it
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t instanceof Element && t.closest('.wemote__settings, .wemote__gear')) return;
      setSettingsOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [settingsOpen]);

  const click = () => {
    if (swallow() || locked) return;
    const id = random ? pickRandomEmote() : picked;
    if (!id) return;
    setPending(pulse.current.click(id));
    if (comboOn) onClickRef.current?.();
  };
  const pick = (id) => { flush(); setSelection({ random: false, picked: id }); savePref(WATCH_EMOTE_SELECTION_KEY, id); setOpen(false); };
  const pickRandom = () => { flush(); setSelection({ random: true, picked: null }); savePref(WATCH_EMOTE_SELECTION_KEY, '?'); setOpen(false); onResetRef.current?.(); };
  const showFace = !random && !!picked; // the button always shows the picked emote; the switch never changes this
  const reason = !random && !picked ? t('选择表情') : t('向 {name} 发送表情', { name: targetName });
  const flip = !!pos && pos.y < 2.55 * remRef.current; // near the top: the panel / settings open downwards
  return html`<div ref=${rootRef} class=${cx('wemote', dragging && 'is-dragging', flip && 'is-panel-down', cls)}
      style=${pos ? `left:${pos.x}px;top:${pos.y}px;bottom:auto` : null}
      onPointerDown=${onPointerDown}
      data-watch-emote data-pending=${pending || null} data-combo=${comboOn ? 'on' : 'off'} data-own-rain=${ownRains ? 'on' : 'off'} data-random=${random ? 'on' : 'off'}>
    <button type="button" class=${cx('wemote__face', showFace && 'has-emote', random && 'is-random')} disabled=${locked || (!random && !picked)}
      title=${reason} aria-label=${reason} onClick=${click} data-testid="watch-emote-send">
      ${random ? html`<span class="wemote__random" aria-hidden="true">?</span>`
        : showFace ? html`<${EmoteArt} id=${picked} class="wemote__art" />`
        : html`<${GIcon} name="emote" class="wemote__empty" />`}
    </button>
    ${pending ? html`<span class="wemote__count num" aria-hidden="true">${pending}</span>` : null}
    <button type="button" class="wemote__pick" disabled=${!canPick} title=${t('选择表情')}
      aria-label=${t('选择表情')} aria-expanded=${shownOpen ? 'true' : 'false'} aria-haspopup="dialog"
      onClick=${() => { if (swallow()) return; flush(); setOpen(!shownOpen); }} data-testid="watch-emote-pick"><${Icon} name="chevronRight" /></button>
    <button type="button" class="wemote__gear" title=${t('表情按钮设置')} aria-label=${t('表情按钮设置')}
      aria-expanded=${settingsOpen ? 'true' : 'false'} onClick=${() => { if (swallow()) return; setSettingsOpen(!settingsOpen); }}
      data-testid="watch-emote-settings"><${GIcon} name="gear" /></button>
    ${settingsOpen ? html`<div class="wemote__settings" role="dialog" aria-label=${t('表情按钮设置')}>
      <button type="button" role="switch" aria-checked=${comboOn ? 'true' : 'false'} onClick=${() => setCombo(!comboOn)} data-testid="watch-emote-combo-switch">
        <span>${t('显示连击')}</span><b>${comboOn ? t('开') : t('关')}</b></button>
      <button type="button" role="switch" aria-checked=${ownRains ? 'true' : 'false'} onClick=${() => setOwnRains(!ownRains)} data-testid="watch-emote-own-rain-switch">
        <span>${t('在自己屏幕显示弹幕')}</span><b>${ownRains ? t('开') : t('关')}</b></button>
    </div>` : null}
    <${EmotePanel} open=${shownOpen} onPick=${pick} onRandom=${pickRandom} onClose=${() => setOpen(false)}
      disabled=${!canPick} container=".wemote" label=${t('选择表情')} />
  </div>`;
}
