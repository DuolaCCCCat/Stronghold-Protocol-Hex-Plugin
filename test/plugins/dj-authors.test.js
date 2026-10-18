// The three bundled DJ ui plugins (dj-wine / dj-amiya / dj-prss) are one author's work, signed `DJ-Amiya`.
//
// The signature the plugin lists show comes from the manifest's `authors` (shared/plugins/manifest.js builds the
// catalogue entry, public/js/ui/pluginPanel.js and 设置 → 界面插件 print it), so a manifest left as another name is a
// wrong signature everywhere — which is exactly what this cheap test catches. `plugins/*` is git-ignored apart from the
// three whitelisted folders, so a checkout without them skips (the studio's own `.studio.json` is authoring state and
// carries no second signature; the READMEs are checked for a stale one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGINS = ['dj-wine', 'dj-amiya', 'dj-prss'];
const AUTHOR = 'DJ-Amiya';
const installed = PLUGINS.every((id) => fs.existsSync(path.join(ROOT, 'plugins', id, 'plugin.json')));

test('the three bundled DJ plugins are all signed DJ-Amiya', { skip: !installed && 'the plugins/ folders are local (git-ignored) and not present here' }, () => {
  for (const id of PLUGINS) {
    const dir = path.join(ROOT, 'plugins', id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'plugin.json'), 'utf8'));
    assert.deepEqual(manifest.authors, [AUTHOR], `${id}: plugin.json authors is exactly ${AUTHOR}`);
    // the studio's authoring state: not a second place to sign
    const studio = JSON.parse(fs.readFileSync(path.join(dir, '.studio.json'), 'utf8'));
    assert.equal(Object.hasOwn(studio, 'authors'), false, `${id}: .studio.json carries no author field`);
    assert.equal(Object.hasOwn(studio, 'author'), false, `${id}: .studio.json carries no author field`);
    // the README may describe the work but must not name another signature
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /(?:作者|author|authors)\s*[:：]\s*hex\b/i, `${id}: the README names no other signature`);
  }
});
