# 四个 DJ 按钮：接手说明

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

## 1. 每个按钮

### 1.1 「粥友的酒」`dj-wine` · `hud.right`

- **图标**：一只转动的阿米娅动图（128×128，27 帧 / 10 fps），圆钮；
- **音乐**：《粥友的酒》，30 s 循环；
- **触发效果**：`dj-rotate`（战斗 HUD 各部件 + 棋盘上的棋子 / 敌人 / 装备一起转 + 压缩）、`dj-neon`（夜店 RGB
  灯效）。**不发** `units-gif`——这个按钮不改场上单位；
- **默认位置**：游玩区**左下角**，在四颗角落功能键（交流 / ⚙ / 📖 / ⛶）上方、不压商店条。槽位本身在右下角，
  所以页面首次挂载时自己发一条 `frame` 消息把整块 iframe 挪到左下（`placeDefault`），按钮不会先在右下角一闪；
- **只局内**：`hud.right` 槽由战斗屏创建（`public/js/screens/game.js`），标题 / 大厅 / 房间等待 / 结算页根本不
  渲染这个槽；离开对局时宿主把 iframe 移进隐藏的 `#sp-ui-park`，插件在此之前已自行停播并关掉效果。

### 1.2 「若不是你突然闯进我生活」`dj-amiya` · `hud.left`

- **图标**：阿米娅动图（`amiya.gif`），**不显示名字**（只剩不可见的 `aria-label` / `title`）；
- **音乐**：《若不是你突然闯进我生活》，循环；
- **触发效果**：`units-gif`（`variant: 'amiya2'`——**一套图集铺满全场**）、`dj-rotate`、`dj-neon`；
- **默认位置**：游玩区左下角、比「粥友的酒」**高一行**（两个默认位置都在左下、纵向错开，互不重叠）。位置按
  游玩区比例记忆，拖动移动整块 iframe；
- **只局内**：同上，槽位只存在于战斗屏。

### 1.3 「说不痛苦那是假的」`dj-prss` · `hud.left2`

- **图标**：prss 动图（`prss.gif`），**不显示名字**；
- **音乐**：《说不痛苦那是假的》，循环；
- **触发效果**：`units-gif`（`variant: 'mix'`——**每个单位各自随机**取 `amiya2` 或 `prss` 一套，上场时定、整场
  固定、离场即丢，两种 GIF 在棋盘上交错出现）、`dj-rotate`、`dj-neon`；
- **默认位置**：左下角、比另外两颗**再高一行**（三颗纵向错开）；
- **只局内**：同上。

四个按钮的位置记忆按插件 id **各自独立**，互不影响。

### 1.4 「粥友的酒 2」`dj-wine-2` · `hud.left3`

- **图标**：与「粥友的酒」**同一张**阿米娅动图（同一个 `amiya.gif`），但按钮上**去掉了一切装饰**——没有光环、
  没有名字、没有 ♪ 角标、没有呼吸辉光与旋转光弧，只有一个 46 px 的动图套 1 px 素框（名字留作不可见的
  `aria-label` / `title`）；
- **音乐**：与「粥友的酒」**同一首**《粥友的酒》，循环；
- **触发效果**：`units-gif`（`strategy: 'amiya'`——整场统一用**最初的 27 帧**图集，与 `amiya2` / `prss` 都不是
  同一套画）、`dj-rotate`、`dj-neon`；
- **默认位置**：游玩区左下角，比「粥友的酒」**高三个按钮行**（四颗纵向错开，不压角落四键与商店条）；
- **只局内**：同上。

## 2. 架构

### 2.1 宿主侧的可复用能力（四个插件共用，插件侧没有自己的样式）

- **槽位**：`hud.right` / `hud.left` / `hud.left2` / `hud.left3` 都是战斗屏的**直接子节点**（`.gm__hud` 的兄弟），
  所以「移动插件自己的 iframe」与「让 HUD 转起来」互不干扰；一个槽只挂一个插件。
