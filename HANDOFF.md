# HANDOFF — dsh-panel-dock

> 读者：接手本插件的 agent。本文是**当前状态**的唯一入口，写于 2026-11-18（panel-dock 0.3.9）。
> 历史过程在协作中心 `projects/plugins/dsh-ustc-quota/LOG.md` E78–E89（该仓库正在被另一会话重构，读取时按标题定位）。

## 1. 定位与边界

这是一个**纯槽位协商插件**：别的插件把卡片注册进来，它决定卡片渲染在左侧栏还是右侧带。

- **不做**：导航项、按钮、弹窗、快捷键、开关。用户在界面上能看到的每个交互都属于卡片自己。
- **不做**：接管 `main` 槽位（takeover 方案已删除，详见 §6）。
- **不做**：自造间距、改卡片配色/阴影形状。

## 2. 硬事实

| 项 | 值 |
|---|---|
| 仓库 | `github.com/Awenforever/dsh-panel-dock` |
| 版本 | `0.5.1`（…0.4.1 `order` 排序；0.5.0 可选 `CardShell` + 术语统一；0.5.1 修 README 示例 + children 警告） |
| npm | **未发布** |
| 运行载体 | client 模块：`window.__ModuleLoader__.load({ id: 'dsh-panel-dock' })` |
| 宿主槽位 | `sidebar.footer.action`（左栈）、`shell.overlay`（右带） |
| 持久化 | `localStorage["dsh.panel-dock.v1"] = { sides: { [id]: "left" \| "right" } }` |
| 已部署 | invictus 0.5.0（CDP 实测 `window.__dshPanelDock.version`）/ VM win11-test 0.4.0（机器离线，未更新） |
| 注册表 | `window.__dshPanelDockRegistry`（Map，跨热更新存活） |
| 监听器 | `window.__dshPanelDockListeners`（Set） |

`client.js` 是唯一运行时代码；`dock-core.js` 只服务单元测试（client 模块加载器不支持相对 require，核心逻辑在 client.js 内联了一份）。

## 2.1 渲染架构（0.4.0）

卡片**不**由左/右两个宿主直接渲染，而是全部渲染在一个挂在 `shell.overlay` 的 **Tray** 里：

- 每张卡一个固定容器 `div[data-panel-dock-cell]`，卡片经 `createPortal` 渲染进容器；
- 左宿主只提供一个占位 `div[data-panel-dock-left-slot]`（`display:contents`），Tray 把容器 `appendChild/insertBefore` 进 `div[data-panel-dock-left]` 或右带；
- 换边时**只移动容器节点**，React 不 remount → 卡片内部 state（含数据快照）与滚动位置都保住；
- 实测依据：把已渲染、已取数的卡片纯 DOM 移动父节点，内容与 `loading` 状态原样（2s/5s 两次采样）；真机 0.4.0 切边全程未出现「加载中…」。
- `require('react-dom')` 拿不到 `createPortal` 时（老宿主），自动退回 0.3.x 的两宿主直渲路径——卡片会 remount，但功能不丢。

**对卡片的额外要求**：不要依赖 DOM 父节点（容器会在左栈/右带之间搬动）。父选择器、`closest()` 找宿主、依赖 DOM 层级定位的写法都会失效。

## 2.2 术语（2026-11-21 用户统一）

| 词 | 指什么 | 宿主 |
|---|---|---|
| **侧栏卡片**（sidebar card） | dock 承载的卡片，左栈或右带 | **panel-dock** |
| **主区域面板**（main-area panel） | 整页视图（如 dsh-loci 的五视图） | DSH 宿主，**不在 dock** |

单独说 "panel" 时一律指主区域面板；dock 里的东西一律叫侧栏卡片。组件命名同理：`CardShell`，不是 PanelShell。

## 3. 公开 API（消费者唯一契约）

```js
window.__dshPanelDock = {
  version,                 // 字符串
  define(definition),      // 返回 dispose()
  panels(),                // [{ id, title, order, side, minWidth, version }]
  getSide(id),             // 'left' | 'right'
  setSide(id, side),       // 返回最终 side
  toggleSide(id),          // 返回新 side
  subscribe(listener),     // 返回 unsubscribe
}
```

