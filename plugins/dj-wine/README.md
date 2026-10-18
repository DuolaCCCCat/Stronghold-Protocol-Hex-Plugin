# 粥友的酒 (dj-wine)

A `ui`-class plugin: one **「粥友的酒」** button in the **bottom-left of the battle screen**. Click it and the DJ
starts, the song plays on a loop **and the host's battle HUD turns** (`effect: dj-rotate`, one of the named host
visuals a ui plugin may ask for), **with the host's night-club RGB lighting on** (`effect: dj-neon`: a rim rainbow
that rolls behind a mask plus 4–8 softly blurred coloured blobs, re-randomized on every playback, `pointer-events:
none`); click again and it stops and the interface is exactly as before. Clicking once more starts it again. Personal
switch, **in-match only** — a player who leaves it off sees and loads nothing.

- **Where it lives:** the `hud.right` slot (`public/js/screens/game.js`), i.e. only while the battle screen exists.
  One plugin per slot, so another `hud.right` plugin cannot share it (the first switched on gets it). The slot is a
  direct child of the match screen (a sibling of `.gm__hud`), which is what lets the plugin move its own frame and
  lets the HUD turn without turning the button.
- **Its default place:** the slot's own place is the bottom-right, where the shop bar is, so **the page sends `frame`
  itself** on first mount and puts the button in the **bottom-left**, above the corner buttons (交流 / ⚙ / 📖 / ⛶) and
  clear of the shop bar — `placeDefault` in `index.template.html`. It derives the host's rem from the play area
  (`clamp(40, min(vw/19.2, vh/10.8), 240)`, the same formula as `css/theme.css`) and lifts the button by the corner's
  rows (`.24rem + 2·.56rem + .1rem`, with a 92 px floor for a narrow phone whose corner wraps into two rows). Nothing
  is drawn until that place arrives, so the button never flashes in the corner it is leaving. The page's own column
  (panel above button, `gap: 6px`) is what would stack a second icon instead of overlapping one.
- **Moving it:** the button (and the panel title bar) can be dragged anywhere in the play area. The page sends
  `{ v: 1, t: 'frame', x, y, w, h }` and the host moves the **whole iframe** (clamped inside the match screen), then
  answers with the rect it applied. The remembered place is stored as a fraction of the play area, so a refresh or a
  new match puts it back. The frame stays a small box (80×97 closed, 240×315 open); what it covers is the plugin's own
  business, and the pass-over area is the host's again as soon as it moves.
- **The effect it asks for:** while the music plays the page sends `{ v: 1, t: 'effect', name: 'dj-rotate', on: true }`
  and `{ v: 1, t: 'effect', name: 'dj-neon', on: true }`; the host owns both visuals and releases them on `on: false`
  (stop / close / leaving). Neither is a style channel: `dj-rotate` is a class on the HUD plus one transform per field
  view's root container, `dj-neon` is one decorative box the host builds on the body (removed whole on off, so the DOM,
  the computed styles and `getAnimations()` are what they were). `prefers-reduced-motion: reduce` applies neither.
- **The progress bar:** it is the **current playback's** position — every start resets it to `00:00` and it counts up
  from there (the music restarts from the beginning at the same moment). Stopping, closing the panel and leaving the
  match all put it back to 0, so the next start begins at 0 rather than resuming the last session's time.
- **Transparent:** the page's `html`/`body` are transparent **and** declare `color-scheme: dark` (with only
  `background: transparent` Chromium still paints the iframe's blank canvas white — measured in a real browser);
  the host's iframe element paints no background/border and stays `opacity: 0` until its entry `load`, so there is no
  white flash. The shop and the field show through the frame's empty area.
- **How it makes sound:** **Web Audio**, not `<audio>`. The host serves a ui plugin's page with `UI_FRAME_CSP`
  (`default-src 'none'; …; img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts`), which has **no
  `media-src`** — so it falls back to `default-src 'none'` and `<audio>`/`<video>` cannot load from *any* source
  (a same-origin `/p/…` path, a `blob:` URL and a `data:` URI were all measured failing in a real browser). The mp3
  is therefore inlined as base64 in `ui/index.html`, decoded with `decodeAudioData` and played through
  `AudioBufferSource → Analyser → destination`: no resource load happens, so CSP does not apply. The button's GIF is
  inlined the same way (`img-src` explicitly allows `data:`), because a ui plugin folder may only carry
  `.json .html .js .css .png` and documents — not `.mp3` or `.gif`.
- **Untracked by git:** `plugins/*` is git-ignored; this one folder is whitelisted (`.gitignore`:
  `!plugins/dj-wine/` + `!plugins/dj-wine/**`). `ui/index.html` is **generated** — see below.

## Generated page

`ui/index.html` is built from the sources in `plugins-src/dj-wine/` (which lives outside the `plugins/` scan and so
may hold `.mp3`, `.gif` and `.mjs`):

```bash
node plugins-src/dj-wine/build-page.mjs           # rebuild ui/index.html from the template + assets
node plugins-src/dj-wine/build-page.mjs --check   # fail if ui/index.html is stale (CI)
```

Never hand-edit `ui/index.html`: the next build overwrites it.

## Self-check

```bash
node tools/plugin.mjs check dj-wine --strict      # 0 problems, 0 warnings
SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-wine.e2e.test.js
```

## Sources and licensing

- **Implementation reference — behaviour and parameters only, no code copied.** The in-match entry, the floating
  panel, the `frame` drag protocol and the rotation / squash parameters follow `cyanfish.dj-all` (repository
  `Stronghold-Protocol-CyanModPack`, author **CyanF1sh**,
  <https://github.com/CyanF1sh/Stronghold-Protocol-CyanModPack>). That repository is **GPL-3.0**; nothing from it — no
  code, no asset — is included here, and the same visuals are an independent implementation, so this repository's
  licensing is unaffected.
- **The button GIF comes from the internet, by the Bilibili creator 「疚刃」**:
  <https://space.bilibili.com/107716290>. The character is Hypergryph / Yostar's and the GIF itself is that creator's
  fan work; no official game art is included.
- **The music is provided by the user and comes from the internet**; the rights stay with their holders.
- If a rights holder objects, the matching asset file is removed and the feature code stays — see
  [`NOTICE`](../../NOTICE). Feature write-up: [`docs/DJ-BUTTONS.md`](../../docs/DJ-BUTTONS.md).
