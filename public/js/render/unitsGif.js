// render/unitsGif.js — the host visual `units-gif` (shared/plugins/ui.js `UI_EFFECTS`, docs/PLUGINS.md §14).
//
// While it is on, every unit / piece view on the field (`views`, render/app.js) is hidden and one animation frame
// stands where it stands: the same feet position, facing, alpha, the scale of the tile under it, and the same depth
// among the units (each stand-in copies its view's `root.zIndex` = units.js `unitDepthKey`). A view that appears (a
// deploy, a summon, a bought piece) gets its stand-in in the same frame, one that leaves the field (death, retreat)
// loses it.
//
// **Visibility only.** No texture, mesh, sim value or unit record is written, nothing is rebuilt and no number is
// re-derived: the stand-ins are one Container of their own, created on `on` and destroyed on `off`, and each view then
// shows itself again through its own `update(0, …)` — the way `hidePenView` (render/app.js) restores the pen figures.
// dt = 0 advances no clock; the view's own culling flag decides its visibility again, so the field is exactly the
// field from before the switch (no residue, no unit state changed).
//
// Why the parts and not the layer: `layers.units` (app.js) is the depth-sorted unit layer, and the tile field's props
// and raised block tops live in it too (`tiles.js` `props: layers.units`) — hiding that layer would take the board's
// own geometry with it. So a view's own renderables are switched off instead (body, bars/label, shadow, facing
// chevron, block icon, an item's plate, a device's body / 3D box). The renderer rewrites `visible` from viewport
// culling (`UnitView._cull`) and from its own HUD/status rules on every frame, so the flags are re-asserted once per
// frame right before the renderer draws: app.js adds `tick` at UPDATE_PRIORITY -23 (after `frame` at 0, before PIXI's
// render at -25).
//
// **The art is a strategy, not a sheet name** (the effect message's controlled `variant`, shared/plugins/ui.js
// `UI_UNIT_VARIANTS`, plus the fixed-sheet `strategy`, `UI_UNIT_STRATEGIES`):
//
//   amiya2  one sheet for the whole field — the sheet dj-amiya's stand-ins have always used, and the default when a
//           message names none. dj-amiya asks for this one.
//   mix     every unit gets its own sheet: on first sight (a deploy, a summon, a battle spawn) the view is assigned
//           `amiya2` or `prss` from the session's seed and KEEPS it for as long as it is on the field — the two GIFs
//           interleave on the board, and one unit never flickers between them. A view that leaves the field drops its
//           pick; the mapping is `pickVariant(key, seed)` below (a pure function, so a fixed seed reproduces a run).
//           A newcomer whose sheet would leave the whole field on one sheet takes the other one, so a field of two or
//           more units always really shows both GIFs. dj-prss (the third in-match button) asks for this one.
//   amiya   one sheet for the whole field — the FIRST Amiya sheet the host shipped (27 frames, the 9×3 sheet from
//           e896f54f), the art of `Amiya.gif` itself and NOT a crop of the Amiya2 sheet. The fourth in-match button
//           (dj-wine-2) asks for it with the fixed-sheet `strategy` parameter.
//
// The sheets are the host's own, 112 px cells (96 px of art + an 8 px transparent gutter so a neighbouring frame can
// never bleed into a sampled edge), all 10 fps:
//
//   amiya   public/img/dj-units/amiya.png    Amiya.gif (1000², 27 frames, 10 fps, 1.39 MB — the first sheet, e896f54f):
//     ffmpeg -i Amiya.gif -vf "crop=960:960:33:24,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=9x3"
//            -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya.png                               (1.39 MB → 308 KB)
//   amiya2  public/img/dj-units/amiya2.png   Amiya2.gif (950², 70 frames, 10 fps, 2.0 MB):
//     ffmpeg -i Amiya2.gif -vf "crop=827:827:85:13,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7"
//            -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya2.png                              (2.0 MB → 494 KB)
//   prss    public/img/dj-units/prss.png    Prss.gif (1000², 70 frames, 10 fps, 2.2 MB):
//     ffmpeg -i Prss.gif -vf "crop=720:720:117:200,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7"
//            -frames:v 1 -pix_fmt rgba public/img/dj-units/prss.png                              (2.2 MB → 598 KB)
//     … then two passes over every frame's 96×96 art, both alpha-premultiplied, both keeping the feet row (the bottom
//       edge of the frame, the sprite's anchor) where it is:
//       1. the content normalising pass (see below): resampled to 84×96 (box filter) and pasted centred at
//          x = inset + 6 of its cell — 553 KB;
//       2. the owner's second look (a `mix` field still read the prss stand-in as the bigger one): the whole 96 px
//          frame resampled to 76×76 (LANCZOS — 96 × 0.80 = 76.8, and 76 is the integer that keeps the measured box at
//          0.80 of amiya2's) and pasted centred at x = inset + 10, bottom row on the frame's bottom row, so the art
//          fills ~67×76 — 0.80× of amiya2's 84×96 — 508 KB.
//
// Each cropped box is the union of its sheet's frames' alpha bounds plus a small margin, so nothing moves between
// cells. A sheet is fetched the first time a unit is assigned to it and cached for the page (a page that never asks
// for it downloads nothing; `amiya2` sessions never fetch `prss`). A view is only hidden once ITS sheet has actually
// loaded — a failed or still-loading download can never leave an empty field, that unit simply keeps showing itself.
//
// **How big a stand-in reads is a property of the art, not of the renderer.** A stand-in is scaled by ONE factor for
// every variant (`h / GIF_VARIANTS[v].size` in `tick` — there is no per-sheet number to tune), so what the eye
// compares, and the only thing that makes one unit's GIF look bigger than another's, is the fraction of the 96 px
// frame the art itself fills. As the union of the 70 frames' alpha bounds inside that frame, `amiya2` fills 84×96
// (87.5 % × 100 %). `prss` used to fill 96×96 (100 % × 100 %, 14 % wider): the two source GIFs were cropped to the
// same frame but not to the same content scale. The first pass squeezed it to `amiya2`'s 84×96 (sx = 84/96 = 0.875,
// feet row and height kept) so one stand-in was one size; the owner then judged the prss GIF itself still bigger on
// the board — its character fills more of each frame — so the second pass shrank the whole 96 px art to 0.80× (the
// first ask was 0.75, which the owner then judged too much): `prss.png` now fills ~67×76 of its frame at the bottom
// middle — measured on the alpha channel, 68×76 at x 14..82, y 20..96, the resample's edge bleeding a pixel on each
// side, and 64×75 at alpha > 8 against `amiya2`'s 80×94 = 0.800 × 0.798. The feet row — the bottom edge, the sprite's
// anchor — is still where it was, and the ratio lives in the asset alone: the renderer keeps its one rule (`h / 96`).
// `test/ui/dj-units.test.js` measures both boxes out of the PNGs and fails if `prss` is regenerated at any other
// ratio; the dj-prss e2e measures the same ratio on the stand-ins PIXI really draws.

