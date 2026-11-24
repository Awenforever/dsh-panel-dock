# [性能] 运行期 renderer 接近满载：状态点动画 + 消息行子树失效 + 轮次轨重复重排

> 可直接作为 issue 正文。环境：Windows 11、DSH 桌面版（Electron）、profile `desktop`、1920x983 CSS / dpr=1、6788 DOM 节点、当前会话转录区滚动高度 26703px。

## 现象

- 有会话处于 running 时，renderer 常驻 80%–148% 单核，GPU 30%–50%；滚动与输入明显卡顿。
- 空闲（无 running 会话）时 renderer 仅 1%–7%。
- 成本随屏幕上内容量放大：空对话约 51%–60%，长会话 130%–148%（同一台机器、同一窗口）。

## 测量方法

Electron 以 `--remote-debugging-port` 启动，CDP 连**真实渲染进程**（非 headless 模拟），使用：

1. `Performance.getMetrics()`：TaskDuration / LayoutDuration / RecalcStyleDuration；
2. `LayerTree` 的 `paintCount` 增量：统计每层重绘次数；
3. `Tracing` + `disabled-by-default-devtools.timeline.invalidationTracking`：统计**样式/布局失效的原因分布**；
4. 逐动画 `pause()` 做受控 A/B。

> 注意：`TaskDuration` 壁钟百分比在同一状态下波动可达 15%–73%（会话启停、流式内容、测量本身都会影响），**原因计数（次数/时间窗）才是可比口径**。

## 第一部分：状态点动画（已可复现，已被本地插件规避）

侧栏每个 running 会话一个 SVG 转圈点，含两个 `iterations: Infinity` 动画：

| 动画 | 目标 | 属性 |
|---|---|---|
| `_dsh-state-dot-spin_*` | `<g class="_spinnerMotion_*">` | `transform` |
| `_dsh-state-dot-dash_*` | `<circle class="_spinnerArc_*">` | `stroke-dasharray` / `stroke-dashoffset` |

SVG 子元素不会被提升为合成层，因此每帧都在光栅化。20 秒窗口实测：

| 条件 | TaskDuration | Layout | paint 次数 |
|---|---|---|---|
| 动画在跑 | 17731ms (88.7%) | 1975ms | 4631 |
| 全部 pause | 5745ms (28.7%) | 115ms | 151 |

逐动画隔离（各 12 秒）：只停 dash → paint 2931→27（主线程几乎不降）；只停 spin → layout 988ms→11ms（paint 反升）；**两者都停** → Task 11350ms→373ms（−97%）。
逐图层：两个 `22x22` 小层各重绘 **2239 次/20s（约 112 次/秒）**。

**CSS 补丁救不了**：给 `_spinnerMotion_` 加 `will-change:transform; contain:layout paint` 实测让 paint 上升（2863→3280）——Chromium 不会为 SVG `<g>`/`<circle>` 单独建层。

建议：把转圈改为 HTML/CSS 合成动画（`transform: rotate` + `will-change`），或非当前会话不播动画，或去掉 dash 扫动。

## 第二部分：剩余成本来自运行期高频失效（尚未修复）

8 秒 tracing（2430 次样式失效 / 508 次布局失效）按原因聚合：

| 原因 | 次数 | 说明 |
|---|---|---|
| `DIV.BE0jCW_root` — Invalidation set invalidates subtree | **652** | 852x52、48 子节点的消息/工具调用行；class 变化触发整棵子树重算（约 81 次/秒） |
| `SPAN._sweep_` / `_highlight_` — Animation | **532** | 会话行 shimmer 扫光 |
| `Affected by :has()` | 331 | 宿主自带 ≥10 条 `:has()` 规则（气泡/上下文菜单/markdown/JSON 行） |
| `DIV.V4vHZW_flowItem` — Related style rule | 168 | 流式内容条目 |
| `BUTTON.SNx2jG_mark` — Added to layout | **114** | 轮次轨（28x522、45 节点）按钮反复重新加入布局（约 14 次/秒） |

同期 JS 仅约 1%（top: `get` 48ms、`QuotaStrip` 13ms）；dock 类插件的测量为 1 次/秒，均非热点。

单次样式重算成本实测 2–12ms（6788 节点、191 个样式表），因此上述失效频率足以吃掉主线程。

### 建议修复（按收益/代价排序）

1. **不要用 class 切换表达行状态**：`BE0jCW_root` 每次 class 变化都让整棵子树失效；改用 `data-*` + 更窄规则，或把状态类挂到叶子节点。
2. **轮次轨按钮复用而非重建**：`SNx2jG_mark` 反复 "Added to layout"；用稳定 key / 复用 DOM，或把标记做成伪元素。
3. **长转录区虚拟化**：或给历史消息加 `content-visibility: auto` + `contain-intrinsic-size`，把单次重算成本与 DOM 体积解耦。
4. **收窄 `:has()`**：左侧限定到具体容器，避免宽匹配触发全文档求值。
5. **shimmer 只在可视行启用**，或改成只动 `transform/opacity`。

## 复现步骤

```js
// CDP，target = dsh-app://app/
await send('Performance.enable'); await send('LayerTree.enable');
// 1) 壁钟与 paint
const a = await send('Performance.getMetrics');
await sleep(20000);
const b = await send('Performance.getMetrics');
// 对比 TaskDuration / LayoutDuration；LayerTree 事件里累加 paintCount 增量

// 2) 失效原因
await send('Tracing.start', {
  categories: 'devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking',
  transferMode: 'ReturnAsStream',
});
await sleep(8000);
await send('Tracing.end');
// tracingComplete → IO.read 循环读到 EOF → JSON.parse
// 统计 StyleRecalcInvalidationTracking / LayoutInvalidationTracking 的 args.data.reason
```

## 修复判据

- 20 秒窗口下 `paint` 增量从 4600 量级降到 100 量级；
- `StyleRecalcInvalidationTracking` 的 `BE0jCW_root` 子树失效从 652/8s 降到 <50/8s；
- `SNx2jG_mark` 的 "Added to layout" 从 114/8s 降到接近 0；
- 相同场景下 `TaskDuration` 占窗口比 <25%（当前实测可达 88%）。

## 附：本机已做的验证

- 第三方插件（dsh-panel-dock / dsh-ustc-quota / dsh-codex-advisor）合计成本 <7%，均已排除；
- 将状态点替换为合成动画后，原生 `spin/dash` 归零，主线程不再被其驱动——说明第一部分修法有效；
- 第二部分（652/532/114）与插件无关，属宿主实现。
