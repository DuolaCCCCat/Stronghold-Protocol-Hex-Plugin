# 四个局内 DJ 按钮：接手说明

局内的四颗「整活」按钮。点一下：放歌、战斗界面与棋盘一起转起来、点亮夜店灯效；后三颗还会把场上单位换成
GIF 动画替身。再点一下全部复原，关掉面板也复原（音乐可以继续）。四个插件都是 `ui` 类、`scope: personal`、
**只在局内出现**；素材与授权的完整清单见仓库根目录 [`NOTICE`](../NOTICE)。

| | 「粥友的酒」 | 「若不是你突然闯进我生活」 | 「说不痛苦那是假的」 | 「粥友的酒 2」 |
|---|---|---|---|---|
| 插件目录 | `plugins/dj-wine/` | `plugins/dj-amiya/` | `plugins/dj-prss/` | `plugins/dj-wine-2/` |
| 槽位 | `hud.right` | `hud.left` | `hud.left2` | `hud.left3` |
| 按钮图标 | `plugins-src/dj-wine/amiya.gif` | `plugins-src/dj-amiya/amiya.gif` | `plugins-src/dj-prss/prss.gif` | `plugins-src/dj-wine-2/amiya.gif`（与第一颗同一张） |
| 音乐 | `zhouyou-de-jiu.mp3` | `ruo-bushi-ni.mp3` | `shuo-bu-tong-ku.mp3` | `zhouyou-de-jiu.mp3`（同一首） |
| `units-gif` | 不发 | `variant: amiya2`（整场一套图集） | `variant: mix`（逐单位随机一套） | `strategy: amiya`（整场用最初的 27 帧图集） |
| `dj-rotate` | ✓ | ✓ | ✓ | ✓ |
| `dj-neon` | ✓ | ✓ | ✓ | ✓ |

音乐与 GIF 都在各自的 `plugins-src/dj-*/` 里，由 `build-page.mjs` 内联进 `ui/index.html`（`plugins/` 里只有成品）。

## 1. 功能概述

- **入口**：战斗屏的四个角槽之一（`hud.right` / `hud.left` / `hud.left2` / `hud.left3`），按钮可拖动；`frame`
  消息把整块 iframe 移到游玩区任意位置，位置按游玩区比例分别记忆（按插件 id 独立，互不影响）。
- **开演**：点一下按钮 → 循环播放内置音乐 → 请求宿主效果 `dj-neon`（夜店 RGB 灯效）与 `dj-rotate`
  （HUD 与棋盘一起旋转 / 压缩）；「若不是你突然闯进我生活」「说不痛苦那是假的」「粥友的酒 2」还会请求
  `units-gif`，把场上单位换成 GIF 替身。
- **停止**：再点一下、关掉面板、离开对局都会把三类效果发 `on: false`；音乐淡出 1 秒。
- **隔离**：四颗按钮的开关、位置、调参互不影响；没有安装 / 没有开启的玩家不加载任何素材，也看不到按钮。
- **降级**：`prefers-reduced-motion: reduce` 下三种效果都不启用；音乐由 Web Audio 播放，不产生资源请求。

## 2. 文件清单

### 2.1 插件源码（素材与模板，可重建）

```
plugins-src/dj-wine/{index.template.html, zhouyou-de-jiu.mp3, amiya.gif, build-page.mjs}
plugins-src/dj-amiya/{index.template.html, ruo-bushi-ni.mp3, amiya.gif, build-page.mjs}
plugins-src/dj-prss/{index.template.html, shuo-bu-tong-ku.mp3, prss.gif, build-page.mjs}
plugins-src/dj-wine-2/{index.template.html, zhouyou-de-jiu.mp3, amiya.gif, build-page.mjs}
```

### 2.2 插件运行目录（可安装的成品）

```
plugins/dj-wine/{plugin.json, ui/index.html, README.md, .studio.json}
plugins/dj-amiya/{plugin.json, ui/index.html, README.md, .studio.json}
plugins/dj-prss/{plugin.json, ui/index.html, README.md, .studio.json}
plugins/dj-wine-2/{plugin.json, ui/index.html, README.md, .studio.json}
```

### 2.3 宿主侧（协议、运行时与样式）

- 协议与校验：`shared/plugins/ui.js`、`shared/plugins/manifest.js`、`shared/plugins/surface.js`、
  `schemas/ui.schema.json`、`schemas/plugin.schema.json`、`docs/PLUGIN-API.md`；