`define({ id, title, order, side, minWidth, version, component })`：`id` 非空、`component` 必须是函数；同 id 重复注册会覆盖。
`minWidth`（0.3.22）：面板声明「低于这个宽度我的内容就不再有意义」，正整数 px，钳到 [120, 480]，缺省 280。
dock 保证**右带**里永不窄于它；空白不够时只取走差额。`panels()` 会把解析后的 `minWidth` 一并返回（左右两侧都返回，供调用方判断）。
注意 `minWidth` **不约束左栈**：左栈宽度=侧边栏宽度（host/用户决定），dock 不能加宽。
`order` 决定堆叠：**升序，缺省 100，同值保持注册序**（0.4.1）。`version`（字符串/数字，可选）由 `CardShell` 显示。
`CardShell`（0.5.0/0.5.1）：可选共享顶栏组件，`h(dock.CardShell, { id, actions? })`；**只画顶栏**（logo=侧别切换 + 标题 + 版本），**不渲染 children**（故意，不是容器）。正确用法：卡片根 div 里先放 shell、再放自己的主体，两者是兄弟。传 children 会打一条 warning（0.5.1）而不是静默吞掉。已实测：渲染、点击换边、aria 文案翻转均正常。

## 4. 面板组件契约

1. 渲染**一个根元素**，把收到的 props 展开到它上面，`style` 放最后：`h('div', Object.assign({}, rest, { style: Object.assign({}, style, {...}) }))`。
2. **不要**自己定位：无 `position: fixed`、无固定宽高、不要用 margin 对抗父级。
3. dock 会注入 `style`（`width/minWidth/boxSizing/flex:0 0 auto/order:0/margin:0/pointerEvents:auto`）。卡片自带的外壳（边框/圆角/底色/阴影）保留。
4. 左侧宿主只提供 `width: 100%`，所以面板必须有**固有高度**。
5. **必须声明 `minWidth`**（或接受默认 280）：它是「内容不再有意义」的宽度。dock 只负责不让它更窄，不负责猜你的内容。测法见 §8 的宽度扫描。
6. **`minWidth` 只约束右带**。左栈的宽度=宿主侧边栏宽度（由 host 与用户拖拽决定，实测常见 264），dock 只给 `width:100%`，无权加宽——所以一张 `minWidth: 280` 的卡放在左栈里，264 时照样会截断。要保证可读，得让用户把它放右带，或把侧边栏拖宽。

## 5. 几何规则

### 左侧（sidebar 栈）
`sidebar.footer.action` 里的 flex column，`gap: 6`、`flex: 0 0 100%`（宿主 footer 是 nowrap flex row，不这么写会塌成几像素）。

### 右侧（对话右侧空白带）

锚点全部实测，来源于宿主自己的布局：

| 边 | 规则 |
|---|---|
| 左 | `.widthHandle[data-side="right"]` 的 `right + 6` |
| 右 | 轮次条按钮最小 `x − 6`，判据 `x > handleRight`（**不要用固定容差**，见 §6） |
| 上 | `[data-conversation-tabs]` 行 `bottom + 6` |
| 下 | `8` |

宽度与锚定：

```
列右缘 areaRight = 对话列（tabs 往上第一个「高容器」）的最外层同右缘祖先；右侧边栏开着时它就等于侧边栏左界。
inner = 轮次条左 − 6 − (手柄右 + 6)        // 手柄与轮次条之间
outer = (areaRight − 6) − (轮次条右 + 6)   // 轮次条与列右缘之间

required = clamp(max(右带各卡的 minWidth，缺省 280), [120, 480])   ← 一列只能有一个宽度，取最挑的那张

inner ≥ required       → 左锚定在手柄 + 6，width = min(inner, 480)     ← 常态
否则 outer ≥ required  → 右锚定在列右缘，width = min(outer, 480)       ← 用轮次条外侧留白
否则 → **克制侵入**：width = required，右缘贴列右缘（会盖住轮次条，用户明确允许），
       只从正文里拿 required − 可用 的那一条，绝不 480 糊脸
若 required > 对话列宽的 50% → 回落到左侧栈渲染（极端窄窗才触发）

默认 280 是实测值：264 时 ustc-quota 的 24h 列被截成 "35.2/1…"，280 起全部完整，200 时 19 处裁切。
```

