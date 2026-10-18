#!/usr/bin/env python3
r"""Re-scan public/assets/local and merge the files no manifest entry names into data/local-assets.json.

Why this exists
---------------
`data/local-assets.json` is the server's list of the local-client art (it is served as `/data/local-assets.json`,
one of the three manifests `public/js/assetPack.js` validates an imported pack against). `extract.py` writes it job
by job, so a file some *other* writer put under `public/assets/local` — the skin / library jobs of the reference
repo's `extract/skins.py`, a release bundle copied in by hand, `tools/crop-board-atlas.mjs`'s crop table — is on
disk but unnamed. The server then has no URL for it (assetViews.rewriteManifest only rewrites what the manifest
lists), and 「导入素材包」 counts it as *skipped*: `assetPack.js` keeps a pack file only when the plan built from the
manifests names its relative path (`if (!rel || !plan.rels.has(rel) …) { skipped++; continue; }`).

Measured on the 0.3.0 packs (分发/assets-local-*.zip) before this step: `spine` 267 skipped (the 267 back-facing
page textures), `rest` 48 skipped (13 board/map PNG originals + 35 scene files), `library` 0, `fx` 0 (fx has its own
manifest, data/local-fx.json).

口径 — the same shape `extract.py` writes (the shapes were first read off the evaluation line's checkout,
`.port/u030-hex-prs`; the extract.py line numbers below are the ones this branch's rewritten extractor has, checked
against `v0.3.1` = `b3deebda`):
  * a manifest is `{'version': 1, 'source': 'local-client', 'count': <sum of the entries>, 'groups': {…}}`
    (tools/local-extract/extract.py:1013), groups and their keys sorted (extract.py:546, merge_manifest);
  * a group is the file's directory under `public/assets/local` (`<sub>` in extract.py), an entry key is the file
    name (extract.py:766-770) — for a `.webp` copy the key is the stem and `path` points at the copy
    (extract.py:495-512, run_webp);
  * `path` is `/assets/local/` + the segments percent-encoded one by one with `quote(seg, safe='')`
    (the reference repo's extract.py:1688-1702, asset_url — `#` and `+` must be escaped: `library/opavatar/
    char_002_amiya_1%2B/image.png`). The older jobs wrote `[opt]…` literally (extract.py's f-strings); a *new* path
    is always escaped — the server decodes before it resolves a file (server/http/assetViews.js:34-39,
    public/js/assetPack.js:362-373), so both spellings name the same file;
  * a `spine/…` group is ONE model: server/http/assetViews.js:101-113 hashes the group with a single hash over its
    sorted entries, and public/js/assetPack.js:699-756 stores it only when the whole group is present and that
    model hash matches. So this step never moves an existing entry between groups and never rewrites a `path`
    (a group this step adds to gets a new model hash — that is what makes the added file importable at all);
  * an added file is only importable because the plan names its rel path (`plan.rels`,
    public/js/assetPack.js:660-662); `fx/` is `data/local-fx.json`'s (fx.py's own manifest, extract.py:44;
    test/local-extract-fx.test.js:556 asserts data/local-assets.json holds no fx group) — skipped by default.

Guarantees
----------
  * **Only additions.** A file whose decoded `path` is already named anywhere in the manifest is left alone, and no
    entry is ever removed or changed. A manifest entry without its file on disk (`--webp` of a copy not here,
    a release bundle that dropped a tier) keeps its place: this step never prunes.
  * **Idempotent.** The second run finds every file named and writes nothing at all (not even a re-serialization),
    so the bytes and the mtime stay put.
  * **Not a generator.** Values the extractors write (an entry a job re-extracts, `path` of a `.webp` copy, `kind`
    of a file that has a sibling) stay theirs; this only fills the gaps.

Usage (works with the extractor venv or any python3 — standard library only):
  python3 tools/local-extract/rescan-local-assets.py --dry-run      # what it would add, no write
  python3 tools/local-extract/rescan-local-assets.py                # add them
  python3 tools/local-extract/rescan-local-assets.py --check        # exit 1 when something is unnamed (CI/setup)
  .venv-extract312/Scripts/python tools/local-extract/rescan-local-assets.py

Everything is (c) Hypergryph; for private, non-commercial fan use only.
"""
import argparse
import json
import struct
import sys
from pathlib import Path
from urllib.parse import quote, unquote

ROOT = Path(__file__).resolve().parents[2]
LOCAL_PREFIX = '/assets/local/'
# kinds a file gets when it has no sibling entry to copy one from (the manifest's own vocabulary; a guess is logged)
KIND_BY_SUFFIX = {'.png': 'Texture2D', '.webp': 'Texture2D', '.json': 'TextAsset', '.atlas': 'TextAsset',
                  '.skel': 'TextAsset', '.bin': 'TextAsset'}
# the kinds the manifest uses for a page / atlas image (a sibling's own kind that is none of these is logged)
IMAGE_KINDS = ('Texture2D', 'Sprite', 'Lightmap', 'Derived')


