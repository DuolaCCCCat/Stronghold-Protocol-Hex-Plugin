# 若不是你突然闯进我生活 (dj-amiya)

A `ui`-class plugin: a **second** button in the battle screen, next to 「粥友的酒」 (dj-wine). It shows the Amiya
animation **alone — no name on the button** — and clicking it plays 「若不是你突然闯进我生活」 on a loop, **turns every
unit on the field into an Amiya GIF stand-in** (the host's `effect: units-gif`), **turns the battle interface and
the pieces / enemies / items on the board** (the host's `effect: dj-rotate`, the same switch dj-wine uses) and **lights
the host's night-club RGB layers** (the host's `effect: dj-neon`, the same one box dj-wine uses). Click it
again and the music stops and the field is exactly the field from before. Personal switch, **in-match only** — a
player who leaves it off sees and loads nothing.

- **Where it lives:** the `hud.left` slot (`public/js/screens/game.js`), a direct child of the match screen beside the
  `hud.right` slot of dj-wine. One plugin per slot, so the two buttons never fight over a place: dj-wine keeps
  `hud.right`, this one asks for `hud.left`.
- **Where it starts:** the play area's **bottom-left**, one button row **above** dj-wine's button — both defaults are
  bottom-left and vertically staggered, so the two never overlap. The page places itself with one `frame` message on
  first entry (position stored as a fraction of the play area, like dj-wine), and dragging still moves the **whole
  iframe** anywhere in the play area; the place is remembered per plugin, so the two buttons keep separate memories.
- **No visible name:** the button is the ring and the animated GIF only. The accessible name stays as an invisible
  `aria-label` / `title` (「若不是你突然闯进我生活」), so a screen reader and the tooltip still say what it is.
- **How it makes sound:** **Web Audio**, not `<audio>` — the host serves a ui plugin's page with `UI_FRAME_CSP`
  (`default-src 'none'; … img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts`), which has **no
  `media-src`**, so `<audio>`/`<video>` cannot load from any source. The mp3 is inlined as base64 in `ui/index.html`,
  decoded with `decodeAudioData` and played through `AudioBufferSource → Analyser → destination`: no resource load
  happens, so CSP does not apply. The button's GIF is inlined the same way (`img-src` allows `data:`), because a ui
  plugin folder may only carry `.json .html .js .css .png` and documents — not `.mp3` or `.gif`.
- **The units:** while the music plays the page sends `{ v: 1, t: 'effect', name: 'units-gif', on: true, variant:
  'amiya2' }` — the `amiya2` strategy, i.e. **this one sheet for the whole field** (the other bundled plugin asks for
  `mix`, which gives every unit its own sheet; this one is deliberately unchanged). The host hides the field's unit
  views and draws one animated Amiya GIF per unit (`public/js/render/unitsGif.js`). Stopping,
  closing the panel and leaving the match each send `on: false`, which destroys the stand-ins and shows the units
  again — visibility only, the sim and the records are untouched. `prefers-reduced-motion: reduce` never enables it.
- **The interface:** together with `units-gif` the page sends `{ v: 1, t: 'effect', name: 'dj-rotate', on: true }` —
  the same controlled visual 「粥友的酒」 asks for, so the battle HUD's parts turn and squash
  (`public/css/screens/game.css`) while every piece / enemy / item on the board does the same in canvas
  (`public/js/render/djRotate.js`, one container transform per view). `on: false` goes out with the same three events
  and puts both back exactly (the HUD at its own `transform`, every container at its own `scale`); reduced motion
  leaves it off too.
- **The lighting:** the same three events include `{ v: 1, t: 'effect', name: 'dj-neon', on: true }` — the host's own
  night-club RGB layers (`public/js/ui/pluginFrame.js` builds one `position: fixed`, `pointer-events: none` box on the
  body; `public/css/screens/game.css` draws the rim rainbow and the blobs). It is a **host capability**: this plugin
  carries no code or style for it, and all three DJ plugins use the same box — the host accounts for it per plugin, so
  two of them playing at once still show **one** box, one stopping while another still wants it leaves it on, and the
  last one stopping (or the match being left) removes it whole. Reduced motion never creates it.
- **Untracked by git:** `plugins/*` is git-ignored; this folder is whitelisted (`.gitignore`: `!plugins/dj-amiya/` +
  `!plugins/dj-amiya/**`). `ui/index.html` is **generated** — see below.

## Generated page

`ui/index.html` is built from the sources in `plugins-src/dj-amiya/` (which lives outside the `plugins/` scan and so
may hold `.mp3`, `.gif` and `.mjs`):

```bash
node plugins-src/dj-amiya/build-page.mjs           # rebuild ui/index.html from the template + assets
node plugins-src/dj-amiya/build-page.mjs --check   # fail if ui/index.html is stale (CI)
```

Never hand-edit `ui/index.html`: the next build overwrites it.

## Self-check

```bash
node tools/plugin.mjs check dj-amiya --strict      # 0 problems, 0 warnings
SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-amiya.e2e.test.js
```

## Sources and licensing

- **The button GIF comes from the internet, by the Bilibili creator 「疚刃」**:
  <https://space.bilibili.com/107716290>. The character is Hypergryph / Yostar's and the GIF itself is that creator's
  fan work; no official game art is included.
- **The music is provided by the user and comes from the internet**; the rights stay with their holders.
- The in-match entry, the floating panel and the drag/frame protocol follow 「粥友的酒」(dj-wine), whose page is the
  base this one was cut from.
- The host visuals this page asks for (`effect: units-gif` / `dj-rotate` / `dj-neon`) are the host's own. Their
  implementation reference — the behaviour and parameters of `cyanfish.dj-all` (GPL-3.0, independently reimplemented,
  no code copied) — is written up in [`docs/DJ-BUTTONS.md`](../../docs/DJ-BUTTONS.md).
- If a rights holder objects, the matching asset file is removed and the feature code stays — see
  [`NOTICE`](../../NOTICE).