- **右侧边栏（开始 / 终端 / 浏览器）打开时，条带的硬右界是对话区的右边缘**，不是窗口边缘（0.3.15）。否则卡片会压在侧边栏上，或落在窗口边缘而越出对话区。
- 溢出时（卡片总高 > 列高）才切成滚动容器，并**按阴影外扩 16px、再用 padding 缩回**：卡片矩形逐像素不变，裁切线落在留白里。见 §6 第一行。
- 堆叠间距 `gap: 6`，与左侧一致——不要为了「阴影分开」自造更大间距。
- 没有右侧面板时不渲染条带：不占宽、不拦点击。

## 6. 踩坑清单（症状 → 根因 → 修法）

| 症状 | 根因 | 修法 |
|---|---|---|
| 升级 dock 后所有卡片消失 | 注册表是模块闭包变量，热更新后被重置 | 注册表/监听器挂到 `window` |
| 右侧卡片阴影是硬边方框 | 条带 `overflow-y:auto`，另一个轴的 `visible` 也会变裁剪 | `overflow: visible` |
| 两张卡看起来黏成一块 | 曾自造 18px 间距 → 用户否决；真正原因是面板底色与页面色接近 + 阴影填满缝 | 间距回到 6；由卡片侧调**阴影颜色**（不是形状、不是底色） |
| 发布同版本号后行为没变 | `pnpm install` 认为已是最新，不换包 | 每次发布必须升 `package.json` 版本 |
| 打包里还是旧版本 | `npm pack` 取 `package.json` 的 version，不是 client.js 常量 | 同步三处：`package.json` / `index.js` / `client.js` |
| 带被挤没、面板消失 | `span < 200` 时 `return null` | 见 §5 的宽度公式 |
| 挤窄后反而压住轮次条 | 锚点检测用 `x > left + 40` / `+2` 过滤，带为 0 时轮次条被排除、退回 480 兜底 | 判据改成 `x > handleRight` |
| 面板高于列高时下方卡片不可达 | `overflow: visible` 不滚动 | 溢出时才切滚动容器：按阴影 16px 外扩、同值 padding 缩回，卡片矩形逐像素不变；`scrollbar-width:none` |
| 溢出判定一直不翻转 | 卡片高度变化（异步数据、样式注入）不触发 dock 重渲染 | `ResizeObserver` 盯每张卡 + 700ms 锚点 tick 兜底（窗口被最小化时节流会让 RO 延迟数秒） |
| 挤窄后对话拖不回来 | 右锚定贴到「轮次条 − 6」，把 10px 的 splitter 整条盖住；卡片越高可抓的地方越少（改成高卡实测：手柄中心 `elementFromPoint` 命中卡片） | 右边界改为「splitter 左侧 − 6」（0.3.13），代价是卡片离轮次条 23px |
| 没有锚点时卡片 480px 糊住对话 | `edge` 兜底直接用了 MAX_PANEL_WIDTH（480） | 0.3.21：任何兜底都不得低于/高于最小可读宽度 280 |
| 侧边栏开着时卡片被挤成一行省略号 | 旧规则「挤不下就压住对话区」：inner 只有 111px 也硬给 200px，向正文借 89px | 0.3.21 用实测的 280 最小可读宽度，侵入只拿它需要的差额 |
| 条带莫名塌到 200px、右边留一条死白 | 右锚点取 `min(所有 /轮次|跳转/ 按钮 x)`，一个**消息级**「跳转」按钮落在手柄与轮次条之间就会把整条带拉走（实测：注入单个 1700 处的按钮，条带 271→200 并左移压住正文） | 轮次条是**竖列**：同 x（±2）≥4 个按钮才算列，取成员最多的列（0.3.14） |
| 卡片压在「开始」右侧边栏上 / 越出对话区 | 右侧边栏打开后轮次条可能整个不渲染（实测 `matched=0`），条带走 480px 兜底，贴 `right: 8` 即窗口右缘 | 从 `[data-conversation-tabs]` 向上找第一个「右边缘 < 窗口」的祖先 = 对话区右界，条带任何分支都不得越过它（0.3.15） |
| 部署后页面仍是旧代码 | 覆盖 `node_modules/<plugin>/client.js`，插件图不变，client-hmr 不换模块 | 走正规安装（§7） |