- **`effect` 消息**：插件只能按**名字**请求一段宿主自己的、可逆的视觉效果；名字之外一律 `PLUGIN_SHAPE`。
  枚举在 `shared/plugins/ui.js`：`UI_EFFECTS = ['dj-rotate', 'units-gif', 'dj-neon']`、
  `UI_UNIT_VARIANTS = ['amiya2', 'mix']`、`UI_UNIT_STRATEGIES = ['amiya']`。只有 `units-gif` 接受 `variant`
  （策略：整场一套 / 逐单位随机）或 `strategy`（固定图集：最初的 27 帧 Amiya），且二者**不能同时出现**；
  另两个效果带这些字段即报错。
- **`dj-rotate`**：DOM 半边给战斗 HUD 加一个 `is-dj-rotate` 类（`public/css/screens/game.css`）；画布半边是
  `public/js/render/djRotate.js`——对每个场上视图的**根容器**做一次变换，开启时逐容器存下原值，关闭时逐值还原
  （回到宿主自己的数值，不是「回到 1」）。参数：旋转周期 67 帧（≈1.1167 s）、压缩 38 帧（≈0.6333 s）、
  60% 高 / 110% 宽、全场同相位。另接受可省的 `tune { turn, squash, pulse }`（秒/圈、压掉多少高度、秒/脉冲），
  **调参按插件独立**：宿主把这三项记在请求者名下、`on: false` 即撤，所以「粥友的酒」自带一套
  （0.971014 s/圈、压掉 0.48、0.460605 s/脉冲），另外三个按钮不传、保持参考默认值。
- **`units-gif`**：`public/js/render/unitsGif.js`——隐藏场上每个单位视图的可绘制部分，在**同一位置**画一个
  `PIXI.AnimatedSprite`（复制站位、朝向、透明度、格子缩放与 `zIndex` 深度）。**只切可见性**：不写贴图、不写
  模拟值、不重建；替身层销毁即复原。图集是宿主自己的三张 PNG（`public/img/dj-units/amiya.png` 27 帧、
  `amiya2.png` 70 帧、`prss.png` 70 帧），**按需加载**（没开这个效果的对局一张都不下载；`amiya2` 会话不会取
  `prss`）。
- **`dj-neon`**：宿主自己的夜店 RGB 灯效，两层纯装饰盒子挂在 **body** 上（不在 `.screen.gm`、也不在 `.gm__hud`
  里，所以 `dj-rotate` 的 `scale` 碰不到它，转到镜像 / 压扁的极端相位时四角照样铺满）。A 层 = 四周内发光 +
  滚动彩虹 + 呼吸 + 淡入；B 层 = 4–8 颗错相位闪动的彩色光斑（每颗自带 `blur`、`mix-blend-mode: screen`，每次
  开播取新随机种子）。**调参点只有一处**：`public/js/ui/pluginFrame.js` 的 `NEON_TUNING`（颗数、色板、峰值
  不透明度、羽化、闪动 / 漂移周期、位置与尺寸范围）；动画本体是 `public/css/screens/game.css` 的 `@keyframes`。
  `on: false` 整盒移除 ⇒ DOM / 计算样式 / `getAnimations()` 回到开启前；重复 `on: true` 不叠层（幂等），
  多个插件同时请求只保留一盒。
- **透明 frame + 自由定位**：`public/js/ui/pluginFrame.js` 处理 `frame`（把插件 iframe 挪到游玩区任意位置，并按
  比例记住）与 `effect` 通道本身。插件页 `html` / `body` 透明并声明 `color-scheme: dark`；宿主 iframe 元素无
  背景无边框、entry `load` 前保持 `opacity: 0`（不出白闪）。
- **`prefers-reduced-motion: reduce`**：三个效果都不启用。

### 2.2 插件侧只有「发消息 + UI」

每个 `plugins/dj-*/ui/index.html` 里没有一行宿主样式、也不碰宿主 DOM，只做三件事：画自己的按钮与面板、按需
`post({ v: 1, t: 'frame', x, y, w, h })` 移动自己、按需 `post({ v: 1, t: 'effect', name, on, variant?, strategy? })`
开关效果。声音走 **Web Audio**（mp3 以 base64 内联、`decodeAudioData` 解码、`AudioBufferSource → GainNode →
Analyser → destination`），因为插件页的 CSP 没有 `media-src`，`<audio>` 加载任何来源都会被拦；按钮动图同样内联成
`data:image/gif;base64,…`（`img-src` 明确允许 `data:`），因为插件文件夹只允许 `.json .html .js .css .png` 与文档。
**停止时音乐淡出 1 秒**（`gain` 从当前值 `linearRampToValueAtTime(0, now + 1)`，`source` 到 `now + 1` 才
`stop`、`onended` 后才断开），界面与进度条仍立刻归零；离开对局先触发淡出、`AudioContext` 延后 1.1 秒再
`close`。再次开播新建 `gain = 1` 的 source，从头播放。

