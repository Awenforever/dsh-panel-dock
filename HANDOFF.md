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

`client.js` 是唯一运行时代码；`dock-core.js` 只服务单元测试（client 模块加载器不支持相对 require，核心逻辑在 client.js 内联了一份）。自 0.6.13 起 `dock-core.js` 是**现役几何的纯模型**，并用「读 client.js 源码比对常量」的用例防止两边漂移。

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

#
#
#
#
 
逐
动
画
隔
离
（
2
0
2
6
-
1
1
-
2
4
，
同
一
真
实
窗
口
，
每
档
 
1
2
 
秒
）




|
 
操
作
 
|
 
T
a
s
k
 
|
 
L
a
y
o
u
t
 
|
 
S
t
y
l
e
 
|
 
p
a
i
n
t
 
次
数
 
|


|
-
-
-
|
-
-
-
|
-
-
-
|
-
-
-
|
-
-
-
|


|
 
基
线
（
全
开
）
 
|
 
1
1
3
5
0
m
s
 
|
 
9
8
8
m
s
 
|
 
4
0
3
m
s
 
|
 
2
9
3
1
 
|


|
 
停
 
`
r
o
w
-
s
h
i
m
m
e
r
`
（
6
 
个
）
 
|
 
1
1
5
4
2
m
s
 
|
 
1
0
6
6
m
s
 
|
 
3
0
2
m
s
 
|
 
3
1
6
9
 
|


|
 
停
 
`
d
o
t
-
s
p
i
n
`
（
2
 
个
）
 
|
 
7
8
4
3
m
s
 
|
 
*
*
1
1
m
s
*
*
 
|
 
4
3
4
m
s
 
|
 
3
8
4
7
 
|


|
 
停
 
`
d
o
t
-
d
a
s
h
`
（
2
 
个
）
 
|
 
1
1
4
0
8
m
s
 
|
 
1
0
2
6
m
s
 
|
 
3
5
2
m
s
 
|
 
*
*
2
7
*
*
 
|


|
 
*
*
全
部
停
*
*
（
1
0
 
个
）
 
|
 
*
*
3
7
3
m
s
*
*
 
|
 
1
3
m
s
 
|
 
5
2
m
s
 
|
 
2
6
 
|




结
论
（
和
之
前
的
粗
结
论
不
同
，
以
这
张
为
准
）
：


-
 
`
d
o
t
-
d
a
s
h
`
（
S
V
G
 
`
s
t
r
o
k
e
-
d
a
s
h
a
r
r
a
y
/
d
a
s
h
o
f
f
s
e
t
`
）
是
 
*
*
p
a
i
n
t
 
驱
动
*
*
：
2
9
3
1
 
→
 
2
7
（
−
9
9
%
）
，
但
主
线
程
几
乎
不
变
；


-
 
`
d
o
t
-
s
p
i
n
`
（
S
V
G
 
`
<
g
>
`
 
上
的
 
t
r
a
n
s
f
o
r
m
）
是
 
*
*
l
a
y
o
u
t
 
驱
动
*
*
：
9
8
8
m
s
 
→
 
1
1
m
s
（
−
9
9
%
）
，
p
a
i
n
t
 
反
而
更
多
；


-
 
两
者
叠
加
才
让
主
线
程
崩
：
全
部
停
 
→
 
1
1
3
5
0
m
s
 
→
 
*
*
3
7
3
m
s
（
−
9
7
%
）
*
*
。




所
以
「
只
关
 
d
a
s
h
」
看
起
来
没
效
果
（
p
a
i
n
t
 
掉
了
但
 
C
P
U
 
没
掉
）
，
必
须
*
*
同
时
*
*
处
理
 
s
p
i
n
。




为
什
么
 
C
S
S
 
救
不
了
：
`
[
c
l
a
s
s
*
=
_
s
p
i
n
n
e
r
M
o
t
i
o
n
_
]
{
w
i
l
l
-
c
h
a
n
g
e
:
t
r
a
n
s
f
o
r
m
;
c
o
n
t
a
i
n
:
l
a
y
o
u
t
 
p
a
i
n
t
}
`
 
实
测
让
 
p
a
i
n
t
 
*
*
上
升
*
*
（
2
8
6
3
→
3
2
8
0
）
—
—
C
h
r
o
m
i
u
m
 
