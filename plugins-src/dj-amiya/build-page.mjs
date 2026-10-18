// plugins-src/dj-amiya/build-page.mjs — 由「模板 + 素材」生成 plugins/dj-amiya/ui/index.html。
//
// 为什么需要生成（两条硬约束，都是实测出来的，与 plugins-src/dj-wine 同一套）：
//
// 1) **CSP 没有 media-src**。宿主给 ui 插件的 CSP 是 UI_FRAME_CSP：
//      default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
//      img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts; …
//    `media-src` 没写 ⇒ 回落到 `default-src 'none'` ⇒ `<audio>`/`<video>` 加载**任何**来源都被拦。
//    ⇒ 音乐只能走 Web Audio：mp3 以 base64 内联进页面，`decodeAudioData` 解码后经
//      AudioBufferSource → Analyser → destination 播放。全程不产生资源加载，CSP 管不到。
//
// 2) **ui 插件只允许 `.json .html .js .css .png` + 文档**（PLUGIN_FILE_TYPE）：
//    `.mp3` / `.gif` / `.mjs` 都放不进插件文件夹。所以素材与模板留在本目录（plugins-src/，不在 plugins/ 扫描范围内），
//    由本脚本把**音频与动画图都内联进 index.html**：mp3 → base64 字符串；gif → `data:image/gif;base64,…`
//    （`img-src` 明确允许 `data:`，而 gif 的 base64 正是宿主放行的那种图片来源）。
//
// 用法：
//   node plugins-src/dj-amiya/build-page.mjs            生成 plugins/dj-amiya/ui/index.html
//   node plugins-src/dj-amiya/build-page.mjs --check    只校验已生成的文件是最新的（不写盘，供 CI 用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const tplFile = path.join(here, 'index.template.html');
const songFile = path.join(here, 'ruo-bushi-ni.mp3');
const gifFile = path.join(here, 'amiya.gif');
const outFile = path.join(repo, 'plugins/dj-amiya/ui/index.html');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const read = (f) => { try { return fs.readFileSync(f); } catch { return null; } };

const tpl = fs.readFileSync(tplFile, 'utf8');
const song = read(songFile);
const gif = read(gifFile);
if (!song) throw new Error(`缺少音频素材：${path.relative(repo, songFile)}`);
if (!gif) throw new Error(`缺少按钮动图：${path.relative(repo, gifFile)}`);

for (const ph of ['__SONG_B64__', '__GIF_DATA_URI__']) {
  if (!tpl.includes(ph)) throw new Error(`模板里找不到 ${ph} 占位符`);
}

const songB64 = song.toString('base64');
const gifUri = 'data:image/gif;base64,' + gif.toString('base64');
const out = tpl.split('__SONG_B64__').join(songB64).split('__GIF_DATA_URI__').join(gifUri);
const outBuf = Buffer.from(out, 'utf8');

if (process.argv.includes('--check')) {
  const cur = read(outFile);
  if (!cur) { console.error(`✗ ${path.relative(repo, outFile)} 不存在 —— 跑一次 node plugins-src/dj-amiya/build-page.mjs`); process.exit(1); }
  if (!cur.equals(outBuf)) { console.error(`✗ ${path.relative(repo, outFile)} 与素材/模板不一致 —— 重新生成`); process.exit(1); }
  console.log(`✓ ${path.relative(repo, outFile)} 是最新的（${kb(outBuf.length)}）`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, outBuf);
console.log(`mp3   ${kb(song.length)} -> base64 ${kb(songB64.length)}`);
console.log(`gif   ${kb(gif.length)} -> data URI ${kb(gifUri.length)}`);
console.log(`html  ${kb(Buffer.byteLength(tpl))} (模板) -> ${kb(outBuf.length)} (index.html)`);
console.log(`写到  ${path.relative(repo, outFile)}`);