## 3. 重建 / 安装

```bash
# 1) 由「模板 + 素材」重新生成插件页面（素材变了必须重跑，否则 --check 会挂）
for p in dj-wine dj-amiya dj-prss dj-wine-2; do node plugins-src/$p/build-page.mjs; done
node plugins-src/dj-prss/build-page.mjs --check    # 只校验不写盘（可挂 CI）

# 2) 插件自检 / 打包 / 安装到另一台服务器
node tools/plugin.mjs check   dj-wine-2 --strict    # 四个都要 0 problem(s), 0 warning(s)
node tools/plugin.mjs pack    dj-wine-2             # 打成 zip（plugins/_dist/）
node tools/plugin.mjs install <zip 路径> [--force]  # 装进目标服务器的 plugins/
```

- **`ui/index.html` 是生成物，不要手改**：模板 `index.template.html` 里的 `__SONG_B64__` 与 `__GIF_DATA_URI__`
  由 `build-page.mjs` 填成内联音频与 `data:` 动图。改按钮 / 面板的 HTML、CSS、JS 都改模板。
- **图集生成方式**（一次性，产物入库）：ffmpeg 抽帧拼成 10×7 图版，每格 112 px（中间 96 px 画面 + 8 px 透明
  留白，避免相邻帧渗色），70 帧 / 10 fps：

  ```bash
  # amiya  27 帧 9×3（最初的 Amiya 图集，「粥友的酒 2」用）
  ffmpeg -i Amiya.gif  -vf "crop=960:960:33:24,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=9x3"  -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya.png
  # amiya2 70 帧 10×7（「若不是你突然闯进我生活」用，也是默认策略）
  ffmpeg -i Amiya2.gif -vf "crop=827:827:85:13,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7" -frames:v 1 -pix_fmt rgba public/img/dj-units/amiya2.png
  # prss   70 帧 10×7（「说不痛苦那是假的」用；还要再做下面的内容归一）
  ffmpeg -i Prss.gif   -vf "crop=720:720:117:200,scale=96:96:flags=lanczos,format=rgba,pad=112:112:8:8:color=black@0,tile=10x7" -frames:v 1 -pix_fmt rgba public/img/dj-units/prss.png
  ```

  版式必须与 `unitsGif.js` 的 `GIF_VARIANTS` 一致（`amiya` = 9×3 / 27 帧，另两张 = 10×7 / 70 帧；`cell: 112,
  inset: 8, size: 96, fps: 10`），否则替身会一大一小；Pillow 也能做同一件事（逐帧 `Image.open` → `resize` →
  拼到 `Image.new`）。**`prss` 还有一次「内容归一」**：替身对三张图集用同一个缩放系数（`h / size`），所以「谁看
  起来更大」只取决于画面在 96 px 框里占多少。`amiya2` 占 84×96；`prss` 原本占满 96×96（宽 14%），于是
  `prss.png` 先压到 84×96（sx = 84/96 = 0.875，脚底行与高度不动），再整体缩到 **0.80×**（画面约 67×76、脚底仍
  在框底），即「prss 比 amiya2 小 20%」。`test/ui/dj-units.test.js` 直接从 PNG 量画面框并卡 0.80 ± 0.03，
  `test/ui/dj-prss.e2e.test.js` 在真机上量 PIXI 实际画出的替身；重新生成时漏掉这两步就会挂。
- **`.gitignore` 例外的必要性**：`plugins/*` 是忽略的（服务器自己的插件不入库），这四个插件在忽略规则**之后**用
  精确例外放行——`!plugins/dj-wine/` + `!plugins/dj-wine/**`（另三个同形）。少写 `/**` 那行，`plugin.json` 与
  `ui/index.html` 就会漏掉；写宽了（如 `!plugins/dj-*`）会把别人本地的插件也带进来。`plugins-src/dj-*` 在
  `plugins/` 之外、不在插件扫描范围，所以能放 `.mp3` / `.gif` / `.mjs`。