不
会
为
 
S
V
G
 
子
元
素
单
独
建
合
成
层
，
`
w
i
l
l
-
c
h
a
n
g
e
`
 
在
 
S
V
G
 
`
<
g
>
`
 
上
无
效
。
要
根
治
只
能
改
宿
主
（
把
转
圈
改
成
 
H
T
M
L
/
C
S
S
 
动
画
，
或
去
掉
动
画
）
。


### 真实窗口 paint/layer 实测（2026-11-24，path C: CDP 9222，用户 Electron 渲染进程）

环境：1920×983 CSS、dpr=1、4536 个节点、**10 个无限动画**（`_dsh-state-dot-spin/dash` × 若干 + `_dsh-row-shimmer-sweep/highlight`），当时 5 个会话处于 running。

| 20 秒窗口 | TaskDuration | Script | Layout | Style | paint 次数 |
|---|---|---|---|---|---|
| 动画在跑 | **17731ms (88.7%)** | 1710ms | **1975ms** | 1260ms | **4631** |
| 全部暂停 | 5745ms (28.7%) | 2021ms | **115ms** | 629ms | **151** |

paint 次数 −97%，Layout 时间 −94%，主线程占用 −68%。

逐图层（在跑的 20 秒内）：
- `22×22` 的两个小图层各被重绘 **2239 次**（≈112 次/秒）——就是侧栏那个转圈点；**它们没有被提升成独立合成层**，每帧都在光栅化。
- 整窗 `1920×983` 图层重绘 24 次（滚动/光标/流式文本等）。

CPU 采样（running 态 10 秒，10469ms）：`(program)` 8307ms = **79.3%**（native 光栅/合成）、`(idle)` 9.3%、JS 合计约 3%（`get` 143ms、`scrollMetrics` 79ms、`getBoundingClientRect` 49ms）。

结论：renderer 满核 = **native 重光栅**，触发源是每个 running 会话那两个无限动画（SVG 里的 transform/dash 未被合成），与三家插件 JS 无关。缓解：减少 running 会话数（线性）；根治：宿主把点改成合成层动画或去掉 dash。

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
- **已解决（0.6.13，2026-11-25）**：`dock-core.js` + `test/dock.test.js` 已按**现役**几何重写（不再测 width/collapse/open/height/order 那套已删除的模型）。11 个用例覆盖：0×0 隐藏锚点不算锚点、轮次轨必须是列（单个散落按钮不算）、inner/outer/intrude/fallback 四态、轨迹/看板（有页签无轮次轨）贴右缘、主区域页面 plan（满宽保宽 / 真空槽才缩 / 首帧用 required）、侧别解析。**另加漂移守卫**：用例直接读 `client.js` 源码，断言 `GAP / MIN_WIDTH_FLOOR / MAX_PANEL_WIDTH / DEFAULT_MIN_WIDTH / MAX_COVER_RATIO` 与 `VERSION` 字面量仍与本模型一致——常量改了没同步就红。跑法：`node --test test/dock.test.js`（需 node 绝对路径）。
- **已解决（0.6.13）**：左侧栈溢出。宿主 sidebar 不给滚动（`overflow-y: visible`，窗口边缘直接裁），1280×560 实测最后一张卡 bottom=567 > 560 且祖先链无可滚动容器 → 够不到。修法 `syncLeftStackScroll()`：`rect.top` 之下的可用高度作 `max-height`，溢出时 `overflow-y:auto` + `scrollbar-width:thin` + 打 `data-panel-dock-left-scrolls`。实测 `sh 459 / ch 434`，滚 25px 后最后一张 bottom 542 ≤ 560（可见）。
- 无 `createPortal` 的旧宿主退回路径只做过静态核对（`apply()` 二选一 + 旧实现原样），**没有运行时验证**：手上没有那种宿主。
- 0.4.0 的六态验证记录：inner（2571 宽 → 480）、intrude（1887 宽 → 280）、outer（VM 合成锚点 → 480）、fallback（470 宽 → 全部回左侧栈、无条带）、mixed、overflow（滚动 + 阴影留白）。
- **已解决（0.4.0）**：左右切换重挂卡片 → 改 portal 托盘后实测不复现（`sameNode: true`、切边全程无「加载中…」）。遗留观察项：React 事件现在冒泡到 Tray 而不是宿主树，若将来有宿主逻辑依赖「侧栏内点击冒泡」，需要复核。
- 侵入时会盖住轮次条（用户允许）；轮次条在那一段不可点。
- 回落左侧栈只在「280 > 对话列宽 50%」时发生；此时卡自己的「移到右侧」按了没有可见效果。


