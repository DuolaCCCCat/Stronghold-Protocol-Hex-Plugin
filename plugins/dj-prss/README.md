# 说不痛苦那是假的 (dj-prss)

A `ui`-class plugin: a **third** button in the battle screen, beside 「粥友的酒」 (dj-wine, `hud.right`) and
「若不是你突然闯进我生活」 (dj-amiya, `hud.left`). It shows the prss animation **alone — no name on the button** — and
clicking it plays 「说不痛苦那是假的」 on a loop, **turns every unit on the field into a GIF stand-in** (the host's
`effect: units-gif`), **turns the battle interface and the pieces / enemies / items on the board** (the host's
`effect: dj-rotate`, the same switch dj-wine and dj-amiya use) and **lights the host's night-club RGB layers** (the
host's `effect: dj-neon`, the same one box the other two use). The stand-in art is **per unit**: every unit on the
field draws either the host's `prss` sheet or its `amiya2` sheet, each unit one of the two for the whole session, so
the two GIFs appear side by side (the host's `mix` strategy — never one sheet for the whole field). Click it again and
the music stops and the field is exactly the field from before. Personal switch, **in-match only** — a player who
leaves it off sees and loads nothing. Its progress bar shows the current playback's position and starts again at
`00:00` on every start.

- **Where it lives:** the `hud.left2` slot (`public/js/screens/game.js`), a direct child of the match screen beside the
  `hud.right` / `hud.left` slots. One plugin per slot, so the three buttons never fight over a place: dj-wine keeps
  `hud.right`, dj-amiya keeps `hud.left`, this one asks for `hud.left2`.
- **Where it starts:** the play area's **bottom-left**, two button rows above dj-wine's button and one above
  dj-amiya's — the three slot defaults are bottom-left and vertically staggered, so none of them overlap. The page
  places itself with one `frame` message on first entry (position stored as a fraction of the play area, like the other
  two), and dragging still moves the **whole iframe** anywhere in the play area; the place is remembered per plugin, so
  the three buttons keep separate memories.
- **No visible name:** the button is the ring and the animated GIF only. The accessible name stays as an invisible
  `aria-label` / `title` (「说不痛苦那是假的」), so a screen reader and the tooltip still say what it is.
- **How it makes sound:** **Web Audio**, not `<audio>` — the host serves a ui plugin's page with `UI_FRAME_CSP`
  (`default-src 'none'; … img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts`), which has **no
  `media-src`**, so `<audio>`/`<video>` cannot load from any source. The mp3 is inlined as base64 in `ui/index.html`,
  decoded with `decodeAudioData` and played through `AudioBufferSource → Analyser → destination`: no resource load
  happens, so CSP does not apply. The button's GIF is inlined the same way (`img-src` allows `data:`), because a ui
  plugin folder may only carry `.json .html .js .css .png` and documents — not `.mp3` or `.gif`.
- **The units (two GIFs at once):** while the music plays the page sends
  `{ v: 1, t: 'effect', name: 'units-gif', on: true, variant: 'mix' }`; `mix` is the host's **per-unit** strategy — the
  host hides the field's unit views and draws one animated GIF per unit, each unit drawing either the `prss` sheet or
  the `amiya2` sheet (`public/js/render/unitsGif.js`, `public/img/dj-units/`), so the two GIFs interleave on the board.
  Every unit is assigned once, when it appears, and keeps its sheet for the whole session (never a per-frame flicker);
  a unit that leaves the field drops its assignment. A newcomer never leaves the field on one sheet, so two or more
  units always really show both. The variant is a controlled parameter with exactly two names — `amiya2` (one sheet,
  what dj-amiya asks for) and `mix` — anything else is `PLUGIN_SHAPE`. Stopping, closing the panel and leaving the
  match each send `on: false`, which destroys the stand-ins and shows the units again — visibility only, the sim and
  the records are untouched. `prefers-reduced-motion: reduce` never enables it.
- **The progress bar:** it is the **current playback's** position — every start resets it to `00:00` and it counts up
  from there (the music restarts from the beginning at the same moment). Stopping, closing the panel and leaving the
  match all put it back to 0, so the next start begins at 0 rather than resuming the last session's time.
- **The interface:** together with `units-gif` the page sends `{ v: 1, t: 'effect', name: 'dj-rotate', on: true }` —
  the same controlled visual 「粥友的酒」 and dj-amiya ask for, so the battle HUD's parts turn and squash
  (`public/css/screens/game.css`) while every piece / enemy / item on the board does the same in canvas
  (`public/js/render/djRotate.js`, one container transform per view). `on: false` goes out with the same events and
  puts both back exactly (the HUD at its own `transform`, every container at its own `scale`); reduced motion leaves
  it off too.
- **The lighting:** the same three events include `{ v: 1, t: 'effect', name: 'dj-neon', on: true }` — the host's own
  night-club RGB layers (`public/js/ui/pluginFrame.js` builds one `position: fixed`, `pointer-events: none` box on the
  body; `public/css/screens/game.css` draws the rim rainbow and the blobs). It is a **host capability**: this plugin
  carries no code or style for it, and all three DJ plugins use the same box — the host accounts for it per plugin, so
  two of them playing at once still show **one** box, one stopping while another still wants it leaves it on, and the
  last one stopping (or the match being left) removes it whole. Reduced motion never creates it.
- **Untracked by git:** `plugins/*` is git-ignored; this folder is whitelisted (`.gitignore`: `!plugins/dj-prss/` +
  `!plugins/dj-prss/**`). `ui/index.html` is **generated** — see below.

## Generated page

`ui/index.html` is built from the sources in `plugins-src/dj-prss/` (which lives outside the `plugins/` scan and so
may hold `.mp3`, `.gif` and `.mjs`):

```bash
node plugins-src/dj-prss/build-page.mjs           # rebuild ui/index.html from the template + assets
node plugins-src/dj-prss/build-page.mjs --check   # fail if ui/index.html is stale (CI)
```

Never hand-edit `ui/index.html`: the next build overwrites it.

The browser test checks the button GIF by decoding it (and, where Edge exposes `ImageDecoder`, by the gif's real frame
count), never by two composited screenshots: on this machine an iframe's animated GIF does not advance between
screenshots, so a pixel diff would prove nothing. (The same trap is why `test/ui/dj-amiya.e2e.test.js` cannot be relied
on for its icon-animation assertion here.)

## Self-check

```bash
node tools/plugin.mjs check dj-prss --strict      # 0 problems, 0 warnings
SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-prss.e2e.test.js
```

## Sources and licensing

- **The button GIF comes from the internet, by the Bilibili creator 「疚刃」**:
  <https://space.bilibili.com/107716290>. The character is Hypergryph / Yostar's and the GIF itself is that creator's
  fan work; no official game art is included.
- **The music is provided by the user and comes from the internet**; the rights stay with their holders.
- The in-match entry, the floating panel and the drag/frame protocol follow 「粥友的酒」(dj-wine) and
  「若不是你突然闯进我生活」(dj-amiya); this page was cut from dj-amiya's.
- The host visuals this page asks for (`effect: units-gif` / `dj-rotate` / `dj-neon`) are the host's own. Their
  implementation reference — the behaviour and parameters of `cyanfish.dj-all` (GPL-3.0, independently reimplemented,
  no code copied) — is written up in [`docs/DJ-BUTTONS.md`](../../docs/DJ-BUTTONS.md). The `prss` sheet is drawn at
  0.75× of the `amiya2` one; the ratio is pinned in `test/ui/dj-units.test.js`.
- If a rights holder objects, the matching asset file is removed and the feature code stays — see
  [`NOTICE`](../../NOTICE).