- 运行时接线：`public/js/ui/pluginFrame.js`、`public/js/ui/fieldHost.js`、`public/js/screens/game.js`、
  `public/js/render/app.js`；
- 效果本体：`public/js/render/djRotate.js`、`public/js/render/unitsGif.js`；
- 样式与图集：`public/css/screens/game.css`、`public/css/components.css`、`public/img/dj-units/*.png`；
- 测试：`test/plugins/{ui,dj-authors,surface}.test.js`、`test/ui/dj-*.test.js`、`test/ui/plugin-frame-*.test.js`；
- 致谢与素材说明：`NOTICE`。

## 3. 宿主新增的 `frame` / `effect` 协议与校验

协议版本仍是 `v: 1`。插件 → 宿主新增两种消息（`shared/plugins/ui.js:97` 的 `UI_PLUGIN_MESSAGES`），
宿主 → 插件新增 `frame` 回执（`shared/plugins/ui.js:99`）；两种消息都只接受下面列出的字段，多一个或少一个
形状不对都会得到 `PLUGIN_SHAPE`。

### 3.1 `frame`（移动自己的 iframe）

```js
{ v: 1, t: 'frame', x, y, w?, h? }   // x/y: 游玩区左上角起算的 CSS px；w/h 省略时由宿主补
```

- 校验：`x` / `y` 必须是有限数；`w` / `h` 若给出也必须是有限数（`shared/plugins/ui.js:234`）；
- 夹取：`clampFrame`（`shared/plugins/ui.js:428`）把盒子限制在游玩区内，最小 48×48、最大 640×480，
  超出边界时移动 `x` / `y`；
- 回执：`hostFrame`（`shared/plugins/ui.js:455`）返回夹取后的 `{ x, y, w, h, areaW, areaH }`，
  插件可据此按比例记住位置；运行时处理在 `public/js/ui/pluginFrame.js:577`；
- 权限：`ui.frame`（`shared/plugins/manifest.js:149`），四个插件都在 `plugin.json` 里声明。

### 3.2 `effect`（请求一段可逆的宿主视觉效果）

```js
{ v: 1, t: 'effect', name: 'dj-rotate' | 'units-gif' | 'dj-neon', on: boolean,
  tune?: { turn?, squash?, pulse? },        // 仅 dj-rotate
  variant?: 'amiya2' | 'mix',               // 仅 units-gif
  strategy?: 'amiya' }                      // 仅 units-gif，且不能与 variant 同时出现
```

- 名字白名单：`UI_EFFECTS`（`shared/plugins/ui.js:114`），只认 `dj-rotate` / `units-gif` / `dj-neon`；
  宿主不做通用样式注入，插件不能借 `effect` 写任意 CSS；
- `tune`：`UI_ROTATE_TUNE`（`shared/plugins/ui.js:125`）限定 `turn` ∈ [0.25, 4.5] 秒、
  `squash` ∈ [0, 0.9]、`pulse` ∈ [0.15, 3] 秒；至少给一项，未知键或越界都报 `PLUGIN_SHAPE`；
- `variant`：`UI_UNIT_VARIANTS`（`shared/plugins/ui.js:163`）只认 `amiya2` / `mix`；
- `strategy`：`UI_UNIT_STRATEGIES`（`shared/plugins/ui.js:172`）只认 `amiya`，与 `variant` 互斥；
- 开关：`on: false` 必须完全复原本地状态（类名、变换、替身层、灯效盒子）；重复 `on: true` 幂等；
- 运行时：消息在 `public/js/ui/pluginFrame.js:585` 分发；`dj-rotate` 的 DOM 半在
  `public/css/screens/game.css:1015`，画布半在 `public/js/render/djRotate.js:142`；`units-gif` 在
  `public/js/render/unitsGif.js:187`；`dj-neon` 的样式从 `public/css/screens/game.css:1041` 开始；
- 契约同步：`shared/plugins/surface.js:125` 的三行能力、`test/plugins/surface.stable.json` 与
  `docs/PLUGIN-API.md` 由 `node tools/plugin.mjs surface --write` 重生成。

## 4. 槽位

`UI_SLOT_IDS` 共 7 个（`shared/plugins/manifest.js:215`，清单与 `schemas/ui.schema.json:9` 的枚举一致）：

