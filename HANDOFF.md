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
| 版本 | `0.3.23`（…0.3.21 最小可读宽度 280 + 克制侵入；0.3.22–0.3.23 把最小可读宽度变成**面板声明字段** `minWidth`） |
| npm | **未发布** |
| 运行载体 | client 模块：`window.__ModuleLoader__.load({ id: 'dsh-panel-dock' })` |
| 宿主槽位 | `sidebar.footer.action`（左栈）、`shell.overlay`（右带） |
| 持久化 | `localStorage["dsh.panel-dock.v1"] = { sides: { [id]: "left" \| "right" } }` |
| 已部署 | invictus（`dsh plugin list` 实测 0.3.13）/ VM win11-test 0.3.12 |
| 注册表 | `window.__dshPanelDockRegistry`（Map，跨热更新存活） |
| 监听器 | `window.__dshPanelDockListeners`（Set） |

`client.js` 是唯一运行时代码；`dock-core.js` 只服务单元测试（client 模块加载器不支持相对 require，核心逻辑在 client.js 内联了一份）。

## 3. 公开 API（消费者唯一契约）

```js
window.__dshPanelDock = {
  version,                 // 字符串
  define(definition),      // 返回 dispose()
  panels(),                // [{ id, title, order, side }]
  getSide(id),             // 'left' | 'right'
  setSide(id, side),       // 返回最终 side
  toggleSide(id),          // 返回新 side
  subscribe(listener),     // 返回 unsubscribe
}
```

`define({ id, title, order, side, minWidth, component })`：`id` 非空、`component` 必须是函数；同 id 重复注册会覆盖。
`minWidth`（0.3.22）：面板声明「低于这个宽度我的内容就不再有意义」，正整数 px，钳到 [120, 480]，缺省 280。
dock 保证右带里**永不窄于它**；空白不够时只取走差额。`panels()` 会把解析后的 `minWidth` 一并返回。
`order` 目前**不参与排序**——堆叠顺序是注册先后（先来后到）。

## 4. 面板组件契约

1. 渲染**一个根元素**，把收到的 props 展开到它上面，`style` 放最后：`h('div', Object.assign({}, rest, { style: Object.assign({}, style, {...}) }))`。
2. **不要**自己定位：无 `position: fixed`、无固定宽高、不要用 margin 对抗父级。
3. dock 会注入 `style`（`width/minWidth/boxSizing/flex:0 0 auto/order:0/margin:0/pointerEvents:auto`）。卡片自带的外壳（边框/圆角/底色/阴影）保留。
4. 左侧宿主只提供 `width: 100%`，所以面板必须有**固有高度**。
5. **必须声明 `minWidth`**（或接受默认 280）：它是「内容不再有意义」的宽度。dock 只负责不让它更窄，不负责猜你的内容。测法见 §8 的宽度扫描。

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

- **宽度扫描（量 minWidth）**：把 `[data-panel-dock-strip]` 的 `width` 用内联 `!important` 依次设成 240/260/280/300/340，每次截图看卡片里的**数值**有没有被截成 `35.2/1…`；取「最窄且无截断」那一档。注意：`scrollWidth > clientWidth` 与文本 Range 宽度两条启发式都会漏判（264 时都报"无截断"，实际已截），**只能看图**。
- 同一实例的**桌面 app**：VM 上的 DSH 以 `--remote-debugging-port=9222` 启动，直连 `dsh-app://app/` 这个 target 即可（**不需要**伪造 auth cookie，也别选 `welcome.html`）。窗口被最小化/后台时会节流（RO 与 rAF 延迟数秒、`Input.dispatchMouseEvent` 超时），先 `Emulation.setFocusEmulationEnabled` + `Page.setWebLifecycleState: active`。
- 单元测试在沙箱里用 `node --test` 会 `spawn EPERM`（runner 要起子进程）：直接 `node test/dock.test.js`。
- **不要用「卡片上显示的版本号」证明客户端已热更新**（2026-11-19 实测教训）：dsh-codex-advisor 的版本号来自 host 快照（`props.version` ← `data?.source?.version`），不是 client bundle 常量，显示 v0.10.1 时其 client.js 文件早已是 0.10.2。要证客户端生效，只能用「行为指纹」（发版时故意改一段可见文字/属性）或 CDP 读 `window.__dshPanelDock.version`；拿不准就别声称，直接让用户重启。

先 VM（`win11-test`，`king@100.108.63.25`，密钥 `~/.ssh/id_tailnet`）验证，再同步 invictus。

## 9. 消费者现状

| 插件 | 版本 | 说明 |
|---|---|---|
| `dsh-ustc-quota` | 1.2.7 | 左侧默认；右侧用 `rootDocked` 侧栏底色 + 更轻的阴影颜色（形状不变） |
| `dsh-codex-advisor` | 0.10.1 | `PANEL_DOCK_SPEC` 钉的是 `a8c789c` = panel-dock **0.1.0（takeover 时代，`inject('main')`）**：用户点它的「安装 panel-dock」会把已装新版**降级**回接管 main。归属会话 `session-3e48f83b`（DSH-Codex-Advisor）已在 **0.10.1**（2026-11-18）修掉：钉 tag `v0.3.12` + 「已装 ≥ 目标就拒绝安装」守卫。已装的 0.10.1 以下的版本仍有此按钮，别点。 |

## 10. 未决项

- npm 是否发布（用户尚未批准）。仓库目前没有任何 tag，`v0.3.12` 是第一个。
- `dock-core.js` + `test/dock.test.js` 仍在测**已删除**的模型（width / collapse / open / height 模式 / order 排序）：10/10 绿但不覆盖任何现役几何。要么删、要么按现役逻辑（side 解析 + 带宽公式）重写，待用户定。
- 左侧栈溢出未验证（宿主 sidebar 自身是否滚动）——右侧已解决，左侧未测。
- 左右切换会重挂卡片（跨两个宿主必然 remount），实测：卡片出现 7–17ms，但会取数的卡（ustc-quota）要 ~2.1s 才把「加载中…」变成数据。彻底修法是把所有卡放进一个 portal 托盘、用 DOM 移动容器（保住挂载），但 portal 会切断宿主 React context，第三方卡可能受影响——未做，待用户定。
- 侵入时会盖住轮次条（用户允许）；轮次条在那一段不可点。
- 回落左侧栈只在「280 > 对话列宽 50%」时发生；此时卡自己的「移到右侧」按了没有可见效果。

## 11. 禁止事项

- 不给插件加任何导航项/按钮/开关。
- 不改卡片配色；阴影只允许按底色调**颜色**，不动偏移与模糊。
- 不自造堆叠间距（与左侧 6px 一致）。
- 不重启 invictus 的 DSH（需当窗授权）。
- 协作中心正在被另一会话重构：本插件相关记录先不写 LOG，只在需要时给指针。
