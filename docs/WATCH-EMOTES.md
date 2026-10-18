# 观战表情：接手说明

观战时向被观战者的屏幕发「弹幕」：表情从对方战场上飘落，同时在自己的屏幕上显示连击数；同一个房间的其他玩家
也能在队伍面板旁看到一个紧凑的「名字 ×n」提示。功能只涉及客户端和一条 `g.emote` 协议扩展，**不写入房间状态、
内容哈希或战斗数据**，因此不影响 `cs` 与 golden。

## 1. 功能概述

- **入口**：观看另一名玩家的阵地 / 战场时，战斗屏左下角出现一颗小按钮（`WatchEmoteButton`，只在
  `watchingOther && watchedPid && !spectator` 时渲染，`public/js/screens/game.js:1753`）。没有生命值门槛，
  只有连接离线时禁用。
- **按钮**：可拖动的圆形「表情槽」——未选表情时是空槽，箭头键打开与「交流」相同的表情面板（选择模式），
  选中的表情会显示在按钮上；`?` 表示随机，每次点击都从全部可发送表情里抽一个。
- **开关**：小齿轮里有两个持久化开关——「显示连击」（默认开）与「在自己屏幕显示弹幕」（默认开）。
- **发送**：点击按钮 → 200 ms 内合并为一条 `g.emote { id, watch, count }`（随机模式下一个窗口可能产生
  多个 id，每个 id 一条消息，最多 6 条）。
- **效果**：被观战者的屏幕、以及正在观战该目标的其他玩家屏幕会飘落 `count` 个表情；发送者自己的屏幕显示
  「连击 × N」并可选择是否也看到飘落；其他玩家只看到队伍面板旁的紧凑提示。

## 2. 数据流

```
点击按钮
  → WatchEmoteButton.click（public/js/ui/emotes.js:620）
      固定表情：picked；随机：pickRandomEmote()（emotes.js:61）
  → createEmotePulse().click(id)（emotes.js:113）
      200 ms 窗口内按 id 计数（WATCH_EMOTE_PULSE_MS，emotes.js:44）
  → 窗口结束 flush → onSend(id, count)
  → game.js:1754 → actions.watchEmote(id, watchedPid, count)（public/js/ui/gameActions.js:98）
  → g.emote { id, watch, count } → shared/protocol.js:584 校验
  → 服务器 intents.emote()（server/match/match/intents.js:72）
      校验 id / 目标 / 频率 / 计数 → broadcast m.emote { playerId, id, watch, count }（intents.js:92）
  → 客户端 store.emotes 追加（public/js/store.js:92）
  → WatchEmoteRain 读取事件（public/js/screens/game.js:1744）
      watchRainSide 决定这一屏要不要飘落（public/js/ui/watchEmote.js:102）
      rainBurst 把 count 展开成 count 个独立粒子（watchEmote.js:118）
      onReceive → pushWatchNotice（game.js:1629）→ TeamPanel 的 EmoteBubble（teamPanel.js:201）
```

- **协议形状**：`g.emote` 仍是原来的消息，只多了可选的 `watch`（被观战者 playerId）与 `count`（本次窗口的
  点击数）；`m.emote` 原样转发这两个字段，线上不传图片，只传表情 id 与次数。
- **服务端校验**（`server/match/match/intents.js:72`）：
  - `id` 必须在 `SENDABLE_EMOTES`（官方 36 + 自定义 7）里；
  - `watch` 必须是一个存在且不是发送者的玩家，否则 `BAD_TARGET`；
  - `count` ∈ [1, 1000]（`shared/constants.js:337`，渲染安全上限，不是每条的丢弃阈值）；
  - 观战脉冲之间至少 `WATCH_EMOTE_RATE_MS` = 150 ms（`shared/constants.js:338`）；随机模式一个 200 ms 窗口
    产生的多条消息允许在 `WATCH_EMOTE_BURST_MS` = 80 ms 内一起到达，最多 6 条、同一 id 不重复
    （`shared/constants.js:342`–`344`）；
  - 普通「交流」表情仍是 1 秒冷却（`EMOTE_COOLDOWN_MS`），不受上面的脉冲规则影响。
- **展开**：接收端按 `count` 生成**恰好 count 个**粒子（点 5 次掉 5 个，点 85 次掉 85 个），每个粒子的轨道、
  横向位置、延迟、时长、摆动、旋转与大小独立随机；合并只减少消息数，不减少掉落数。

## 3. 可见性规则

设 **A** 是发送者、**B** 是被观战者、**C** 是正在观战 B 的另一名玩家、**D** 是其余玩家：

| 屏幕 | 飘落 | 连击 × N | 紧凑提示「B ×n」 |
|---|---|---|---|
| B（被观战者本人） | 总是 | 无 | 有 |
| C（正在看 B 的战场） | 有（实时；切到 B 时补放） | 无 | 有 |
| A（发送者） | 仅「在自己屏幕显示弹幕」打开时 | 有（「显示连击」打开时） | 有 |
| D（没在看 B） | 无 | 无 | 有 |

