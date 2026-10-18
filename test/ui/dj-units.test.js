// test/ui/dj-units.test.js — the host's stand-in sheets for the ui plugins' `units-gif` visual (render/unitsGif.js).
//
// The effect slices `public/img/dj-units/<sheet>.png` with the table it carries (GIF_VARIANTS): 112 px cells with the
// 96 px frame in the middle (an 8 px transparent gutter, so a neighbouring frame can never bleed into a sampled edge).
// `amiya2` and `prss` are 10×7/70-frame sheets; `amiya` (the fixed strategy's sheet) is the FIRST one, 9×3/27 frames.
// Catching a sheet that no longer matches the table here is cheap; catching it in the browser is not. `amiya2` is the default (dj-amiya's sheet); `prss` is the third button's. Each byte file is the source GIF
// (Amiya2.gif / Prss.gif), cropped to the union of its 70 frames' alpha bounds, scaled and tiled (see the header of
// public/js/render/unitsGif.js for both ffmpeg commands). No official game art: the gifs are fan-made emoticons.
//
// The message's `variant` is a STRATEGY (UI_UNIT_VARIANTS): `amiya2` draws one sheet for the whole field, `mix` lets
// every unit draw one of the two. The per-unit pick is `pickVariant(key, seed)`, a pure function — these tests are what
// fails if `mix` ever collapses back to a single sheet (a constant pick) or stops being stable per unit.
//
// **How big a stand-in reads is the content box of its sheet.** The renderer scales a frame by ONE factor for every
// variant (`h / asset.size`), so what the eye compares — and what the stand-in of a unit on the field really measures —
// is the fraction of the 96 px frame the art fills. `prss.png` first filled 96×96 of it against `amiya2`'s 84×96 (the
// two source GIFs were cropped to the same frame but not to the same content scale, so a `mix` field showed one
// character 14 % wider than the other), and was squeezed to that 84×96 box (sx = 84/96 = 0.875, feet row and height
// kept). A follow-up asked for the prss GIF itself to come down as well — 25 % first, judged too much, so 20 %: the
// sheet is 0.80× of that box now — ~67×76 of art, feet row kept — so the prss stand-in is drawn at 0.80× of amiya2's
// on both axes, deliberately NOT the same size, and always in the asset (`public/js/render/unitsGif.js` header), never
// as a per-variant factor in the renderer. The test below measures the boxes straight out of the PNGs, which is what
// makes regenerating either sheet at another ratio fail here instead of on somebody's board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
  GIF_ASSET, GIF_STRATEGIES, GIF_STRATEGY, GIF_STRATEGY_IDS, GIF_VARIANTS, GIF_VARIANT_IDS, pickVariant,
} from '../../public/js/render/unitsGif.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Decode an 8-bit RGBA, non-interlaced PNG (the only kind the two sheets are, and the only kind this needs) to
 * `{ w, h, px }` with `px` a row-major Uint8Array of RGBA bytes. `node:zlib` is all it takes; no image dependency.
 * @param {string} file absolute path
 */