## 7. 部署纪律

```powershell
# 1) 打包
cd <repo>; npm pack --silent
# 2) 放到本机 vendor
Copy-Item dsh-panel-dock-<ver>.tgz "$env:USERPROFILE\.dsh\vendor\"
# 3) 改 profile spec（只改这一行）
#    profiles/desktop/package.json -> "dsh-panel-dock": "file:C:/Users/<user>/.dsh/vendor/dsh-panel-dock-<ver>.tgz"
# 4) 走宿主 CLI 安装（禁手改 cordis.patch.yml / node_modules）
& "<安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop install
```

- 打包版**没有**「刷新页面」菜单，也**没有** Ctrl+R；Web UI 热更新由 `dsh-client-hmr` 负责，正常安装后**不需要**让用户刷新或重启。
- 若 `pnpm` 报 `ERR_PNPM_NO_MATCHING_VERSION` 或 ENOENT：检查 spec 里的用户名/路径（不同机器用户名不同，如 `king` vs `king_`）。
- 网络抖动会让 GitHub tarball 依赖（如 advisor）失败，重试即可。
- 在沙箱会话里 `npm pack` 会因 `~/AppData/Local/npm-cache` 越界报 `EPERM`：加 `--cache <工作区内路径>` 即可。

## 8. 验证纪律

**断言「用户看到的」必须看真实窗口截图**，不是 DOM 数值。

- 路径 E（真实桌面窗口）：`%USERPROFILE%\.dsh\skills\dsh-real-screenshot\scripts\win-shot.ps1 -ProcessId <pid> -Out <png>`，然后 `read_image` **亲自看**。
- 路径 F（同一实例 Web UI、真实数据）：`node E:\dsh-recovery\04-kit\dsh-web-shot.mjs <port>`。
- DOM 度量、拖拽、视口切换：CDP 脚本；颜色/阴影用**像素取样**（`Bitmap.GetPixel`）判定，不要凭印象。

现成脚本（会话工作区 `.scratch/`）：

| 脚本 | 用途 |
|---|---|
| `squeeze4.mjs` | 打开真实会话 → 拖宽对话盒子挤掉空白带 → 验证面板仍存在且不越轮次条 |
| `check-right4.mjs` | 把面板移到右侧、等真数据、2560/1936 双视口测量 + 截图 |
| `probe-ovf3.mjs` | 卡片横向溢出/裁切度量 |
| `narrow.mjs` | 纯视口缩放的对照（注意：这不是「挤窄」，见 §5） |

- **宽度扫描（量 minWidth）**（`HANDOFF.md` 不随 npm 包发布，只在仓库里）：把 `[data-panel-dock-strip]` 的 `width` 用内联 `!important` 依次设成 240/260/280/300/340，每次截图看卡片里的**数值**有没有被截成 `35.2/1…`；取「最窄且无截断」那一档。注意：`scrollWidth > clientWidth` 与文本 Range 宽度两条启发式都会漏判（264 时都报"无截断"，实际已截），**只能看图**。
- 同一实例的**桌面 app**：VM 上的 DSH 以 `--remote-debugging-port=9222` 启动，直连 `dsh-app://app/` 这个 target 即可（**不需要**伪造 auth cookie，也别选 `welcome.html`）。窗口被最小化/后台时会节流（RO 与 rAF 延迟数秒、`Input.dispatchMouseEvent` 超时），先 `Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState: active`。
- 单元测试在沙箱里用 `node --test` 会 `spawn EPERM`（runner 要起子进程）：直接 `node test/dock.test.js`。
- **不要用「卡片上显示的版本号」证明客户端已热更新**（2026-11-19 实测教训）：dsh-codex-advisor 的版本号来自 host 快照（`props.version` ← `data?.source?.version`），不是 client bundle 常量，显示 v0.10.1 时其 client.js 文件早已是 0.10.2。要证客户端生效，只能用「行为指纹」（发版时故意改一段可见文字/属性）或 CDP 读 `window.__dshPanelDock.version`；拿不准就别声称，直接让用户重启。