## 12. 0.6.8–0.6.12（2026-11-25）：五个用户报障的定案

| 症状 | 根因 | 修法 | 版本 |
|---|---|---|---|
| 切右后**所有卡片消失**，切回也不恢复 | 我把 `pageTabs` 代码插进 `TrayHost` 的 effect，给只存在于 `measureAnchors` 的 `pageTop` 赋值 → 严格模式 `ReferenceError` → 托盘整棵崩掉，密封层渲染 null 且不自愈 | 删除误插代码；`pageTabs` 只留在 `measureAnchors` | 0.6.8 |
| 主区域页面（Memory）卡片**变窄** | 页面模式只取 `minWidth`（280），对话页是 480 | 记住上次对话页实际宽度（`lastPlannedWidth`），页面模式沿用 | 0.6.9 / 0.6.12 |
| 点 轨迹/看板/Codex 后卡片**飞到左上角**（实测 `x=6`） | ① 这两个视图里右分隔条存在但尺寸 **0×0**，`getBoundingClientRect()` 返回 `left/right=0`；② 一个散落的「跳转」按钮被当成轮次轨 | ① 锚点必须有面积（`w>0 && h>0`）；② 轮次轨兜底要求**同一 x 至少 2 个**标记 | 0.6.11 |
| 满宽页面（Memory）在 0.6.11 后又被压到 280 | 内容右缘爬到页签容器（2532），误判「有 22px 空槽」 | 默认沿用熟悉宽度；只有 `vw - contentRight - 2*GAP ≥ required` 的真空槽才缩 | 0.6.12 |
| 右带卡片挡住对话，无法点后面的内容 | 悬停穿透在浏览器里**自相矛盾**（`pointer-events:none` 收不到 hover → 闪烁） | 用户选方案 A：悬停 `opacity:0.45`、仍可点；由 dock 注入统一 CSS（`style[data-dsh-panel-dock=band-hover]`），卡片零改动 | 0.6.10 |

**稳定的经验值**（2560×1392 窗口实测）：
- 对话页：`x=1886, y=121, w=480, right=194`（轮次轨 45 个标记在 x=2513，`inner` 模式吃到 480 上限）；
- 轨迹/看板：`x=2074, y=121, w=480, right=6`（贴右缘，用户 2026-11-25 明确选择「保持这样」而不是缩到 280）；
- Memory：`x=2074, y=121, w=480`（与对话页同宽）；内容区满宽时不再压缩。

**新增事实：client.js 热更新在真实窗口里生效**。0.6.11 → 0.6.12 安装后未重启，`window.__dshPanelDock.version` 直接变成新值（`pnpm install` 替换 node_modules 后 HMR 重载模块）。所以插件改动不必每次让用户重启；「enable/disable 不能载入新 client」那条仍然成立，两者不矛盾。


## 13. 0.7.x（2026-11-25）：同侧牌堆、悬停开关、CardFrame、切会话不再跳动

**① 切会话「先缩右再展开」已修**（`STICKY_PLAN_MS = 2500`）。
实测（每 100ms 采样）：载入史时轮次轨从 45 个变 0，旧逻辑把「有页签无轮次轨」判成页面模式 → 带子 `x=2074`；载入完才回 `inner` 的 `1886`。修法：`lastAnchoredPlan` 记住上次 `inner/outer/intrude` 计划，2.5 秒内复用它。验证：切一次会话，带子 x 全程只有 `[1266]` 一个值（2560 宽窗口）。