def asset_url(rel):
    """`<rel>` (a posix path under public/assets/local) as the URL form extract.py's asset_url writes."""
    return '/'.join(['/assets/local'] + [quote(seg, safe='') for seg in rel.split('/')])


def collect_named(node, out):
    """Every `/assets/local/…` string of a manifest, decoded, as rel paths (the walk assetViews.js does)."""
    if isinstance(node, str):
        if node.startswith(LOCAL_PREFIX):
            out.add(unquote(node[len(LOCAL_PREFIX):]))
    elif isinstance(node, list):
        for x in node:
            collect_named(x, out)
    elif isinstance(node, dict):
        for x in node.values():
            collect_named(x, out)
    return out


def png_size(head):
    if len(head) >= 24 and head[:8] == b'\x89PNG\r\n\x1a\n' and head[12:16] == b'IHDR':
        return struct.unpack('>II', head[16:24])
    return None


def webp_size(data):
    """(w, h) of a WebP: VP8X (extended), VP8 (lossy) or VP8L (lossless), or None."""
    if len(data) < 30 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
        return None
    kind = data[12:16]
    if kind == b'VP8X':
        w = 1 + int.from_bytes(data[24:27], 'little')
        h = 1 + int.from_bytes(data[27:30], 'little')
        return w, h
    if kind == b'VP8 ':
        if data[23:26] != b'\x9d\x01\x2a':
            return None
        w = int.from_bytes(data[26:28], 'little') & 0x3fff
        h = int.from_bytes(data[28:30], 'little') & 0x3fff
        return w, h
    if kind == b'VP8L':
        if data[20] != 0x2f:
            return None
        b = data[21:25]
        w = 1 + (((b[1] & 0x3f) << 8) | b[0])
        h = 1 + (((b[3] & 0x0f) << 10) | (b[2] << 2) | ((b[1] & 0xc0) >> 6))
        return w, h
    return None


def image_size(path, suffix):
    """Pixel size of a PNG/WebP from its header (no Pillow), or None when it cannot be read."""
    try:
        with path.open('rb') as f:
            head = f.read(32)
            if suffix == '.png':
                return png_size(head)
            if suffix == '.webp':
                return webp_size(head + f.read(32))
    except OSError:
        return None
    return None


def entry_for(rel, path, group_entries, notes):
    """The manifest entry this step writes for `rel` (the file's own directory is its group; `path` its file).

    `kind` (and the `w`/`h` agreement check) is taken from the entry the extractor itself wrote for this asset:
    the one naming the same file name first (the back-facing page's group lists its `<stem>.png` pointing at the
    front facing's copy), else the one that shares the stem and points at an image — `TX_autochessi_BG` (`.webp`)
    for `TX_autochessi_BG.png`, `lm0` for `lm0.png`. A file no entry covers gets the manifest's own kind for its
    suffix, and the guess is logged."""
    entry = {'path': asset_url(rel)}
    base = rel.rsplit('/', 1)[-1]
    stem = base.rsplit('.', 1)[0]
    suffix = base[base.rfind('.'):].lower() if '.' in base else ''
    ref = None
    for e in group_entries.values():
        if not isinstance(e, dict) or not isinstance(e.get('path'), str):
            continue
        if e['path'].rsplit('/', 1)[-1] == base:
            ref = e
            break
        if ref is None and e['path'].rsplit('/', 1)[-1].rsplit('.', 1)[0] == stem \
                and e['path'][e['path'].rfind('.'):].lower() in ('.png', '.webp'):
            ref = e
    kind = ref.get('kind') if ref else None
    if not kind:
        kind = KIND_BY_SUFFIX.get(suffix)
        if kind:
            notes.append(f'{rel}: kind {kind} guessed from {suffix or "the name"} (no sibling entry to copy)')
    if suffix in ('.png', '.webp') and kind and kind not in IMAGE_KINDS:
        notes.append(f'{rel}: the sibling entry {ref["path"]} says kind {kind}, which is not an image kind')
    if kind:
        entry['kind'] = kind
    if suffix in ('.png', '.webp'):
        size = image_size(path, suffix)
        if size:
            entry['w'], entry['h'] = size[0], size[1]
            if ref and (ref.get('w'), ref.get('h')) not in ((None, None), size):
                notes.append(f'{rel}: {size[0]}x{size[1]} but the entry {ref["path"]} says {ref.get("w")}x{ref.get("h")}')
        else:
            notes.append(f'{rel}: no readable image header, so no w/h')
    return entry


def pick_key(group_entries, rel):
    """The entry key for `rel` in a group: the file name, else the shortest unique tail of its path.

    A key is only a label inside its group (assetViews.js hashes the group's `path`s, the client looks entries up
    by name), so a taken name — the `spine/op/<char>/<stem>/back/<stem>.png` page, whose group already lists a
    `<stem>.png` that points at the front facing's copy — is disambiguated as `back/<stem>.png` instead of
    rewriting the entry the extractor wrote."""
    segs = rel.split('/')
    if segs[-1] not in group_entries:
        return segs[-1]
    for n in range(2, len(segs) + 1):
        cand = '/'.join(segs[-n:])
        if cand not in group_entries:
            return cand
    return rel