先 VM（`win11-test`，`king@100.108.63.25`，密钥 `~/.ssh/id_tailnet`）验证，再同步 invictus。

## 8.1 外观规格（SSOT）

规格全文在 README 的 "Appearance spec (SSOT)"：左右两套 frame / 背景 / 阴影 / 字号，全部是现役卡片的实测约定。消费者只写指针，**不复制**——两份必然漂移。

## 8.2 性能（2026-11-21 实测）

- 旧版（0.5.2）每 700ms 无条件跑 `measureAnchors`：全文档 `querySelectorAll` + 约 20 次 `getBoundingClientRect`（每次强制 reflow）。60 秒实测：gbcr 9306、qsa 331、longtask 44 次/5.1s、最长帧 513ms。
- 0.6.0：右带没有卡 → 完全不测；有卡 → 只在窗口 resize / 对话列尺寸变化（ResizeObserver）时测，2.5s 兜底。同一页面 60 秒：gbcr **160**、qsa **157**、longtask 0、最长帧 51.7ms。
- **教训**：性能对比必须在同一状态下做受控 A/B。曾把"某张卡未渲染时"的 10.9s 与"该卡渲染后"的 27s 直接相比，得出过错误结论。正确做法：把可疑卡临时替换成抛错组件（0.5.2 的错误边界会隔离它、不轮询），跑同长窗口，差值才是那张卡的成本。
- 该会话剩余 TaskDuration ~24.5s/60s 来自宿主渲染长会话（208 轮 / 7567 步）+ 各卡轮询，不是 dock。

- 绘制成本随视口面积走（2026-11-21 实测，running 态）：1936x996（1.9 Mpx）program 2239ms/8s = 25%、idle 72%；2575x1407 dSF1.5（8.1 Mpx）program 4391ms/8s = 49%、idle 49%。JS 始终约 1%，rAF 回调 0。用户真实窗口 3862x2110 设备像素（dpi 144），renderer 满核是 native 光栅/合成成本，不是插件 JS。
- 暂停状态点动画的 A/B（同一 8.1 Mpx 视口、同一 running 会话，2026-11-21）：动画在跑时 program 4391ms/8s（49%）、idle 49%；全部暂停后 program 926ms/8s（10%）、idle 88%。两端 JS 都约 1%。结论：renderer 满核来自持续动画引发的大面积 native 重光栅，与插件 JS 无关；每个 running 会话的转圈点（spin+dash 两个无限动画）是最小可复现触发源，数量随 running 会话数线性增长。

## 8.3 卡片全消失的两种成因（2026-11-22 / 11-24 实测）

**① 运行期崩溃（0.6.4，已修）**：`top` 那行引用了尚未初始化的 `plan`（TDZ），每次渲染抛 `ReferenceError`；槽位密封层把整块渲染成 null，于是**一张卡崩 → 所有卡消失**。0.6.5 修 TDZ；0.6.6 再加一层：托盘崩了就退回旧的左右宿主（卡片最多重挂一次，不会再整块空）。

**② 插件被移出 client 图（0.6.6，环境问题）**：设置里「关掉再打开」会把插件从 `profiles/<p>/package.json` 的 `dsh.profile.bundles` 移除，**但启用时不会自动加回**。后果是 `dependencies` 里还在、`node_modules` 里还在，而 client 半根本不进 web 包 —— 判据是 `window.__dshPanelDock === undefined` 且 `/plugins/??` 合并包里搜不到 `dsh-panel-dock`。