| 槽位 | 用途 | 默认位置 |
|---|---|---|
| `hud.right` | 战斗屏右下 | 右下角 |
| `hud.left` | 战斗屏左下 | 左下角 |
| `hud.left2` | 战斗屏左下 | 左下角，高一行 |
| `hud.left3` | 战斗屏左下 | 左下角，高两行 |
| `result.tab` | 结算页标签 | 结算页 |
| `stats.tab` | 统计页标签 | 统计页 |
| `room.panel` | 房间面板 | 房间等待页 |

- 四个 `hud.*` 槽都是 `.gm__hud` 的直接子节点（`public/js/screens/game.js:1738`–`1741`），只在战斗屏创建，
  因此按钮天然「只局内」；离开对局时宿主把 iframe 移进隐藏的 `#sp-ui-park`。
- 一个槽只挂一个插件；同一槽有多个插件时宿主显示标签页切换（不是本功能新增）。
- 槽的初始堆叠位置在 `public/css/components.css:1145`–`1147`；插件仍可用 `frame` 移动自己。

## 5. 构建：`plugins-src` → `plugins`

```bash
# 1) 由「模板 + 素材」重新生成插件页面（素材变了必须重跑，否则 --check 会挂）
for p in dj-wine dj-amiya dj-prss dj-wine-2; do node plugins-src/$p/build-page.mjs; done

# 2) 只校验、不写盘（可挂 CI）
for p in dj-wine dj-amiya dj-prss dj-wine-2; do node plugins-src/$p/build-page.mjs --check; done

# 3) 插件自检 / 打包 / 安装到另一台服务器
node tools/plugin.mjs check dj-wine dj-amiya dj-prss dj-wine-2 --strict
node tools/plugin.mjs pack dj-wine                # 打成 zip（plugins/_dist/）
node tools/plugin.mjs install <zip 路径> [--force]
```

- `ui/index.html` 是**生成物，不要手改**：模板里的 `__SONG_B64__` 与 `__GIF_DATA_URI__` 由构建脚本填入
  内联音频与 `data:` 动图；改按钮 / 面板的 HTML、CSS、JS 都改模板。
- 插件文件夹只允许 `.json .html .js .css .png` 与文档，`.mp3` / `.gif` / `.mjs` 都放不进 `plugins/`，
  所以素材与模板留在 `plugins-src/`（不在插件扫描范围内）。
- `.gitignore` 里 `plugins/*` 之后用精确例外放行这四个目录（`!plugins/dj-wine/`、`!plugins/dj-wine/**`，
  其余三个同形）；写宽了会把别人本地的插件也带进来。
- **图集生成方式**（一次性，产物入库）：ffmpeg 抽帧拼成 10×7 图版，每格 112 px（中间 96 px 画面 + 8 px
  透明留白，避免相邻帧渗色），70 帧 / 10 fps：

  ```bash
  # amiya  27 帧 9×3（最初的 Amiya 图集，「粥友的酒 2」用）
  ffmpeg -i Amiya.gif  -vf "crop=960:960:33:24,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=9x3"  -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya.png
  # amiya2 70 帧 10×7（「若不是你突然闯进我生活」用，也是默认策略）
  ffmpeg -i Amiya2.gif -vf "crop=827:827:85:13,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7" -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya2.png
  # prss   70 帧 10×7（「说不痛苦那是假的」用；还要再做内容归一）
  ffmpeg -i Prss.gif   -vf "crop=720:720:117:200,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7" -frames:v 1 -pix_fmt rgba public/img/dj-units/prss.png
  ```

  版式必须与 `unitsGif.js` 的 `GIF_VARIANTS`（`public/js/render/unitsGif.js:80`）一致：`amiya` = 9×3 / 27 帧，
  另两张 = 10×7 / 70 帧；`cell: 112, inset: 8, size: 96, fps: 10`。`prss` 另有「内容归一」：先把 96×96 压到
  84×96，再整体缩到 0.80×，`test/ui/dj-units.test.js` 直接从 PNG 量画面框并卡 0.80 ± 0.03。

## 6. 如何新增一个按钮

1. **复制源码目录**：`plugins-src/dj-wine/` → `plugins-src/dj-<id>/`，改模板里的标题、文案、颜色与
   `post({ t: 'effect', ... })` 请求；替换 mp3 / gif，并改 `build-page.mjs` 里的素材文件名与输出路径。