/** The stand-in art: one sheet per variant, a 10×7 grid of 112 px cells with the 96 px frame in the middle of each. */
export const GIF_VARIANTS = Object.freeze({
  /** dj-amiya's sheet — also the sheet of the default `amiya2` strategy. */
  amiya2: Object.freeze({
    url: '/img/dj-units/amiya2.png',
    cols: 10,
    rows: 7,
    count: 70,
    cell: 112,
    inset: 8,
    size: 96,
    fps: 10,
  }),
  /** dj-prss's sheet (the second half of the `mix` strategy). */
  prss: Object.freeze({
    url: '/img/dj-units/prss.png',
    cols: 10,
    rows: 7,
    count: 70,
    cell: 112,
    inset: 8,
    size: 96,
    fps: 10,
  }),
  /** The FIRST sheet (e896f54f, `Amiya.gif` itself): 27 frames on a 9×3 grid — the `amiya` fixed-sheet strategy. */
  amiya: Object.freeze({
    url: '/img/dj-units/amiya.png',
    cols: 9,
    rows: 3,
    count: 27,
    cell: 112,
    inset: 8,
    size: 96,
    fps: 10,
  }),
});

/** The default sheet: the one dj-amiya used before the strategy was a parameter. */
export const GIF_ASSET = GIF_VARIANTS.amiya2;