排查顺序（每次只验一个判据）：
1. `window.__dshPanelDock.version` 是否有值 → 无值说明 client 没加载，**不要**再查几何；
2. 页面资源里 `/plugins/??...` 是否含 `dsh-panel-dock`；
3. `profiles/<p>/package.json` 的 `dsh.profile.bundles` 是否含它；
4. `cordis.patch.yml` 是否有 `- id: panel-dock / name: dsh-panel-dock / disabled: false`。

修法（两步，都要）：bundles 加回 + patch 加行，然后在 设置→插件 里重新启用（热应用）。只做 patch 行不够——client 集合由 bundles 决定；只改 bundles 也不一定热生效。

## 9. 消费者现状

| 插件 | 版本 | 说明 |
|---|---|---|
| `dsh-ustc-quota` | 1.2.7（invictus）/ 1.2.8（已发） | 左侧默认；右侧用 `rootDocked` 侧栏底色 + 更轻的阴影颜色（形状不变）。1.2.8 起声明 `minWidth: 280`（带断言）；invictus 仍 1.2.7，等它并到 rc.5 重启一起装。 |
| `dsh-codex-advisor` | 0.10.2 | 归属会话 `session-3e48f83b`（DSH-Codex-Advisor）。0.10.1 起钉 tag（现为 `v0.3.23`）+「已装 ≥ 目标就拒绝安装」守卫；**2026-11-20 在 invictus 实机实测通过**：POST `/plugins/dsh-codex-advisor/install-panel-dock` → `{application:"up-to-date", installedVersion:"0.4.0", targetVersion:"0.3.23", reload:false}`，panel-dock 未被降级。0.10.2 声明 `minWidth: 260`（带断言）。0.11.0 开发中，会把 pin 换到 `v0.4.0`。 |

## 10. 未决项

- npm 是否发布（用户尚未批准）。tag 已有 `v0.3.12` / `v0.3.13` / `v0.3.15` / `v0.3.17` / `v0.3.21` / `v0.3.23` / `v0.4.0`。
- `dock-core.js` + `test/dock.test.js` 仍在测**已删除**的模型（width / collapse / open / height 模式 / order 排序）：10/10 绿但不覆盖任何现役几何。要么删、要么按现役逻辑（side 解析 + 带宽公式）重写，待用户定。
- 左侧栈溢出未验证（宿主 sidebar 自身是否滚动）——右侧已解决，左侧未测。
- 无 `createPortal` 的旧宿主退回路径只做过静态核对（`apply()` 二选一 + 旧实现原样），**没有运行时验证**：手上没有那种宿主。
- 0.4.0 的六态验证记录：inner（2571 宽 → 480）、intrude（1887 宽 → 280）、outer（VM 合成锚点 → 480）、fallback（470 宽 → 全部回左侧栈、无条带）、mixed、overflow（滚动 + 阴影留白）。
- **已解决（0.4.0）**：左右切换重挂卡片 → 改 portal 托盘后实测不复现（`sameNode: true`、切边全程无「加载中…」）。遗留观察项：React 事件现在冒泡到 Tray 而不是宿主树，若将来有宿主逻辑依赖「侧栏内点击冒泡」，需要复核。
- 侵入时会盖住轮次条（用户允许）；轮次条在那一段不可点。
- 回落左侧栈只在「280 > 对话列宽 50%」时发生；此时卡自己的「移到右侧」按了没有可见效果。

## 11. 禁止事项

- 不给插件加任何导航项/按钮/开关。
- 不改卡片配色；阴影只允许按底色调**颜色**，不动偏移与模糊。
- 不自造堆叠间距（与左侧 6px 一致）。
- 不重启 invictus 的 DSH（需当窗授权）。
- 协作中心正在被另一会话重构：本插件相关记录先不写 LOG，只在需要时给指针。