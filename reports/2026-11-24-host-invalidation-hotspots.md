# 补充报告：running 态下的样式/布局失效热点（invalidation tracing）

> 读者：DSH 上游维护者。用途：作为 2026-11-24-host-spinner-paint-cost.md 的第二部分。
> 方法：CDP Tracing.start，categories = devtools.timeline + disabled-by-default-devtools.timeline.invalidationTracking，采样 8 秒，串流读取后按 args.data.reason 聚合。
> 设备：1920x983 CSS / dpr=1，6788 个 DOM 节点，转录区滚动高度 26703px。

## 为什么用失效追踪而不是 CPU 百分比

同一状态下连续 8 次 15–20 秒窗口，TaskDuration 占比在 15%–73% 之间波动（会话启停、流式内容、测量本身产生的节点都在变）。壁钟百分比不可比，但失效事件的原因计数稳定。下面所有数字都是「次数 / 8 秒」。

## 总量

| 项 | 数量 |
|---|---|
| trace 事件总数 | 256729 |
| 样式失效（StyleRecalcInvalidationTracking） | 2430 |
| 布局失效（LayoutInvalidationTracking） | 508 |

同期 JS 只占约 1%（profile top: get 48ms、QuotaStrip 13ms），所以是渲染管线问题，不是脚本。

## 按原因聚合（Top）

| 原因 | 次数 | 归属判断 |
|---|---|---|
| DIV.BE0jCW_root — Invalidation set invalidates subtree | 652 | 宿主。该节点 852x52、48 个子节点（消息/工具调用行），class 变化触发整棵子树重算，约 81 次/秒 |
| SPAN._sweep_ / SPAN._highlight_ — Animation | 532 | 宿主。会话行扫光（shimmer） |
| Affected by :has()（DIV / .V4vHZW_flowItem / .BE0jCW_root） | 331 | 主要是宿主自带 :has() 规则（实测 ≥10 条）；插件侧 1 条已收窄 |
| DIV.V4vHZW_flowItem — Related style rule | 168 | 宿主 |
| ::after — Animation | 177 | 第三方插件的合成指示器（paint 仅 4 次/12s，可忽略） |
| BUTTON.SNx2jG_mark — Added to layout | 114 | 宿主。轮次轨（28x522、45 节点）按钮反复重新加入布局，约 14 次/秒 |

## 结论

1. 状态点动画已不是主要成本（替换为合成动画后原生 spin/dash 为 0）。
2. 剩余成本来自运行期高频结构/样式变更：消息行 class 级子树失效（652）、轮次轨按钮重复入布局（114）、shimmer 动画（532）。
3. 成本随转录区体积放大：单次样式重算实测 2–12ms，文档 6788 节点、191 个样式表。

## 建议（按收益/代价排序）

1. 不要用 class 切换表达行状态：BE0jCW_root 每次 class 变化都让整棵子树失效。改用 data-* + 更窄规则，或把状态类挂到叶子节点。
2. 轮次轨按钮复用而非重建：SNx2jG_mark 反复 Added to layout。用稳定 key / 复用 DOM，或把标记做成伪元素。
3. 长转录区虚拟化：或给历史消息加 content-visibility: auto + contain-intrinsic-size，把单次重算成本与 DOM 体积解耦。
4. 收窄 :has()：把左侧限定到具体容器，避免宽匹配触发全文档求值。
5. shimmer 只在可视行启用，或改成只动 transform/opacity。

## 复现

CDP 连 dsh-app://app/：
- Tracing.start，categories = devtools.timeline,disabled-by-default-devtools.timeline.invalidationTracking，transferMode=ReturnAsStream
- 等 8 秒，Tracing.end，等 tracingComplete
- IO.read 循环读到 EOF，JSON.parse，按 args.data.reason 统计两类 InvalidationTracking 事件

## 一个诚实的限制

测量时本会话自身在跑回合（持续向转录区追加内容），所以绝对次数包含测试者自身负载；但原因分布不受影响，可直接用于定位。