def canonical(groups):
    """`merge_manifest`'s order (extract.py:542-543): groups sorted, an entry's keys sorted."""
    return {g: dict(sorted(v.items())) for g, v in sorted(groups.items())}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--root', default=str(ROOT), help='the checkout (default: this script\'s repository)')
    ap.add_argument('--out', default=None, help='the extracted art (default <root>/public/assets/local)')
    ap.add_argument('--manifest', default=None, help='the manifest to extend (default <root>/data/local-assets.json)')
    ap.add_argument('--skip', action='append', default=None, metavar='SUBDIR',
                    help='a top-level directory to leave alone (repeatable; default fx, data/local-fx.json\'s)')
    ap.add_argument('--dry-run', action='store_true', help='list what would be added and write nothing')
    ap.add_argument('--check', action='store_true', help='write nothing; exit 1 when a file is unnamed')
    ap.add_argument('--quiet', action='store_true', help='no per-entry lines (the summary still prints)')
    args = ap.parse_args(argv)

    root = Path(args.root).expanduser().resolve()
    out_root = Path(args.out).expanduser().resolve() if args.out else root / 'public/assets/local'
    manifest = Path(args.manifest).expanduser().resolve() if args.manifest else root / 'data/local-assets.json'
    skip = {'fx'} if args.skip is None else set(args.skip)

    if not out_root.is_dir():
        print(f'{out_root} is not a directory', file=sys.stderr)
        return 2
    if not manifest.is_file():
        print(f'No manifest at {manifest}. Extract the local art first (or point --manifest at one).', file=sys.stderr)
        return 2
    raw = manifest.read_bytes()
    try:
        doc = json.loads(raw.decode('utf-8'))
    except (OSError, ValueError) as e:
        print(f'{manifest} is unreadable ({e})', file=sys.stderr)
        return 2
    groups = doc.get('groups') if isinstance(doc, dict) else None
    if not isinstance(groups, dict):
        print(f'{manifest} has no groups', file=sys.stderr)
        return 2

    named = collect_named(doc, set())
    # A WebP copy is not a second asset: extract.py's run_webp REPLACES the entry's path with the copy
    # (extract.py:515, `entry.update(path=…/{name}.webp)`), so the PNG the copy was made from stops being named by
    # the manifest — one entry per asset, never two. Pair the two spellings, or every copy grows a duplicate entry
    # (measured on 0.3.1: the 19 guide pages became 38 entries, test/ui/localArt.test.js asserts the 19).
    paired = set()
    for rel in named:
        if rel.endswith('.webp'):
            paired.add(rel[:-len('.webp')] + '.png')
        elif rel.endswith('.png'):
            paired.add(rel[:-len('.png')] + '.webp')
    on_disk = sorted(p.relative_to(out_root).as_posix() for p in out_root.rglob('*') if p.is_file())
    adds = []
    for rel in on_disk:
        if rel in named or rel in paired or rel.split('/')[0] in skip:
            continue
        group = rel.rsplit('/', 1)[0] if '/' in rel else ''
        adds.append((group, rel))

    notes = []
    plan = []
    for group, rel in adds:
        entries = groups.get(group) if isinstance(groups.get(group), dict) else {}
        key = pick_key(entries, rel)
        plan.append((group, key, entry_for(rel, out_root / rel, entries, notes)))

    for n in notes:
        print(f'note: {n}', file=sys.stderr)
    print(f'{out_root}: {len(on_disk)} files, {len(named & set(on_disk))} named by {manifest.name}, '
          f'{len(plan)} to add' + (f' (skipping {", ".join(sorted(skip))})' if skip else ''))
    for group, key, entry in plan:
        if not args.quiet:
            print(f'  + [{group}] {key} -> {entry["path"]} ({entry.get("kind", "?")}'
                  + (f' {entry["w"]}x{entry["h"]}' if 'w' in entry else '') + ')')
    if not plan:
        print('nothing to add: the manifest already names every file')
        return 0
    if args.check:
        print(f'--check: {len(plan)} file(s) under {out_root} are not named by {manifest.name}')
        return 1
    if args.dry_run:
        print('--dry-run: nothing written')
        return 0

    merged = {g: dict(v) for g, v in groups.items()}
    for group, key, entry in plan:
        merged.setdefault(group, {})[key] = entry
    if json.dumps(canonical(groups), ensure_ascii=False, separators=(',', ':')) == \
            json.dumps(groups, ensure_ascii=False, separators=(',', ':')):
        merged = canonical(merged)          # the file was in extract.py's order: keep that (new keys sorted in)
    count = sum(len(v) for v in merged.values())
    new_doc = {**doc, 'count': count, 'groups': merged}
    text = json.dumps(new_doc, ensure_ascii=False, separators=(',', ':')) + ('\n' if raw.endswith(b'\n') else '')
    manifest.write_text(text, encoding='utf-8')
    print(f'wrote {manifest} ({count} entries, +{len(plan)})')
    return 0


if __name__ == '__main__':
    sys.exit(main())