- 判定函数：`watchEmoteSide`（`public/js/ui/watchEmote.js:88`）回答「这条事件属于哪一屏」；
  `watchRainSide`（`watchEmote.js:102`）回答「这一屏要不要真的掉」——B 总是掉；C 在看 B 时掉；
  A 只在开关打开时掉；其他屏幕不调 `rainBurst`。
- 紧凑提示对所有收到事件的客户端都显示：走队伍面板同一个 `EmoteBubble` 通道（`text` + `n` 两个可选属性，
  `public/js/ui/emotes.js:290`），锚在发送者头像旁，显示被观战者名字与累计次数；2 秒后淡出。
- 普通「交流」表情的泡泡不受影响；`activeBubbles` 会跳过带 `watch` 的事件，避免观战表情被画成图片泡泡
  （`public/js/ui/gameLogic/watch.js:111`）。
- 自己的屏幕在看别人时不会给「第三条」飘落：A 看 B 时点按钮，A 的屏幕只有连击 / 提示（除非打开
  「在自己屏幕显示弹幕」），飘落发生在 B（以及看 B 的 C）的屏幕上。

## 4. 2 秒缓存与补放

- 每个客户端在内存里保留一份 **2 秒**的观战事件缓存：`replayCache`（`public/js/ui/watchEmote.js:46`），
  键是被观战者 playerId，值是最近 2 秒的事件（`WATCH_EMOTE_REPLAY_MS`，`watchEmote.js:41`）。
- 收到事件时 `rememberWatchEvent`（`watchEmote.js:49`）写入缓存；`takeWatchReplay`（`watchEmote.js:58`）
  取出并丢弃过期项。
- 当本客户端**切换**到观看某个目标时：先清掉上一块战场的粒子，再从缓存补放该目标最近 2 秒的事件
  （`watchEmote.js:198`–`217`）。补放按原始 `count` 重新随机位置，并再次触发同一个紧凑提示
  （`onReplay`，`public/js/screens/game.js:1746`–`1751`，替换而不是叠加计数）。
- 缓存只在内存里：刷新页面 / 重连会清空；超过 2 秒的旧事件不再补放；切走再切回 B（2 秒内）会再次补放。

## 5. 选择持久化键

持久化走 `localStorage` 的 `sp.pref.<key>`（`public/js/store.js` 的 `loadPref` / `savePref` / `removePref`），
键在 `public/js/ui/emotes.js:50`–`59` 定义：

| 键（完整名） | 内容 | 说明 |
|---|---|---|
| `sp.pref.watchEmoteSelection` | 表情 id 或 `'?'` | 观察按钮当前选择；跨局 / 刷新记忆；失效的 id 会被移除并回退为空槽 |
| `sp.pref.watchEmotePos` | `{ x, y }` | 按钮位置（相对战斗屏，全局一份；窗口缩放时重新夹取） |
| `sp.pref.watchEmoteCombo` | `true` / `false` | 「显示连击」开关，默认开 |
| `sp.pref.watchEmoteOwnRain` | `true` / `false` | 「在自己屏幕显示弹幕」开关，默认开 |

- `removePref`（`public/js/store.js:199`）用于清理失效的选择；隐私模式下写失败会被静默忽略。
- 按钮位置在窗口缩放时按 8 px 边距重新夹回屏内（`clampWatchPos`，`public/js/ui/emotes.js:96`）。

## 6. 素材与表情包清单

- 两页自定义表情：`CUSTOM_EMOTE_THEMES`（`shared/constants.js:289`）——
  `emoticon_custom_amiya`（3 个：阿米娅·坐下 / 加油、普瑞赛斯·得意）与
  `emoticon_custom_qq`（4 个：猫猫·震惊 / 拒绝、摸摸头、星星眼）。
- 轮盘页序：`EMOTE_WHEEL_THEMES`（`shared/constants.js:305`）= 官方 6 页 + 自定义 2 页。
- 可发送集合：`SENDABLE_EMOTES`（`shared/constants.js:307`）= 官方 36 + 自定义 7；`g.emote` 的 `id`
  校验用它（`shared/protocol.js:584`）。
- 图片：`public/img/emotes/*.webp`，120×120、内容缩放进 112×112 透明画布；目录说明见
  `public/img/emotes/README.md`。

## 7. 素材来源与致谢

- **来源：网络表情包。** 阿米娅三张动图出自 B 站作者「疚刃」
  <https://space.bilibili.com/107716290>；QQ 表情包几张的原始出处已不可考。
- 角色形象版权归鹰角网络 / Yostar，表情包本身归各自作者；仅用于**非商业、免费的同好联机**。
- 若权利人认为收录不妥，请通过仓库 issue 提出；处理方式为删除对应 `public/img/emotes/*.webp` 并在
  `CUSTOM_EMOTE_THEMES` 里去掉该 id（功能代码保留，其余表情不受影响）。

