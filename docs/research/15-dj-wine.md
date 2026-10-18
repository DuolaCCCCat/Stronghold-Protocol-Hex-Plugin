# 15 粥友的酒 (dj-wine)：一个播放音乐的 ui 插件

2026-10-17 · 服务器自用的整活插件 [plugins/dj-wine](../plugins/dj-wine/README.md)（`ui` 类、`hud.right` 槽）。
本文记录四件事：上游参考与其许可、音频素材的探测与转码、"为什么不能用 `<audio>`"以及所选实现路径、
以及"让宿主元素转起来"在当前安全模型下为什么做不到。**不是官方游戏数据的考证**，是本仓插件的一份实现说明。

---

## 1. 上游参考：`cyanfish.dj-all`（只参考行为，未复制代码）

参考仓库：[`CyanF1sh/Stronghold-Protocol-CyanModPack`](https://github.com/CyanF1sh/Stronghold-Protocol-CyanModPack)，
模组目录 `mods/cyanfish.dj-all`（"整活"模组）。取回的是 `main` 的 `6c7079c`（仓库 `VERSION` = 0.2.6）。

**许可结论：整仓 `LICENSE` 是 GPL-3.0（copyleft），不是宽松许可。**
⇒ 按纪律**只参考它的行为，不逐字复制它的任何文件**；本插件的 HTML/CSS/JS 全部自己写。
（本仓自己是 GPL-3.0-or-later，但"上游也是 GPL"并不等于可以顺手搬运：两份作品的作者、边界与出处不同，
搬运会把上游的作者与素材问题一并带进来。故一律重写。）

### 它的形态与规模

| | |
|---|---|
| 形态 | **0.2.6 的 mod**（`mod.json`：`apiVersion: 1`、`gameVersion: "0.2.6"`），跑在**宿主页面同源上下文**里 |
| 规模 | `client/` 约 4100 行：`index.js` 291、`fab.js` 292、`elements.js` 565、`engine-pixi.js` 529、`section.js` 356、`style.js` 181 …；另有 `tools/`（构建 `catalog.html` / `settings-preview.html`）与素材 `assets/amiya-spin.gif`（128×128、27 帧、117 KB） |
| 许可 | 整仓 GPL-3.0；其自带素材（同人二创阿米娅表情包）**明确声明不适用**该 GPL，见它的 `SOURCE.md` |

### 它的"DJ"到底是什么

**`cyanfish.dj-all` 里没有任何音频**：全仓 0 个 `.mp3/.ogg/.m4a`，`client/` 里也没有 `Audio` / `AudioContext` /
`decodeAudioData` / `.play()` 调用（对 `Media` 的命中全部是 SVG 图标路径与无关的 `toggle`）。它的 "DJ" 是
**把战斗界面里所有可见元素按目录层级"转起来"**：逐元素配 `transform` 旋转与压缩，默认全关，
`settings-preview.html` / `catalog.html` 是作者用的预览页。真正做音频的是同仓的另一个模组
`cyanfish.music-overlay`（它替换宿主 `/js/audio.js` 单例的私有漏斗 `_buffer(url)`），与此处讨论的功能无关。

### 实际参考了它的什么

只有**局内入口的交互形态**（行为层面）：

| 参考行为 | 它的位置 | 本仓的实现 |
|---|---|---|
| 战斗里一颗可拖动的圆形图标键，4px 阈值区分"点击"与"拖动" | `client/fab.js:105-160`（`DRAG_SLOP = 4`，`pointerdown/move/up`） | `index.template.html` 的 `bindDrag()`（同阈值、同判定，代码自己写） |
| 位置存**视口宽高的比例**，换分辨率不跑出屏幕 | `client/fab.js:76-85`、`:150` | `placeRatio()` / `pinTo()`，经宿主 `storage` 记住 |
| 点开的**半透明非模态浮窗**，标题栏可拖、✕ 关闭 | `client/fab.js:191-228` | `.dj-panel`（非模态、半透明、标题栏可拖、✕ 收起） |
| 总开关状态一眼可辨（它用标题栏的存活读数） | `client/fab.js:175-188` | 按钮的 `.is-on`（金环旋转光弧 + 角标 + 状态行） |

（它的 `engine-pixi.js` 那套"逐个 PIXI 对象按字段分类套 transform、再逐值还原"的**写法**没有被照搬 —— 那需要先
判断宿主每帧写不写 `body.scale` / `plate.scale` / `pivot` 等字段；本仓在**视图自己的根容器**上做一次变换，等价且可精确
还原，理由见 §4 末。行为与参数照参考（67/38 帧、110% 宽、同相）；**本插件的局部调参（有意偏离）**：旋转 ×1.15
（1.116667 s → 0.971014 s/圈）、压缩 +20%（最低 52%，参考是 60%）、脉冲 ×1.375（.633333 s → .460605 s/脉冲）。
这三项**只写在本插件的模板里**（`TUNE` → `effect` 消息的 `tune`），宿主的两半保持参考默认值，所以另外三个按钮
不受影响，见 §4。）

---

## 2. 音频素材：m4s 探测与转码

输入素材（网络下载的分片音频）：`粥友的酒.m4s`。

### 探测结果

用 `ffprobe`（见下）与直接读文件头（ISO-BMFF box 解析）：

| 项 | 值 |
|---|---|
| 容器 | `ftyp` major brand **`iso5`**，兼容 `iso5/iso6/mp41/dash` ⇒ **fMP4（分片 MP4）** |
| 结构 | `moov`（初始化段，805 B）+ `sidx` + **6 组 `moof`/`mdat`** ⇒ 这是 DASH/离线缓存的**音轨分片**，不是完整的 MP4 音轨 |
| 编码 | **AAC-LC**（`stsd` 的 `mp4a`，`hdlr` = `soun`），44.1 kHz、**2 声道（stereo）**、约 211 kbps |
| 时长 | **30.047 s**（`mvhd` timescale 1000 / duration 30047；`mdhd` duration 为 0，时长在分片里） |
| 字节 | 781 542 B（约 0.75 MB） |

### 浏览器能否直接播这个 `.m4s`？

**不能。** 两条独立的原因：

1. **扩展名/MIME**：`.m4s` 不是浏览器认识的媒体类型，直接给 `<audio src>` 通常连类型嗅探都过不去；
2. **更要紧的是结构**：它是**分片** MP4（`moof`）。`<audio>` 是走浏览器的媒体解复用器，**只吃"整段索引
   （`moov` 里有 `stbl` 采样表）+ 媒体数据"**这种普通 MP4/M4A；分片 MP4 是给 **MSE（`MediaSource`）** 用的，
   必须由 JS 喂 `SourceBuffer` 才能播。`moov` 里 `stsz/stco/stsc` 都在、`mdhd.duration = 0`，正是分片的特征。

⇒ 必须转码。**即使不转码，ui 插件的 CSP 也放不了 `<audio>`**（见 §3），所以转码只是为了拿到
一个能交给 Web Audio 解码的字节流。

### 转码命令与产物

本机**没有 ffmpeg**（`Get-Command ffmpeg` 无命中，Python 侧也没有 `av`/`imageio_ffmpeg`）。
解决办法：取一份 **gyan.dev 的 Windows 静态构建**（`ffmpeg-release-essentials.zip`，解压后 `bin/ffmpeg.exe`、
`ffprobe.exe`，只放在本机的临时目录里，不进仓）。

```bash
# 探测
ffprobe -v error -show_format -show_streams "粥友的酒.m4s"
# 转码：AAC → MP3（libmp3lame），128 kbps / 44.1 kHz / 立体声
ffmpeg -y -v warning -i "粥友的酒.m4s" -vn -c:a libmp3lame -b:a 128k -ar 44100 -ac 2 zhouyou-de-jiu.mp3
```

| 码率 | 体积 |
|---|---|
| 原 AAC（m4s） | 781 542 B（0.75 MB，≈211 kbps） |
| MP3 160 kbps | 602 586 B（588.5 KB） |
| **MP3 128 kbps（采用）** | **482 109 B（470.8 KB）** |
| MP3 96 kbps | 361 633 B（353.2 KB） |

选 **128 kbps**：30 s 的曲子 160 kbps 与 128 kbps 听感差别很小，而 128 kbps 省 120 KB；
96 kbps 已经开始伤高频。**选 MP3 而不是 m4a/AAC**：MP3 的解码器在所有目标浏览器里都是内置且最稳的，
而 AAC 在部分 Linux 版 Chromium 上依赖系统解码器。

### 按钮动图

原始动图 `Amiya.gif`：**1000×1000，1 394 707 B（1.33 MB），27 帧，10 fps，2.70 s** —— 对一颗
46 px 的按钮来说太重（整幅解码约 100 MB 级）。用同一份 ffmpeg 缩放并重编码调色板：

```bash
ffmpeg -y -i Amiya.gif \
  -vf "scale=128:128:flags=lanczos,split[s0][s1];\
[s0]palettegen=max_colors=96:stats_mode=diff[p];\
[s1][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
  -loop 0 amiya.gif
```

| | 尺寸 | 体积 | 帧数 / 帧率 |
|---|---|---|---|
| 原图 | 1000×1000 | 1 394 707 B（1.33 MB） | 27 / 10 fps |
| **采用 128×128** | 128×128 | **112 955 B（110.3 KB）** | **27 / 10 fps（未丢帧）** |
| （对照）96×96 | 96×96 | 77 056 B（75.2 KB） | 27 / 10 fps |

**帧数、帧率、时长、循环方式全部保留**（只缩放 + 调色板重编码，没有改动画面内容），所以"动态感"没有损失；
128×128 显示在 46 px 的圆里，在高 DPI 屏上也够清楚。取 128 而非 96：75 KB 与 110 KB 的差别不值得牺牲清晰度。

### 素材版权

音频与 GIF **均来自网络**并已收录入库，来源、授权与异议处理见仓库根目录 [`NOTICE`](../../NOTICE)。GIF 里是
《明日方舟》的**阿米娅**：角色形象版权归**鹰角网络 / Yostar**，这份表情包本身是**同人二创**（与参考对象
`cyanfish.dj-all` 的 `assets/amiya-spin.gif` 同源同题材）。本插件的使用场景是**完全免费、非商业、同好之间私下
联机**。**本仓一个字节的官方游戏美术都没有**：GIF 是外部二创素材，音频由使用者提供。

---

## 3. 为什么不能用 `<audio>`：宿主 CSP 实测

宿主把 ui 插件的页面放在 `<iframe sandbox="allow-scripts">` 里（`public/js/ui/pluginFrame.js:196`），
并且 `/p/<id>/<hash8>/<entry>` 的响应头带 `UI_FRAME_CSP`（`shared/plugins/ui.js:45`）：

```
default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:; connect-src 'none'; sandbox allow-scripts;
frame-ancestors 'self'; base-uri 'none'; form-action 'none'
```

**关键：这里没有 `media-src`**，于是它回落到 `default-src 'none'` ⇒ **`<audio>`/`<video>` 无法加载任何来源**。
真实 Edge（Chromium）实测三种来源，全部失败：

| 来源 | 结果 | 控制台 |
|---|---|---|
| 同源路径 `/p/<id>/…/song.mp3` | ✗ `MediaError.code = 4` | `Refused to load media from '…/song.mp3' because it violates … "default-src 'none'"` |
| `blob:` URL（JS 里 `createObjectURL`） | ✗ `code = 4` | 同上（`blob:null/…`） |
| `data:audio/mpeg;base64,…` | ✗ `code = 4` | 同上（`data:audio/mpeg;base64,…`） |

**`<img>` 不受影响**：`img-src` 明确写了 `'self' … data: blob:`，实测同源路径与 `data:image/gif;base64,…` 都
能正常解码（`naturalWidth = 128`）。

### 所选路径：Web Audio + 内联 base64

把 mp3 以 base64 常量内联进插件自己的 HTML，**在 JS 里解码**，再经 Web Audio 播放：

```
B64 常量 ──atob──▶ Uint8Array ──▶ ArrayBuffer ──decodeAudioData──▶ AudioBuffer
                                                            │
   AudioBufferSourceNode(loop) ──▶ AnalyserNode ──▶ destination（扬声器）
                                        └──▶ 频谱/能量（驱动可视化）
```

这条路**不产生任何资源加载**（没有网络请求、没有 `<audio>` 元素、没有 `blob:`/`data:` URL 交给 CSP 判定），
所以 `default-src 'none'` 管不到它。真实 Edge 实测通过：

- `AudioContext.state === "running"`（采样率 48 000）；
- `decodeAudioData` 成功：`duration = 30.0466 s`、2 声道、`length = 1 442 237`；
- 播放时钟递增：`ctx.currentTime` 0.061 → 2.491；
- **Analyser 取到真实信号**：频谱 `getByteFrequencyData` 能量和 ≈ 5892，时域峰值 ≈ 0.12 ⇒ 确实有声音在走，
  不是"启动了但没声"。

### 另一条硬约束：ui 插件文件夹不收 `.mp3` / `.gif`

`node tools/plugin.mjs check dj-wine --strict` 一开始报了 3 个 `PLUGIN_FILE_TYPE`：
ui 插件只允许 `.json .html .js .css .png` + 文档（`.md/.txt`）——`.mp3`、`.gif`、`.mjs` 都**放不进**插件文件夹。
所以素材与模板放在**插件文件夹之外**的 [`plugins-src/dj-wine/`](../plugins-src/dj-wine/)（`plugins/` 之外，
不会被插件扫描读到），由
[`build-page.mjs`](../plugins-src/dj-wine/build-page.mjs) 把**音频与动图都内联**进 `ui/index.html`：

- mp3 → `__SONG_B64__`（base64 常量，784.6 KB）
- GIF → `__GIF_DATA_URI__`（`data:image/gif;base64,…`，147.1 KB）

**最终 `ui/index.html` ≈ 955 KB**（模板 23.7 KB + 音频 784.6 KB + 动图 147.1 KB）。
插件单包上限是 200 MB / 5000 文件，957 KB 毫无压力；一次请求拿到整个页面，反而比外部资源更省往返。
重新生成 / 校验：

```bash
node plugins-src/dj-wine/build-page.mjs           # 重新生成 ui/index.html
node plugins-src/dj-wine/build-page.mjs --check   # 与素材/模板不一致就报错（可挂 CI）
```

---

## 4. "让宿主的战斗界面元素转起来"：受控接缝（2026-10-17 本地补丁）

上游 `cyanfish.dj-all` 能把整个战斗界面转起来，是因为**它是 0.2.6 的 mod，跑在宿主页面的同源上下文里**，
可以直接改 `document`。ui 插件拿不到这个上下文：

1. `pluginFrame.js:196` 是 `sandbox="allow-scripts"`，**没有 `allow-same-origin`**，且 `UI_FRAME_CSP` 里也带
   `sandbox allow-scripts` ⇒ 插件文档的源（origin）是 `"null"`，**`parent.document` 一律不可访问**
   （这正是宿主的设计意图：插件读不到站点 storage 与凭据，也读不到别人的对局数据）。
2. 最初全仓**没有**任何"插件驱动的宿主视觉效果"接缝，插件的 postMessage 类型也被白名单固定为
   `ready / slot / resize / storage / notice / stats / metrics`。

**本补丁加了三条受控接缝**（`shared/plugins/ui.js`，`docs/PLUGINS.md` §14），都不交出宿主文档：

- `frame { x, y, w?, h? }`：移动**插件自己的那块 iframe**（不是宿主元素），宿主夹进游玩区域后回
  `{ x, y, w, h, areaW, areaH }`。frame 仍然是小盒子，不用"全屏 iframe + pointer-events:none"（那会让插件自己
  也收不到点击）。
- `effect { name, on, variant?, strategy?, tune? }`：宿主只把**已知名字**映射成一段可逆的宿主视觉，`on:false` 立即复原，
  `prefers-reduced-motion` 下不启用。目前三个名字都在 `shared/plugins/ui.js` 的 `UI_EFFECTS` 里：
  `dj-rotate`（战斗 HUD 的各个部件旋转 + 轻微压缩：加/去一个 class，`transform` 回到 `none`；**同时**棋盘上的
  **棋子 / 敌人 / 装备**按同一时钟、同一参数、同相位旋转 + 压缩 —— 宿主对每个视图的**根容器**做一次
  `scale` 变换，开启时逐容器存下自己的原值、`on:false` 逐值还原，见 `public/js/render/djRotate.js`；**本插件用的就是它**。
  **本地调参（有意偏离参考的出厂值）走这条消息的 `tune`**：三个受控、有范围的可选数
  （`turn` 秒/圈 · `squash` 压掉多少高度 · `pulse` 秒/脉冲，`UI_ROTATE_TUNE`，越界 / 未知键 / 用在别的效果名上都是
  `PLUGIN_SHAPE`）。宿主把它们记在**请求者插件**名下：HUD 侧写成 `.gm__hud` 上的三个 CSS 变量
  （`--gm-dj-turn-dur` / `--gm-dj-depth` / `--gm-dj-pulse-dur`），棋盘侧经 `setDjRotate(on, tune)` 传进
  `public/js/render/djRotate.js`。于是：**本插件的模板**写 `TUNE = { turn: 0.971014, squash: 0.48, pulse: 0.460605 }`
  （×1.15 快、压掉 48% ⇒ 最低 52%、脉冲 ×1.375），**其余三个按钮不传 `tune`** ⇒ 宿主两半的参考默认值
  （1.116667 s/圈、压掉 40% ⇒ 最低 60%、.633333 s/脉冲）；`public/css/screens/game.css` 与
  `public/js/render/djRotate.js` 里的常量也回到参考值（改那两处＝改所有按钮，是这条调参要避免的事）。
  只有一个 HUD / 一块棋盘 ⇒ 同时只能有一套数在生效：**最近一次请求**的那套（按下哪个按钮，就是哪个按钮的样子）；
  它放手时把视觉交给上一个仍在请求的插件自己的数（都没有 `tune` 就是参考默认），不会关掉，也不会把谁的数写进别人的记录。）、
  `units-gif`（把**场上所有单位**换成 GIF 的动画替身，只切可见性、销毁替身层即复原；受控参数 `variant` 是**策略**：
  `amiya2` 一套图集铺满全场，`mix` 让**每个单位**各自随机用 amiya2 / prss 中的一套（上场时定、整场固定、离场即丢，
  两种 GIF 交错出现），见 `public/js/render/unitsGif.js`；由另外两个 Amiya / prss 插件开播时触发，本插件不发）与
  `dj-neon`（宿主自己的**夜店 RGB 灯效**：`position: fixed` 的一层纯装饰盒子挂在 **body** 上（不在 `.screen.gm`
  里、也不在 `.gm__hud` 里 —— 所以 `dj-rotate` 的 `scale` 碰不到它，转到镜像 / 压扁的极端相位时四角照样铺满）、
  `pointer-events: none`、z-index 在战斗屏之上/横幅之下；A 层是**四周内发光 + 滚动彩虹 + 呼吸 + 0.9 s 淡入**
  （`conic-gradient` 旋转 + 径向 mask 让中心透明），B 层是**4–8 颗错相位闪动的彩色光斑**：每颗一条很长的
  radial-gradient（半径 90% 才完全透明）+ **每颗自带 `filter: blur(40–72 px)`**（不对全屏层做 blur）、
  `mix-blend-mode: screen`、峰值不透明度 0.28–0.42，并且**每次开播取新随机种子**（位置 / 尺寸 / 色相 / 闪动周期 /
  延迟 / 漂移方向与距离 / 模糊半径都随机，闪动时还缓慢 `translate` 漂移）；全部是宿主 `game.css` 里的
  `@keyframes`，没有逐帧 JS、不注入页面样式；`on:false` 整盒移除，DOM / 计算样式 / `getAnimations()` 逐字段回到
  开启前，重复 `on:true` 不叠层 —— **本插件开播时与 dj-rotate 一起发**）。
  这是一条**宿主能力**：任何 `ui` 插件按名字请求即可，插件侧**零代码 / 零样式**（本插件只多一行 `neon(on)` 发消息），
  色板 / 颗数 / 强度 / 羽化 / 漂移都只存在于宿主 `pluginFrame.js` 的 `NEON_TUNING` 与 `game.css` 里，要调只改一处。
  **不是通用样式注入**：没有"自定义样式"这类通道，名字之外一律 `PLUGIN_SHAPE`。
- 透明 frame：插件页 `html/body` 透明并声明 `color-scheme: dark`（只写 transparent 时 Chromium 仍画白底，实测），
  宿主 iframe 元素 `background: transparent; border: 0`，且在其 entry `load` 前保持 `opacity: 0`（不出白闪）。

仍然明确否决的只有一条：**(a) 给 `UI_FRAME_CSP` / `sandbox` 加 `allow-same-origin`** —— 那等于把游戏源交给插件，
安全模型倒退，永远不做。**(b) 的通用版本（任意 class / 任意 CSS）仍然不做**：它需要新的权限、审查与测试面，
属于上游 PR 级的新特性；这里只开了上面这组有名字、有范围、可逆的接缝。

插件自身框架内的整活（阿米娅 GIF 的旋转光弧、金环呼吸辉光、面板里唱片的匀速自转、Analyser 真数据驱动的频谱柱、
进度条）保持原样，全部只挂在 `.is-on` 上，`.is-on` 一摘动画即停，`prefers-reduced-motion` 下全部关闭。
`test/ui/dj-wine.e2e.test.js` 用 `getAnimations()` 断言"播放时有动画、停止后 0 个动画"。

---

## 5. 插件用法

1. 服主把 `plugins/dj-wine/` 放进服务器的 `plugins/`（本仓这台机器上已经在）；重启服务后
   `GET /plugins/index.json` 里会出现 `dj-wine`（`class: "ui"`、`slots: ["hud.right"]`）。
2. 每个玩家在**自己浏览器**里开：设置 →「界面插件」→ 打开「粥友的酒」。这是个 `personal` 开关，
   **不上线**，也不进房间的内容组合（不会把房间变成"插件房间"，因此不影响作战统计）。
3. 进对局后，战斗屏右下角出现「粥友的酒」按钮（`hud.right` 槽，缺省位置在左下角功能键正上方、
   不压商店条）。**点一下**：DJ 开演 + 循环放歌 + 面板展开 + 宿主的战斗 HUD 转起来，**棋盘上的棋子 / 敌人 /
   装备也一起转 + 压缩**，同时点亮**夜店 RGB 灯效**（四周内发光 + 滚动彩虹 + 画面上错相位闪动的彩色光斑）；
   **再点一下**：停止、收起、界面 / 场上单位 / 灯效立即复原。按钮可拖到游玩区域的任意位置
   （拖动的是整块 iframe，不是框内元素），位置按游玩区域比例记住，刷新 / 重进对局后仍在；面板标题栏同样可拖。
   关面板也复原界面（音乐可继续）。
4. **只有局内出现**：`hud.right` 槽本身只存在于战斗屏（`public/js/screens/game.js`），
   所以标题 / 大厅 / 房间等待 / 结算页上**根本不渲染**这个槽，插件也就无从出现或被点到；
   离开对局时宿主把 iframe 移进隐藏的 `#sp-ui-park`，插件在此之前已自行停播并关掉效果。
5. **不开这个插件时一切与现在逐字节一致**：宿主不会创建 iframe、不会请求 `/p/dj-wine/…`、不会创建灯效节点
   （`dj-neon` 的那层盒子只在插件的 `effect` 消息到达时才建，且建在宿主自己的 body 上），
   也不会往主文档注入任何 CSS（插件的一切都在那个不透明源的 iframe 里；灯效样式是宿主 `game.css` 里固定的规则）。

## 6. 验证（本机实测）

```bash
node tools/plugin.mjs check dj-wine --strict          # 0 problem(s), 0 warning(s)
node plugins-src/dj-wine/build-page.mjs --check        # ui/index.html 是最新的
SP_E2E=1 CHROME_PATH=<chromium> node --test test/ui/dj-wine.e2e.test.js
node tools/golden.mjs                                  # 零场景移动（本插件不碰 sim）
node tools/ci.mjs --only lint,typecheck,imports
```

真机（Edge / Chromium）取证覆盖：按钮挂载在 `hud.right`；GIF 解出真实 `naturalWidth`（128）且布局有效；
点击后 `__DJ__.isPlaying()` 为真、`AudioContext` 为 `running`、`decodeAudioData` 得到 30.05 s、
Analyser 能量 > 0、播放位置递增；面板打开、唱片动画在跑；再点一下 ⇒ 暂停、面板收起、动画归零；
离开对局 ⇒ 槽随战斗屏消失、iframe 被 park 且不可见；**0 console error / pageerror**；
插件关闭时**一次 `/p/dj-wine/` 请求都没有**。本补丁追加：frame 空白区透明（透出下面商店，无白闪）、
按钮拖到四个角/中间都能停住且拖动经过的区域宿主仍可点、刷新后位置保留；开演时战斗 HUD
`transform` 非 `none`（两帧截图不同）、停止 / 关面板 / 离开后回到 `none`，`prefers-reduced-motion` 下不转。
画布侧（`public/js/render/djRotate.js`）追加：开播后场上每个单位 / 装备视图的根容器 `scale` 都被乘上同一对系数
（两帧不同、连续 ≥10 s 不停），停止 / 关面板后每个容器回到开启前**逐字段相等**的数值（不是"回到 1"）；
旋转 / 压缩期间点棋子仍能选中、真拖卡部署仍成功；`prefers-reduced-motion` 下不施加；未启用插件时场上 0 变化。

**已知限制（本机实测）**：`test/ui/dj-amiya.e2e.test.js` 在真实 Edge 上会先卡在它自己更早的一条既有断言——
「按钮 GIF 两帧截图不同」（本机截图取不到 iframe 里 GIF 的动帧，`plugins-src/dj-amiya/amiya.gif` 本身是 70 帧、
10 fps，与本次改动无关，断言在点击之前、任何 effect 之前）。因此该文件里新增的 `dj-rotate` 断言本轮没有跑到；
同一条宿主路径（`effect: dj-rotate` → `pluginFrame.js` → `render/djRotate.js`）已由
`test/ui/dj-wine.e2e.test.js` 在真机跑通（下面那组断言就是它）。