2. **建运行目录**：`plugins/dj-<id>/plugin.json` 写 `class: "ui"`、`scope: ["personal"]`、
   `permissions: ["ui.frame"]`、`slots: ["hud.left4"]`（若新增槽位）或复用现有槽、`entry.client`；
   `authors` 写插件自己的署名。
3. **选槽**：优先复用四个现成的 `hud.*` 槽；确实需要新槽时，同时改 `UI_SLOT_IDS`
   （`shared/plugins/manifest.js:215`）、`schemas/ui.schema.json:9`、`schemas/plugin.schema.json` 的枚举、
   `public/js/screens/game.js:1738` 附近的槽节点与 `public/css/components.css:1145` 附近的堆叠位置。
4. **接效果**：`dj-rotate` / `dj-neon` 直接发；需要 GIF 替身时发 `variant` 或 `strategy`（二者互斥）；
   需要单独调参时只发 `tune` 的三项，并把数值留在**该插件**的模板里。
5. **生成与自检**：跑一次 `build-page.mjs`，再跑 `build-page.mjs --check` 与
   `node tools/plugin.mjs check dj-<id> --strict`（应为 0 problem / 0 warning）。
6. **补测试与文档**：在 `test/plugins/dj-authors.test.js` 加清单与署名断言；单测至少覆盖
   `effect` 白名单与按钮页面的关键行为；e2e 参照 `test/ui/dj-wine.e2e.test.js`；同步更新本文件的表格、
   `NOTICE` 的素材清单与 `.gitignore` 的例外（两行：目录与 `/**`）。

## 7. 测试

- **单测**（不需要浏览器）：
  - `test/ui/dj-rotate.test.js`：旋转 / 压缩系数与还原、`tune` 的边界；
  - `test/ui/dj-tune.test.js`：调参随插件走、宿主默认值不被改写；
  - `test/ui/dj-units.test.js`：三张图集的版式、内容归一、`mix` 分配；
  - `test/plugins/dj-authors.test.js`：四个插件的清单与署名；
  - `test/plugins/ui.test.js`：`frame` / `effect` 的接受与拒绝、槽位枚举；
  - `test/ui/plugin-frame-*.test.js`：`frame` 揭示、迟到请求与效果状态。
- **端到端**（需要 Chrome / Edge，`SP_E2E=1`）：`test/ui/dj-wine.e2e.test.js`、`dj-amiya`、`dj-prss`、
  `dj-wine-2`、`dj-progress`、`dj-fade`。
- **手工验收**（四颗按钮各开一次）：音乐在放、替身 / 旋转 / 灯效都在；再点一下与关闭面板都复原；
  离开对局 iframe 被 park；控制台 0 error；插件关掉时 `/p/dj-*/…` 一个请求都不该发出。

## 8. 素材来源与致谢

- **GIF 素材来源于网络，出自 B 站作者「疚刃」**：<https://space.bilibili.com/107716290>
  （作品页链接常带 `?spm_id_from=333.788.upinfo.head.click` 追踪参数，出处以此空间页为准）。动图中的角色形象
  版权归鹰角网络 / Yostar，GIF 本身为该 UP 主的二创作品；使用场景为**非商业、免费、同好之间私下联机**。
  四颗按钮一共两份动图（`amiya.gif` 与 `prss.gif`，「粥友的酒 2」复用第一颗的 `amiya.gif`）。
- **音乐由使用者提供、来源网络**：四颗按钮用到三首 mp3（《粥友的酒》被「粥友的酒」与「粥友的酒 2」共用），
  词曲著作权与录音制作者权归各自权利人。
- **实现参考（未复制代码）**：`cyanfish.dj-all`（仓库 `Stronghold-Protocol-CyanModPack`，作者 **CyanF1sh**，
  <https://github.com/CyanF1sh/Stronghold-Protocol-CyanModPack>）。只参考**行为与参数**：旋转 / 压缩的周期与
  比例、`axis` 式横向翻转、逐元素作用面、全场同相位，以及入口交互形态（可拖动圆键、4 px 点击 / 拖动判定、
  位置按比例记忆、非模态浮窗）。该仓库整体为 **GPL-3.0**；本项目**未复制其任何代码或素材**，相同视觉效果为
  独立实现，因此本项目代码不因其受 GPL 传染，许可仍以仓库 `LICENSE` 为准。