function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${file}: PNG signature`);
  assert.equal(buf.readUInt32BE(4), 0x0d0a1a0a, `${file}: PNG signature`);
  const idat = [];
  let pos = 8;
  let head = null;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString('latin1');
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') head = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  assert.ok(head && idat.length, `${file}: IHDR and IDAT chunks`);
  const w = head.readUInt32BE(0);
  const h = head.readUInt32BE(4);
  assert.deepEqual([head[8], head[9], head[12]], [8, 6, 0], `${file}: 8-bit RGBA, not interlaced`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = w * bpp;
  assert.equal(raw.length, h * (stride + 1), `${file}: one filter byte + ${stride} bytes per row`);
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const at = y * stride;
    const prev = at - stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? px[at + x - bpp] : 0;
      const up = y > 0 ? px[prev + x] : 0;
      const upLeft = y > 0 && x >= bpp ? px[prev + x - bpp] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        add = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else assert.equal(filter, 0, `${file}: row ${y}: known PNG filter (${filter})`);
      px[at + x] = (row[x] + add) & 0xff;
    }
  }
  return { w, h, px };
}

/**
 * The union of the 70 frames' content box inside their 96 px frame: `{ x, y, w, h }`, measured where the alpha
 * channel is above `thr`. This is the number the normalisation above is about — the box the renderer scales.
 * @param {{ w: number, h: number, px: Uint8Array }} img @param {typeof GIF_VARIANTS.amiya2} asset @param {number} thr
 */
function contentBox(img, asset, thr) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < asset.count; i += 1) {
    const ox = (i % asset.cols) * asset.cell + asset.inset;
    const oy = Math.floor(i / asset.cols) * asset.cell + asset.inset;
    for (let y = 0; y < asset.size; y += 1) {
      for (let x = 0; x < asset.size; x += 1) {
        if (img.px[((oy + y) * img.w + ox + x) * 4 + 3] <= thr) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  assert.ok(x1 >= x0 && y1 >= y0, 'a sheet with no visible pixel in any frame draws nothing');
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Every byte of the 8 px gutter around the 70 frames is transparent, so a neighbouring frame cannot bleed in. */
function gutterInk(img, asset) {
  let ink = 0;
  for (let y = 0; y < img.h; y += 1) {
    for (let x = 0; x < img.w; x += 1) {
      const col = Math.floor(x / asset.cell);
      const row = Math.floor(y / asset.cell);
      const inFrame = col < asset.cols && row < asset.rows
        && x - col * asset.cell >= asset.inset && x - col * asset.cell < asset.inset + asset.size
        && y - row * asset.cell >= asset.inset && y - row * asset.cell < asset.inset + asset.size;
      if (!inFrame && img.px[(y * img.w + x) * 4 + 3] > 0) ink += 1;
    }
  }
  return ink;
}

test('every stand-in sheet matches the frame table the effect slices it with', () => {
  assert.deepEqual([...GIF_VARIANT_IDS], ['amiya2', 'prss', 'amiya'], 'the three sheets the effect can draw');
  assert.equal(GIF_ASSET, GIF_VARIANTS.amiya2, 'the default sheet is the one dj-amiya has always used');
  assert.equal(GIF_VARIANTS.amiya.url, '/img/dj-units/amiya.png', 'the fixed `amiya` strategy draws the FIRST sheet');
  assert.equal(GIF_VARIANTS.amiya2.url, '/img/dj-units/amiya2.png', 'the Amiya2 sheet has its own file');
  const urls = new Set();
  for (const [name, asset] of Object.entries(GIF_VARIANTS)) {
    const rel = asset.url.replace(/^\//, '');
    const file = path.join(ROOT, 'public', rel);
    assert.ok(fs.existsSync(file), `${name}: the sheet is committed: public/${rel}`);
    const buf = fs.readFileSync(file);
    // PNG signature, then the IHDR chunk: length, type, width, height
    assert.equal(buf.readUInt32BE(0), 0x89504e47, `${name}: it is a PNG`);
    assert.equal(buf.subarray(12, 16).toString('latin1'), 'IHDR', `${name}: IHDR comes first`);
    assert.equal(buf.readUInt32BE(16), asset.cols * asset.cell, `${name}: the sheet is as wide as the table says`);
    assert.equal(buf.readUInt32BE(20), asset.rows * asset.cell, `${name}: and as tall`);
    // the frame sits inside its cell with the transparent gutter on both sides
    assert.ok(asset.inset > 0, `${name}: the gutter keeps a neighbouring frame out of a sampled edge`);
    assert.equal(asset.inset * 2 + asset.size, asset.cell, `${name}: 8 + 96 + 8`);
    // the first Amiya sheet is the 27-frame 9×3 one (e896f54f); the other two are 70-frame 10×7 ones
    assert.equal(asset.count, name === 'amiya' ? 27 : 70, `${name}: ${name === 'amiya' ? 27 : 70} frames`);
    assert.equal(asset.fps, 10, `${name}: 10 fps`);
    assert.equal(asset.cols, name === 'amiya' ? 9 : 10, `${name}: the grid's columns`);
    assert.equal(asset.rows, name === 'amiya' ? 3 : 7, `${name}: the grid's rows`);
    assert.ok(asset.cols * asset.rows >= asset.count, `${name}: the grid has room for every frame`);
    // a host asset a page fetches from the site root (siteCsp img-src 'self'), not a plugin file under /p/
    assert.match(asset.url, /^\/img\/dj-units\/[a-z0-9-]+\.png$/, `${name}: a site-root sheet`);
    urls.add(asset.url);
  }
  assert.equal(urls.size, 3, 'the three sheets are three different files, not one sheet twice');
});

test('the variant is a strategy: one sheet for the field, or one sheet per unit, or the first sheet', () => {
  assert.deepEqual([...GIF_STRATEGY_IDS], ['amiya2', 'mix', 'amiya'], 'the three strategies the effect can be asked for');
  assert.equal(GIF_STRATEGY, 'amiya2', 'the default strategy is the one dj-amiya has always drawn');
  assert.deepEqual([...GIF_STRATEGIES.amiya2], ['amiya2'], 'amiya2 draws its own sheet only — the Amiya2 plugin stays pure');
  assert.deepEqual([...GIF_STRATEGIES.mix], ['amiya2', 'prss'], 'mix draws from both sheets');
  assert.deepEqual([...GIF_STRATEGIES.amiya], ['amiya'], 'amiya pins the whole field to the first Amiya sheet');
  for (const [name, list] of Object.entries(GIF_STRATEGIES)) {
    assert.ok(list.length >= 1, `${name}: a strategy names at least one sheet`);
    for (const v of list) assert.ok(GIF_VARIANTS[v], `${name}: ${v} is a sheet the host can slice`);
  }
});