/** The sheets this host can draw (shared/plugins/ui.js UI_UNIT_VARIANTS is the message-side strategy list). */
export const GIF_VARIANT_IDS = Object.freeze(Object.keys(GIF_VARIANTS));

/**
 * The stand-in strategies a `units-gif` message may name: the sheets this session draws from. `amiya2` is one sheet for
 * the whole field; `mix` lets every unit draw from one of two; `amiya` is the fixed-sheet strategy of the fourth button
 * (the first Amiya sheet, `strategy: 'amiya'` — `UI_UNIT_STRATEGIES` on the message side).
 */
export const GIF_STRATEGIES = Object.freeze({
  amiya2: Object.freeze(['amiya2']),
  mix: Object.freeze(['amiya2', 'prss']),
  amiya: Object.freeze(['amiya']),
});

/** The strategies this host knows (the message-side lists are `UI_UNIT_VARIANTS` and `UI_UNIT_STRATEGIES`). */
export const GIF_STRATEGY_IDS = Object.freeze(Object.keys(GIF_STRATEGIES));

/** The default strategy: the one sheet dj-amiya has always drawn. */
export const GIF_STRATEGY = 'amiya2';

/**
 * The sheet one unit's stand-in draws (`mix`): a pure function of the session `seed` and the view key, so a unit keeps
 * its sheet for as long as it is on the field, a fixed seed reproduces a run, and two sessions differ. FNV-1a over
 * `seed\0key`, then a murmur-style finalizer so the bit is not a plain XOR of the characters' parity; bit 9 picks the
 * sheet — a uniform 50/50 split over the unit keys, decided per unit, not per session.
 * @param {any} key the view's key in the field's `views` map (e.g. `p:<uid>`)
 * @param {number} seed the session's seed
 * @returns {'amiya2'|'prss'}
 */