- **异议处理**：若上述任一素材的权利人认为收录不妥，请通过仓库 issue 提出；处理方式为**删除对应素材文件、
  保留功能代码**（缺素材时该插件页面不再内联该文件，宿主侧的旋转 / 灯效 / 替身能力与其余素材不受影响）。

## 9. 已知限制

- **真机观感未验证**：当前开发环境没有 Chrome，`test/ui/dj-*.e2e.test.js` 在 Edge (Chromium) 上会红，
  因此这批 e2e **不作为判据**。拖动定位、`frame` 坐标记忆与刷新还原、三种效果的开合与关闭后零残留、
  以及音乐播放，需要在装有 Chrome 的机器上补跑：

  ```bash
  SP_E2E=1 CHROME_PATH=<chrome 可执行文件> node --test test/ui/dj-wine.e2e.test.js
  ```
- **不要用截图判断 iframe 里的 GIF 是否在动**：截不到 iframe 内动画的动帧，两帧会一模一样。要验证「在动」请查
  `getAnimations()` / `__DJ__.isPlaying()` / `AudioContext.state` / 播放位置递增。
- `frame` 只作用于插件自己的 iframe；`effect` 只认三个名字，不能当通用样式通道用。
- 三张 GIF 图集是固定素材（`amiya` / `amiya2` / `prss`），新增替身要同时扩 `GIF_VARIANTS` 与图集。
- 槽位只存在于战斗屏；标题、大厅、房间等待与结算页不渲染这四个槽。

## 10. 文件清单与入口点（`文件:行号`）

| 关注点 | 位置 |
|---|---|
| `frame` 消息形状与校验 | `shared/plugins/ui.js:234` |
| `effect` 消息形状与校验 | `shared/plugins/ui.js:243` |
| 效果名白名单 `UI_EFFECTS` | `shared/plugins/ui.js:114` |
| `dj-rotate` 调参边界 `UI_ROTATE_TUNE` | `shared/plugins/ui.js:125` |
| `units-gif` 变体 / 策略枚举 | `shared/plugins/ui.js:163`、`shared/plugins/ui.js:172` |
| `frame` 夹取 / 回执 | `shared/plugins/ui.js:428`、`shared/plugins/ui.js:455` |
| 槽位清单 `UI_SLOT_IDS` | `shared/plugins/manifest.js:215` |
| `ui.frame` 权限 | `shared/plugins/manifest.js:149` |
| 能力表（surface） | `shared/plugins/surface.js:125` |
| JSON Schema | `schemas/ui.schema.json:74`（frame）、`schemas/ui.schema.json:87`（effect）、`schemas/ui.schema.json:9`（槽位） |
| 宿主运行时分发 | `public/js/ui/pluginFrame.js:577`（frame）、`public/js/ui/pluginFrame.js:585`（effect） |
| 灯效调参 `NEON_TUNING` | `public/js/ui/pluginFrame.js:954` |
| 战斗屏槽节点 | `public/js/screens/game.js:1738`–`1741` |
| 槽位堆叠样式 | `public/css/components.css:1145`–`1147` |
| 旋转 / 压缩（HUD 半） | `public/css/screens/game.css:1015` |
| 旋转 / 压缩（画布半） | `public/js/render/djRotate.js:142`、`public/js/render/djRotate.js:80`（`tune`） |
| GIF 替身 | `public/js/render/unitsGif.js:187`、`public/js/render/unitsGif.js:80`（图集表） |
| 灯效样式 | `public/css/screens/game.css:1041`、`public/css/screens/game.css:1059` |
| 插件清单（示例） | `plugins/dj-wine/plugin.json:26`（权限）、`plugins/dj-wine/plugin.json:29`（槽位） |
| 页面重建 | `plugins-src/dj-wine/build-page.mjs:18`（用法）、`plugins-src/dj-wine/build-page.mjs:50`（`--check`） |
| 素材与致谢 | `NOTICE:9`（GIF）、`NOTICE:24`（音乐）、`NOTICE:36`（实现参考） |
| 单测入口 | `test/ui/dj-rotate.test.js:1`、`test/ui/dj-tune.test.js:1`、`test/ui/dj-units.test.js:1`、`test/plugins/dj-authors.test.js:1` |
| 端到端入口 | `test/ui/dj-wine.e2e.test.js:1`、`test/ui/dj-progress.e2e.test.js:1` |