test('mix picks per unit: stable for a unit and a session, mixed across the field', () => {
  const keys = Array.from({ length: 120 }, (_, i) => `p:${i}`);
  const picks = keys.map((k) => pickVariant(k, 12345));
  // one unit never changes its sheet: the same key and seed always give the same answer (the effect is a pure hash,
  // not Math.random per frame — a per-frame roll would flicker between the two GIFs)
  assert.deepEqual(keys.map((k) => pickVariant(k, 12345)), picks, 'the same unit keeps its sheet');
  // and the field is really mixed rather than one sheet for everyone
  assert.ok(picks.includes('amiya2') && picks.includes('prss'), 'both sheets appear on the same field');
  const n = picks.filter((p) => p === 'amiya2').length;
  assert.ok(n > 30 && n < 90, `the split is roughly half and half (${n} of ${keys.length} amiya2)`);
  // a new session (another seed) draws again, and the pick stays stable within that session
  const other = keys.map((k) => pickVariant(k, 999));
  assert.deepEqual(keys.map((k) => pickVariant(k, 999)), other, 'another session keeps its own assignment too');
  assert.ok(keys.some((k, i) => picks[i] !== other[i]), 'a different session can assign a unit the other sheet');
  // only the two known sheets come out
  for (const p of [...picks, ...other]) assert.ok(GIF_VARIANT_IDS.includes(p), `a known sheet (${p})`);
});

test('the prss stand-in is drawn at 0.80× of amiya2: the sheet sets the size, not the renderer', () => {
  /** @type {Record<string, { box: { x: number, y: number, w: number, h: number }, solid: ReturnType<typeof contentBox> }>} */
  const sheets = {};
  for (const [name, asset] of Object.entries(GIF_VARIANTS)) {
    const img = readPng(path.join(ROOT, 'public', asset.url.replace(/^\//, '')));
    sheets[name] = { box: contentBox(img, asset, 0), solid: contentBox(img, asset, 8) };
  }
  const a = sheets.amiya2.box;
  const p = sheets.prss.box;
  // The renderer scales BOTH sheets by h / 96, so a stand-in's drawn size IS its sheet's content box. The ask
  // is a ratio of 0.80× — 20 % smaller than amiya2 (25 % was the first try and read as too much), because the prss GIF
  // looked like the bigger character on a `mix` field — and it must live in prss.png: a per-variant factor in the
  // renderer is exactly what this file exists to prevent. 3 % is the tolerance the real-browser check uses too — the
  // resample moves the alpha box by a pixel, not by a tenth.
  const rw = p.w / a.w;
  const rh = p.h / a.h;
  assert.ok(Math.abs(rw - 0.80) <= 0.03, `prss is 0.80× amiya2's width (amiya2 ${a.w} px, prss ${p.w} px, ratio ${rw.toFixed(4)})`);
  assert.ok(Math.abs(rh - 0.80) <= 0.03, `prss is 0.80× amiya2's height (amiya2 ${a.h} px, prss ${p.h} px, ratio ${rh.toFixed(4)})`);
  // the feet — the sprite's anchor, the frame's bottom row — did not move, so no sheet shifts a unit up or down
  assert.equal(p.y + p.h, a.y + a.h, `both boxes end on the frame's bottom row (amiya2 ${a.y + a.h}, prss ${p.y + p.h})`);
  // and the art stays on the frame's middle line, so shrinking it did not move the character sideways
  for (const [name, b, asset] of [['amiya2', a, GIF_VARIANTS.amiya2], ['prss', p, GIF_VARIANTS.prss]]) {
    const mid = b.x + b.w / 2;
    assert.ok(Math.abs(mid - asset.size / 2) <= 1, `${name}: the content box is centred on the frame (centre ${mid.toFixed(1)}, frame ${asset.size})`);
  }
  // the same ratio holds for the SOLID content box (alpha above the resample's anti-aliasing fringe), so a faint halo
  // cannot pass for a sheet drawn at the ratio while the drawn character is bigger
  const as = sheets.amiya2.solid;
  const ps = sheets.prss.solid;
  assert.ok(Math.abs(ps.w / as.w - 0.80) <= 0.03,
    `solid content width: prss is 0.80× amiya2's (amiya2 ${as.w} px, prss ${ps.w} px, ratio ${(ps.w / as.w).toFixed(4)})`);
  assert.ok(Math.abs(ps.h / as.h - 0.80) <= 0.03,
    `solid content height: prss is 0.80× amiya2's (amiya2 ${as.h} px, prss ${ps.h} px, ratio ${(ps.h / as.h).toFixed(4)})`);
});

test('every cell gutter is transparent, so no frame can sample its neighbour', () => {
  for (const [name, asset] of Object.entries(GIF_VARIANTS)) {
    const img = readPng(path.join(ROOT, 'public', asset.url.replace(/^\//, '')));
    assert.equal(gutterInk(img, asset), 0, `${name}: the ${asset.inset} px gutter around every frame is empty`);
  }
});

