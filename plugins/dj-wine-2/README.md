# 粥友的酒 2 (dj-wine-2)

A `ui`-class plugin: the **fourth** button in the battle screen, built on 「粥友的酒」 (dj-wine): the same Amiya
animation and the same song, but with **no ring, name label, badge or breathing / spin ornament on the button** — the
icon alone. Click it and the DJ starts: the song loops, **the host's battle HUD turns** (`effect: dj-rotate`), **the
host's night-club RGB lighting comes on** (`effect: dj-neon`) and **every unit on the field becomes the FIRST Amiya
GIF stand-in** (`effect: units-gif` with the fixed `strategy: 'amiya'` — the 27-frame 9×3 sheet at
`public/img/dj-units/amiya.png`, the art of `Amiya.gif` itself, deliberately different from the Amiya2 / Prss sheets).
Click again and the music stops, the lights go out, the units are themselves again and the interface is exactly as
before. Personal switch, **in-match only** — a player who leaves it off sees and loads nothing. Author: **DJ-Amiya**.

- **Where it lives:** the `hud.left3` slot (`public/js/screens/game.js`), the fourth row of the battle screen's
  bottom-left stack, only while the match screen exists. One plugin per slot; the three earlier buttons keep
  `hud.right` / `hud.left` / `hud.left2`.
- **Its default place:** the play area's **bottom-left**, three button rows above 「粥友的酒」's row (the slot default
  already sits there; the page lifts its own frame by `3 × 104 px` on first mount, `placeDefault` in
  `index.template.html`), so all four buttons are vertically staggered and none overlaps the others, the corner keys
  or the shop bar. Dragging moves the **whole iframe** anywhere in the play area, and the place is remembered per
  plugin as a fraction of the play area.
- **No extra decoration:** the button is one 46 px Amiya GIF in a plain 1 px frame — no ring, no label, no ♪ badge, no
  breathing glow, no spinning arc. Its accessible name (「粥友的酒 2」) is still on the invisible `aria-label` /
  `title`.
- **The effects it asks for:** while the music plays the page sends `dj-rotate: true`, `dj-neon: true` and
  `{ name: 'units-gif', on: true, strategy: 'amiya' }`; stop / close / leave send all three `on: false`, which destroys
  the stand-in layer, removes the neon box and puts the HUD's parts and every field container back exactly as they
  were. `units-gif`'s `strategy` is a controlled parameter: `amiya` is the only value this host accepts (anything else
  is `PLUGIN_SHAPE`), it cannot be combined with `variant`, and it uses the same renderer / layer / undo path as the
  other strategies — no second rendering path.
- **The progress bar:** it is the **current playback's** position — every start resets it to `00:00` and it counts up
  from there (the music restarts from the beginning at the same moment). Stopping, closing the panel and leaving the
  match all put it back to 0.
- **How it makes sound:** **Web Audio**, not `<audio>` — the host serves a ui plugin's page with `UI_FRAME_CSP`
  (`default-src 'none'; … img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts`), which has **no
  `media-src`**, so `<audio>`/`<video>` cannot load from any source. The mp3 is inlined as base64 in `ui/index.html`,
  decoded with `decodeAudioData` and played through `AudioBufferSource → Analyser → destination`: no resource load
  happens, so CSP does not apply. The button's GIF is inlined the same way (`img-src` allows `data:`), because a ui
  plugin folder may only carry `.json .html .js .css .png` and documents — not `.mp3` or `.gif`.
- **Untracked by git:** `plugins/*` is git-ignored; this folder is whitelisted (`.gitignore`: `!plugins/dj-wine-2/` +
  `!plugins/dj-wine-2/**`). `ui/index.html` is **generated** — see below.

## Generated page

`ui/index.html` is built from the sources in `plugins-src/dj-wine-2/` (which lives outside the `plugins/` scan and so
may hold `.mp3`, `.gif` and `.mjs`):

```bash
node plugins-src/dj-wine-2/build-page.mjs           # rebuild ui/index.html from the template + assets
node plugins-src/dj-wine-2/build-page.mjs --check   # fail if ui/index.html is stale (CI)
```

Never hand-edit `ui/index.html`: the next build overwrites it.

## Self-check

```bash
node tools/plugin.mjs check dj-wine-2 --strict     # 0 problems, 0 warnings
SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-wine-2.e2e.test.js
```

## Sources and licensing

- **The button GIF comes from the internet, by the Bilibili creator 「疚刃」**:
  <https://space.bilibili.com/107716290>. The character is Hypergryph / Yostar's and the GIF itself is that creator's
  fan work; no official game art is included.
- **The music is provided by the user and comes from the internet**; the rights stay with their holders.
- The in-match entry, the floating panel and the drag/frame protocol follow 「粥友的酒」(dj-wine); this page was cut
  from dj-wine's and its button was stripped to the icon. The GIF and the song are the same files dj-wine uses.
- The host visuals this page asks for (`effect: units-gif` with `strategy: 'amiya'` / `dj-rotate` / `dj-neon`) are the
  host's own. Their implementation reference — the behaviour and parameters of `cyanfish.dj-all` (GPL-3.0,
  independently reimplemented, no code copied) — is written up in [`docs/DJ-BUTTONS.md`](../../docs/DJ-BUTTONS.md).
- If a rights holder objects, the matching asset file is removed and the feature code stays — see
  [`NOTICE`](../../NOTICE).