## 8. 如何新增表情

1. 把图片转成 **120×120 WebP**（内容缩放进 112×112 透明画布并居中，四周留 4 px），放到
   `public/img/emotes/`；
2. 在 `shared/constants.js` 的 `CUSTOM_EMOTE_THEMES` 里加一条 `cemo(id, sortId, '/img/emotes/<file>.webp', N_('名字'))`，
   id 以 `custom_` 开头，`sortId` 保持该页内递增；
3. 在 `public/i18n/{en,ja,ko,zh-TW}.json` 四个包里加同一个中文 msgid 的翻译（`node tools/i18n.mjs check --all --strict`）；
4. 更新 `public/img/emotes/README.md` 的清单与来源说明；
5. 跑 `node --test test/ui/custom-emotes.test.js`（尺寸、格式、目录与清单一致性）与
   `node --test test/ui/watch-emote.test.js`（可见性 / 脉冲 / 缓存）；
6. 若要新增一整页，追加一个 theme 对象并保持 `themeId` 唯一；`EMOTE_WHEEL_THEMES` 与 `SENDABLE_EMOTES`
   会自动包含它，无需改协议。

## 9. 已知限制

- **不跨端同步轨迹**：每个客户端用自己的随机数生成粒子，轨道、位置、延迟都不同；同一 `count` 在两块屏幕上
  看起来不会逐帧一致。这是有意的（线上只传 id 与次数，不传轨迹）。
- **缓存只在内存**：刷新 / 重连后没有 2 秒补放；跨局不保留。
- **观战按钮只在观战他人时出现**：标题、大厅、房间等待、结算页与自己的战场都不渲染。
- **观战者不显示连击**：`连击 × N` 只属于发送者自己的屏幕（`spectator` 不显示按钮）。
- **端到端未验证**：当前开发环境没有 Chrome；`test/ui/*.e2e.test.js` 需要 `SP_E2E=1` 与可用的
  Chrome / Edge 才能跑，本功能的可见性 / 缓存 / 脉冲以 `test/ui/watch-emote.test.js` 的纯函数与组件测试为准。
- **随机模式的消息数**：一个 200 ms 窗口最多 6 条消息（每个 id 一条）；第 7 个 id 会并入第一个 id，点击不会丢失，
  但那条弹幕的表情会变成第一个 id。

## 10. 文件清单与入口点（`文件:行号`）

| 关注点 | 位置 |
|---|---|
| 自定义表情清单 / 轮盘页 / 可发送集合 | `shared/constants.js:289`、`shared/constants.js:305`、`shared/constants.js:307` |
| 观战脉冲上限与频率 | `shared/constants.js:337`–`344` |
| `g.emote` 协议校验 | `shared/protocol.js:584` |
| 服务端频率 / 目标 / 转发 | `server/match/match/intents.js:47`、`server/match/match/intents.js:72`、`server/match/match/intents.js:92` |
| 点击与脉冲合并 | `public/js/ui/emotes.js:620`、`public/js/ui/emotes.js:113` |
| 持久化键 | `public/js/ui/emotes.js:50`–`59` |
| 按钮组件 | `public/js/ui/emotes.js:477` |
| 紧凑提示（`EmoteBubble` 的 text/n） | `public/js/ui/emotes.js:290` |
| 事件归属 / 是否飘落 | `public/js/ui/watchEmote.js:88`、`public/js/ui/watchEmote.js:102` |
| 粒子展开 | `public/js/ui/watchEmote.js:118` |
| 2 秒缓存 / 补放 | `public/js/ui/watchEmote.js:49`、`public/js/ui/watchEmote.js:58`、`public/js/ui/watchEmote.js:198` |
| 飘落层 / 连击组件 | `public/js/ui/watchEmote.js:153`、`public/js/ui/watchEmote.js:254` |
| 发送动作 | `public/js/ui/gameActions.js:98` |
| 战斗屏接线 | `public/js/screens/game.js:1744`–`1755`、`public/js/screens/game.js:1629` |
| 队伍面板气泡 | `public/js/ui/teamPanel.js:201` |
| 普通表情过滤 | `public/js/ui/gameLogic/watch.js:111` |
| 事件存储 | `public/js/store.js:92`、`public/js/store.js:199` |
| 按钮样式 | `public/css/emotes.css:171`、`public/css/emotes.css:140` |
| 飘落 / 连击样式 | `public/css/screens/game.css:52`、`public/css/screens/game.css:71` |
| 素材 | `public/img/emotes/README.md:1`、`public/img/emotes/*.webp` |
| 测试 | `test/ui/watch-emote.test.js:1`、`test/ui/custom-emotes.test.js:1`、`test/ui/emotes.test.js:1`、`test/match/connection.test.js:1` |