export function pickVariant(key, seed) {
  const s = `${seed >>> 0}\u0000${String(key)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 9) & 1 ? 'prss' : 'amiya2';
}

/** Height of a stand-in over the tile it stands on (× the projected pixels-per-tile of that tile). */
const HEIGHT_TILES = 1.42;

/** The renderables of a view that stand for the unit itself (`units.js` UnitView / ItemView / DeviceView). */
const PARTS = ['root', 'hud', 'shadow', 'facingArrow', 'blockIcon', 'gfx', 'plate'];

/** `prefers-reduced-motion` leaves the effect off altogether (the plugin host checks too, before it asks). */
function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A fresh session seed (32 bits). */
function newSeed() {
  try {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0] >>> 0;
  } catch {
    return (Math.random() * 0x100000000) >>> 0;
  }
}

/**
 * The stand-in layer of one field view.
 * @param {any} ctx the render context (`render/app.js` createFieldView): its PIXI (`ctx.P`) and layers
 * @param {{ views: Map<any, any>, cam: () => any, clock: () => number }} opts the live view map and its clock
 */
export function createUnitsGif(ctx, { views, cam, clock }) {
  const P = ctx.P;
  let on = false;
  let layer = null;
  /** @type {Map<any, any>} view key → AnimatedSprite */
  const sprites = new Map();
  /** @type {Map<any, string>} view key → the sheet that view's stand-in draws ('amiya2' | 'prss') */
  const picks = new Map();
  /** @type {Map<any, Array<[any, boolean]>>} view → what this switch hid, and what it showed before */
  const hidden = new Map();
  /**
   * The sheets this page has asked for, by variant: `{ tex, frames, failed }`. The base texture is fetched once per
   * page and never destroyed (other fields reuse it); the frame textures are cut out of it and destroyed on `off`.
   * @type {Map<string, { tex: any, frames: any[] | null, failed: boolean }>}
   */
  const sheets = new Map();
  /** The strategy the stand-ins draw from in this session. */
  let strategy = GIF_STRATEGY;
  /** The session's seed: which sheet each unit gets (`mix`), drawn again every time the effect is switched on. */
  let seed = newSeed();
  /** A seed fixed by the tests (`setSeed`); `null` = a fresh random one per session. */
  let fixedSeed = null;
  let phase = 0;          // seconds into the loop, shared by every stand-in
  let frameIndex = 0;
  let lastAt = 0;

  /** The sheets the current strategy may draw from (an unknown name falls back to the default — the message was validated). */
  const strategies = () => GIF_STRATEGIES[strategy] || GIF_STRATEGIES[GIF_STRATEGY];

  /** The sheet one view draws: `amiya2` strategy = the one sheet, `mix` = this unit's own pick (assigned on first sight). */
  function pickFor(key) {
    const list = strategies();
    let v = picks.get(key);
    if (!v) {
      v = list.length === 1 ? list[0] : pickVariant(key, seed);
      // A mix the eye can actually see: a newcomer never leaves the whole field on one sheet — if every unit already
      // assigned draws the same sheet, this unit takes the other. It is still one random assignment per unit, made once
      // and kept (a unit never switches sheets mid-session; the rule only decides the newcomer's).
      if (list.length > 1 && picks.size > 0) {
        const seen = new Set(picks.values());
        if (seen.size === 1 && seen.has(v)) v = v === 'amiya2' ? 'prss' : 'amiya2';
      }
      picks.set(key, v);
    }
    return v;
  }

  /** Start one sheet's one download (a page whose plugin never asks for that sheet fetches nothing). */
  function ensureSheet(v) {
    let s = sheets.get(v);
    if (s) return s;
    s = { tex: null, frames: null, failed: false };
    sheets.set(v, s);
    try {
      s.tex = P.Texture.from(GIF_VARIANTS[v].url);
      s.tex.baseTexture?.once?.('error', () => {
        s.failed = true;
        if (typeof console !== 'undefined') console.warn(`[units-gif] the stand-in sheet failed to load: ${GIF_VARIANTS[v].url}`);
      });
    } catch (err) {
      s.failed = true;
      if (typeof console !== 'undefined') console.warn('[units-gif] the stand-in sheet could not be created', err);
    }
    return s;
  }

  /** The frames of one sheet, sliced out of it (null while the image is still loading or after it failed). */
  function cutFrames(v) {
    const s = ensureSheet(v);
    const base = s && s.tex && s.tex.baseTexture;
    if (!base || base.valid !== true) return null;
    if (s.frames) return s.frames;
    const a = GIF_VARIANTS[v];
    const out = [];
    for (let i = 0; i < a.count; i++) {
      const x = (i % a.cols) * a.cell + a.inset;
      const y = Math.floor(i / a.cols) * a.cell + a.inset;
      out.push(new P.Texture(base, new P.Rectangle(x, y, a.size, a.size)));
    }
    s.frames = out;
    return out;
  }

  /** The substitute layer: its own container right above the unit layer (bars, fx and text still draw over it). */
  function ensureLayer() {
    if (layer && layer.parent) return layer;
    const units = ctx.layers.units;
    const world = units.parent;
    layer = new P.Container();
    layer.sortableChildren = true;
    world.addChildAt(layer, world.getChildIndex(units) + 1);
    return layer;
  }

  /** The display objects of one view that have to disappear while its stand-in stands there. */
  function partsOf(v) {
    const out = [];
    for (const k of PARTS) if (v[k] && typeof v[k] === 'object' && 'visible' in v[k]) out.push(v[k]);
    if (v.box && v.box.mesh && 'visible' in v.box.mesh) out.push(v.box.mesh);
    return out;
  }

  /** Where a view stands on screen (feet px, depth key, alpha, pixels per tile) — the body's own placement. */
  function placement(v) {
    const r = v.root;
    if (r) return { x: r.position.x, y: r.position.y, z: r.zIndex, alpha: r.alpha, s: v.screen.s || 1 };
    // an item / device draws in screen space (no container of its own): its feet are the tile it stands on
    const p = cam().project(v.x, v.y, v.z || 0);
    return { x: p.x, y: p.y, z: v.gfx ? v.gfx.zIndex : 0, alpha: v.gfx ? v.gfx.alpha : 1, s: p.s || 1 };
  }

  /** Hide one view (once per frame): remember what it showed the first time, then switch every part off. */
  function hideOne(v) {
    let rec = hidden.get(v);
    if (!rec) { rec = []; hidden.set(v, rec); }
    for (const part of partsOf(v)) {
      if (!rec.some(([p]) => p === part)) rec.push([part, part.visible === true]);
      part.visible = false;
    }
  }

  /**
   * Show one view again. A unit view is handed back to its own update (dt = 0: nothing advances) so its culling flag
   * decides visibility exactly as it would have; an item / a device (whose update does not write those flags) gets the
   * values it showed before the switch back verbatim.
   */
  function showOne(v) {
    const rec = hidden.get(v);
    hidden.delete(v);
    if (!v || v.destroyed) return;
    if (typeof v.modelFlip === 'function') {
      v.culled = undefined;
      try { v.update(0, cam(), clock()); } catch { /* the next frame retries */ }
      return;
    }
    if (rec) for (const [part, shown] of rec) if (!part.destroyed) part.visible = shown;
  }

  /** Drop every stand-in and the layer itself. */
  function teardown() {
    for (const [key, spr] of sprites) {
      try { layer?.removeChild(spr); spr.destroy(); } catch { /* already gone */ }
      sprites.delete(key);
      picks.delete(key);
    }
    if (layer) {
      try { layer.parent?.removeChild(layer); layer.destroy({ children: true }); } catch { /* already gone */ }
      layer = null;
    }
    for (const s of sheets.values()) {
      if (!s.frames) continue;
      for (const t of s.frames) { try { t.destroy(false); } catch { /* ignore */ } }
      s.frames = null;
    }
  }

  /** The whole off path: free the layer and hand every view back (used by `off`, a strategy switch and `destroy`). */
  function setOff() {
    if (!on) return;
    on = false;
    teardown();
    for (const v of [...hidden.keys()]) showOne(v);
    hidden.clear();
    picks.clear();
  }

  /**
   * One frame, called by the render app right before PIXI draws (see the header). Cheap: a handful of assignments per
   * on-field view and one frame index for all stand-ins.
   */
  function tick() {
    if (!on) return;
    const now = performance.now();
    const dt = Math.min(0.25, Math.max(0, (now - lastAt) / 1000));
    lastAt = now;
    phase += dt;
    // the reading in `stats()`: the first sheet of this session's strategy (amiya2 70 frames / amiya 27 / mix amiya2)
    const primary = GIF_VARIANTS[strategies()[0]] || GIF_ASSET;
    frameIndex = Math.floor(phase * primary.fps) % primary.count;
    ensureLayer();
    for (const [key, v] of views) {
      if (!v || v.destroyed) continue;
      const pick = pickFor(key);
      // the unit keeps showing itself until ITS sheet has loaded: a failed download never empties the field
      const frames = cutFrames(pick);
      if (!frames) continue;
      const at = placement(v);
      /** @type {any} */
      let spr = sprites.get(key);
      if (!spr) {
        spr = new P.AnimatedSprite(frames);
        spr.anchor.set(0.5, 1);
        spr.autoUpdate = false;             // one clock for every stand-in, driven below (no per-sprite ticker)
        layer.addChild(spr);
        sprites.set(key, spr);
      }
      hideOne(v);
      const a = GIF_VARIANTS[pick];
      spr.currentFrame = Math.floor(phase * a.fps) % a.count;
      spr.visible = v.placed === true && !v.culled && at.s > 0;
      spr.position.set(at.x, at.y);
      spr.zIndex = at.z;                    // the unit's own depth key: the stand-ins keep the units' order
      spr.alpha = at.alpha;
      const h = Math.max(4, at.s * HEIGHT_TILES);
      const flip = typeof v.modelFlip === 'function' ? v.modelFlip() : (v.facing === -1 ? -1 : 1);
      spr.scale.set((flip * h) / a.size, h / a.size);
    }
    // a view that left the field loses its stand-in and its pick (a dead unit's stand-in fades out through the view's
    // own alpha first — the view is only dropped once that fade ended)
    for (const [key, spr] of sprites) {
      if (views.has(key)) continue;
      try { layer?.removeChild(spr); spr.destroy(); } catch { /* already gone */ }
      sprites.delete(key);
      picks.delete(key);
    }
  }

  return {
    /** Whether the effect is on (a sheet may still be loading: those units then keep showing until it does). */
    get on() { return on; },
    /**
     * Turn the effect on or off. `false` is idempotent. Returns whether it is on after the call — `false` when
     * `prefers-reduced-motion: reduce` refuses it.
     *
     * `nextStrategy` names the strategy to draw (`GIF_STRATEGIES`); it is read only when the effect is being switched
     * on (or the effect is already on with another one: then the old one is put away first). Absent or unknown: the
     * current strategy (the default `amiya2` at first). Every switch-on draws a fresh seed, so `mix` assigns each
     * unit its sheet anew for that session.
     * @param {boolean} want
     * @param {string} [nextStrategy]
     */
    setOn(want, nextStrategy) {
      const next = !!want;
      const v = typeof nextStrategy === 'string' && GIF_STRATEGIES[nextStrategy] ? nextStrategy : strategy;
      if (next) {
        if (reducedMotion()) return false;
        if (v !== strategy) {
          // a different strategy: put the current one away first (views restored, its frames freed), then draw anew
          setOff();
          strategy = v;
        }
        if (on) return on;
        picks.clear();
        seed = fixedSeed != null ? fixedSeed : newSeed();
        phase = 0;
        frameIndex = 0;
        lastAt = performance.now();
        on = true;
        return on;
      }
      if (!on) return on;
      setOff();
      return on;
    },
    tick,
    /**
     * Dev / test reading: what the effect currently draws and what it stands in for. `counts` is per sheet, over the
     * stand-ins that actually stand on the field; `picks` is the per-unit assignment (`mix`).
     */
    stats() {
      const frames = {};
      const failed = {};
      for (const id of GIF_VARIANT_IDS) {
        const s = sheets.get(id);
        frames[id] = s && s.frames ? s.frames.length : 0;
        failed[id] = !!(s && s.failed);
      }
      const counts = {};
      for (const id of GIF_VARIANT_IDS) counts[id] = 0;
      for (const key of sprites.keys()) {
        const p = picks.get(key);
        if (p in counts) counts[p]++;
      }
      const picksByKey = {};
      for (const [key, p] of picks) picksByKey[String(key)] = p;
      return {
        on, strategy, seed, sprites: sprites.size, views: views.size, hidden: hidden.size,
        frame: frameIndex, picks: picksByKey, counts, frames, failed, sheets: sheets.size,
      };
    },
    /**
     * Dev / test: fix the seed the next switch-on draws from (`setSeed(null)` goes back to a fresh random one). The
     * pick is `pickVariant(key, seed)`, so a fixed seed makes a session's per-unit assignment reproducible.
     * @param {number | null} n
     */
    setSeed(n) {
      fixedSeed = typeof n === 'number' && Number.isFinite(n) ? (n >>> 0) : null;
      if (fixedSeed != null) seed = fixedSeed;
      return seed;
    },
    /** Unmount (the field view is going away): off first, so the views are left as they were. */
    destroy() {
      setOff();
      hidden.clear();
    },
  };
}
