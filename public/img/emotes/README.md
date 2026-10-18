# 自定义表情素材（交流列表）

本目录是「交流」表情轮盘里两页自定义表情（`shared/constants.js` 的 `CUSTOM_EMOTE_THEMES`）的图片。
这些图片**不是**官方素材，也不属于 `public/assets/**`（那一层是官方游戏素材，永不入库）；它们随仓库提交，
只服务非商业、免费的同好联机。

| 文件 | 表情 id | 来源 |
|---|---|---|
| `amiya_sit.webp` | `custom_amiya_sit` | 网络动图（阿米娅·坐下） |
| `amiya_cheer.webp` | `custom_amiya_cheer` | 网络动图（阿米娅·加油） |
| `prss_smug.webp` | `custom_prss_smug` | 网络动图（普瑞赛斯·得意） |
| `qq_cat_wow.webp` | `custom_qq_cat_wow` | 网络表情包（猫猫·震惊） |
| `qq_cat_no.webp` | `custom_qq_cat_no` | 网络表情包（猫猫·拒绝） |
| `qq_headpat.webp` | `custom_qq_headpat` | 网络表情包（摸摸头，静态） |
| `qq_starry.webp` | `custom_qq_starry` | 网络表情包（星星眼，静态） |

- **来源：网络表情包。** 阿米娅三张动图出自 B 站作者「疚刃」<https://space.bilibili.com/107716290>；
  QQ 表情包几张的原始出处已不可考。角色形象版权归鹰角网络 / Yostar，表情包本身归各自作者；
  仅用于非商业、免费的同好联机。致谢与使用范围另见 [`docs/WATCH-EMOTES.md`](../../../docs/WATCH-EMOTES.md)。
- **规格与官方战斗表情一致**：官方 basic / basic_2 的战斗表情是 120×120 PNG，本目录统一为 **120×120 WebP**，
  内容等比缩放进 112×112 透明画布并居中（四周各留 4 px），与官方表情在轮盘的 85 px 格子里显示时大小一致。
- **转换方式**（Pillow 12，可复现）：
  - GIF 逐帧合成到 RGBA，取所有帧 alpha 的并集包围盒后等比缩放；每 2 帧取 1 帧（阿米娅 27→14 帧、
    阿米娅 2 / 普瑞赛斯 70→35 帧、猫猫震惊 28→14 帧），帧时长按抽帧倍数放大，循环节奏不变；
    猫猫拒绝 15 帧全留；摸摸头只有 1 帧，存为静态 WebP。
  - 星星眼先把四角连通的近白背景转成透明，再按同样的包围盒缩放。
  - 保存参数：`quality` 78–84、`method 4`（静态 6）、`exact=True`、`loop=0`；单文件 5–128 KB。
- **改名 / 增删表情**：同步改 `shared/constants.js` 的 `CUSTOM_EMOTE_THEMES`（id、`art` 路径、`sortId`），
  再跑 `node --test test/ui/custom-emotes.test.js`（尺寸、格式、目录与清单一致性）。