**② 牌堆（deck）**：`localStorage["dsh.panel-dock.deck"] = "1"` 打开；两侧都支持。
- 几何：前卡整张可见，其余各露 **24px** 细条叠在上方；容器高 = 前卡高 + 24×(N-1)，`transition: height 200ms`。
- 交互：容器内**滚轮**换前卡（`deltaY>0` 前进/`<0` 后退，130ms 节流）；**点细条**直接把那张提到最前。
- 平滑：位移只用 `transform: translateY()`（合成层），高度只变一次；后卡用 `clip-path: inset(0 0 calc(100% - 24px) 0)` 剪成细条——不剪的话后排高卡会从前卡底部露出（实测 222px 后排 在 170px 前卡下溢出 28px）。
- 高度跟随：`ResizeObserver` 观察所有 cell，前卡长高时容器高度重算（首次测量会偏小：loci 卡 128→170，导致前卡被自己的容器裁掉）。
- 实测（1440×900）：滚轮下 → 前卡 `loci-memory`→`ustc-quota`、容器 `218px`→`270px`；滚轮上复原；点第二条细条 → `ustc-quota` 到前。右带同样工作（3 张、`h=218px`）。

**③ 悬停开关（affordance）**：列顶部 `-6px` 处一条 6px 的 `[data-panel-dock-deck-bar]`，悬停展开到 `26px`、`opacity .35→1`，黑色渐变 + 三个向下游动的 chevron（`pdDeckChevron`，`prefers-reduced-motion` 关闭动画）；点击切换牌堆/并列并持久化。**只有该侧 ≥2 张卡时才显示。**
坑：条是 `position:absolute`，容器静态定位时会以视口为参照 → 实测跑到 `y=-6`（点不到）。修法：创建条时若 `getComputedStyle(container).position === "static"` 则设 `relative`。

**0.7.7/0.7.8 三条用户反馈的修正**（都很具体，别再犯）：
1. **「点了没反应」= 右带的条根本收不到点击**。带子是 `pointer-events:none`，条作为子元素**继承**了它；左栏栈没这个问题，所以我之前只在左栏验证过。修法：条上显式 `pointer-events:auto`。实测：右带点一次 `localStorage=1 / deck=true`，再点回 `0 / false`。
2. **「常驻 / 顶部变高」**：原来 `top:-6px` 在列外、且常驻 `opacity .35`，看起来像给列加了高度。现在：`top:0`（压在列顶、不占布局）、静止 `opacity:0` 的 10px 透明感应区，悬停才显形。实测悬停前后 `bandTop`、`cardTop` 均为 121 —— **布局零变化**。
3. **「太细 / 玻璃感」**：悬停时 32px 高、左右各外扩 4px，`backdrop-filter: blur(7px) saturate(1.15)` + `rgba(18,20,24,.72→.30)` 渐变 + 三个白色 chevron（`drop-shadow` 提对比）。第一版 `.46` 的黑在浅色卡上变灰、白箭头几乎看不见，加深后才读得出来。
4. 牌堆开启时 chevron 转 90°（`rotate(-45deg)`）表示「拆回并列」。

**④ CardFrame（`frame: true`，opt-in）**：dock 接管矩形——`--dsw-specific-sidebar-fill` 底、`1px --dsw-alias-border-l1`、radius 12、padding `10px 9px 8px`、`0 1px 2px rgba(0,0,0,.04)` 阴影（只按底色调颜色，符合 §11）。
- 默认 **false**：dock 不得替卡片改配色（§11），只有卡片显式 opt-in 才算它同意。
- dock 会**强制拉平**卡片直接子元素（`padding/margin/border/radius/background/box-shadow → 0`，带 `!important`）：`.card-root` 的规则与本规则同优先级且后落，不加 `!important` 会留下「框中框」（实测：frame 280×168 内套 `loci-card-root` 261×149，白底圆角）。
- 实测：`data-panel-dock-frame` 280×149、`padding 10px 9px 8px`、`radius 12px`、`bg rgb(249,250,251)`，子元素全零 —— 与 USTC 卡同色。

**⑤ 与 dsh-loci 的契约**（他们已 `frame: true`）：`[data-panel-dock-frame]` 属性名与 `10px 9px 8px` padding 不变；他们的 `[data-panel-dock-frame] .loci-card-body{...}` 选择器选错了元素（画框的是 `.loci-card-root`），但 dock 拉平后不影响结果。

## 11. 禁止事项

- 不给插件加任何导航项/按钮/开关。
- 不改卡片配色；阴影只允许按底色调**颜色**，不动偏移与模糊。
- 不自造堆叠间距（与左侧 6px 一致）。
- 不重启 invictus 的 DSH（需当窗授权）。
- 协作中心正在被另一会话重构：本插件相关记录先不写 LOG，只在需要时给指针。