## 4. 测试

- **单测**：`test/ui/dj-units.test.js`（三张图集的版式、内容归一、`mix` 分配）、`test/ui/dj-rotate.test.js`
  （变换系数与还原）、`test/plugins/dj-authors.test.js`（四个插件清单与署名）、`test/plugins/ui.test.js`
  （`effect` 消息白名单、`variant` / `strategy` 校验）；
- **端到端**：`test/ui/dj-wine.e2e.test.js`、`dj-amiya`、`dj-prss`、`dj-wine-2`、`dj-progress`
  （后者覆盖进度条归零、按钮与面板状态、四颗按钮各开一遍）；
- **真机依赖**：这些 e2e 要真实浏览器（Edge / Chromium），由 `test/e2e/client.mjs` 的 `startRealServer` 自己挑一个
  空闲端口起服务（不碰正在跑的服务）：

  ```bash
  SP_E2E=1 CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" \
    node --test test/ui/dj-wine-2.e2e.test.js
  ```

- **已知限制**：**不要用截图判断 iframe 里的 GIF 是否在动**——截不到 iframe 内动画的动帧，两帧会一模一样。要验证
  「在动」请查 `getAnimations()` / `__DJ__.isPlaying()` / `AudioContext.state` / 播放位置递增。
- 手工验收（四颗按钮各开一次）：确认音乐在放、替身 / 旋转 / 灯效都在；再点一下与关闭面板都复原；离开对局 iframe
  被 park；控制台 0 error；插件关掉时 `/p/dj-*/…` 一个请求都不该发出。

## 5. 素材与致谢

- **GIF 素材来源于网络，出自 B 站作者「疚刃」**：<https://space.bilibili.com/107716290>
  （作品页链接常带 `?spm_id_from=333.788.upinfo.head.click` 追踪参数，出处以此空间页为准）。动图中的角色形象
  版权归鹰角网络 / Yostar，GIF 本身为该 UP 主的二创作品；使用场景为**非商业、免费、同好之间私下联机**。
  四颗按钮一共两份动图（`amiya.gif` 与 `prss.gif`，「粥友的酒 2」复用第一颗的 `amiya.gif`）。
- **音乐由使用者提供、来源网络**：四颗按钮用到三首 mp3（《粥友的酒》被「粥友的酒」与「粥友的酒 2」共用），
  词曲著作权与录音制作者权归各自权利人。
- **实现参考（未复制代码）**：`cyanfish.dj-all`（仓库 `Stronghold-Protocol-CyanModPack`，作者 **CyanF1sh**，
  <https://github.com/CyanF1sh/Stronghold-Protocol-CyanModPack>）。只参考**行为与参数**：旋转 / 压缩的周期与
  比例、`axis` 式横向翻转、逐元素作用面、全场同相位，以及入口交互形态（可拖动圆键、4 px 点击 / 拖动判定、位置
  按比例记忆、非模态浮窗）。该仓库整体为 **GPL-3.0**；本项目**未复制其任何代码或素材**，相同视觉效果为独立
  实现，因此本项目代码不因其受 GPL 传染，许可仍以仓库 `LICENSE` 为准。
- **异议处理**：若上述任一素材的权利人认为收录不妥，请通过仓库 issue 提出；处理方式为**删除对应素材文件、
  保留功能代码**（缺素材时该插件页面不再内联该文件，宿主侧的旋转 / 灯效 / 替身能力与其余素材不受影响）。

## 6. 改动落点（便于定位）

| 关注点 | 位置 |
|---|---|
| 四个按钮的页面与交互 | `plugins-src/dj-*/index.template.html` → `plugins/dj-*/ui/index.html` |
| 素材内联 / 重建 | `plugins-src/dj-*/build-page.mjs` |
| 槽位定义 | `public/js/screens/game.js` |
| `frame` / `effect` 通道、`NEON_TUNING` | `public/js/ui/pluginFrame.js` |
| `effect` 名字与校验 | `shared/plugins/ui.js` |
| 旋转 / 压缩（画布侧） | `public/js/render/djRotate.js`、`public/css/screens/game.css` |
| GIF 替身 | `public/js/render/unitsGif.js`、`public/img/dj-units/*.png` |
| 灯效样式 | `public/css/screens/game.css` |
