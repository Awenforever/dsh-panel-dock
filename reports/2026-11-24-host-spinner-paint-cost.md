# DSH 桌面版：running 会话的状态点动画导致 renderer 近满载（native 重光栅）

> 读者：DSH 上游维护者。用途：可直接作为 issue/discussion 正文。
> 环境：Windows 11、DSH 桌面版（Electron）、profile `desktop`、1920×983 CSS / dpr=1、当时 5 个会话 running。
> 测量手段：Electron 以 `--remote-debugging-port` 启动，CDP 连真实渲染进程；`Performance.getMetrics()` + `LayerTree` 的 `paintCount` 增量 + 逐动画 `pause()` 对照。**全部在用户真实窗口内完成，非 headless 模拟。**

## 现象

renderer 进程长期接近 100% 单核（Task Manager 实测 110–148%），GPU 另有 30–50%；界面滚动/输入明显卡。空闲（无 running 会话）时 renderer 只有 1–7%。

## 结论

**不是插件，也不是数据量。** 是侧栏每个 running 会话的状态点（SVG spinner）的**两个无限动画**，以及会话行的 shimmer：

| 动画 | 目标 | 属性 | 数量 |
|---|---|---|---|
| `_dsh-state-dot-spin_*` | `<g class="_spinnerMotion_*">` | `transform` | 每 running 会话 1 个 |
| `_dsh-state-dot-dash_*` | `<circle class="_spinnerArc_*">` | `stroke-dasharray` / `stroke-dashoffset` | 每 running 会话 1 个 |
| `_dsh-row-shimmer-sweep_*` / `-highlight_*` | 会话行 | 位移/背景 | 每 shimmer 行 2 个 |

全部 `iterations: Infinity`、`duration: 1500ms`。**SVG 子元素不会被提升为独立合成层**，因此每帧都在光栅化。

## 关键测量（真实窗口，20 秒窗口）

| 条件 | TaskDuration | Layout | Style | paint 次数 |
|---|---|---|---|---|
| 动画在跑 | **17731ms (88.7%)** | 1975ms | 1260ms | **4631** |
| 全部 `pause()` | 5745ms (28.7%) | 115ms | 629ms | 151 |

逐图层（20 秒内）：两个 `22×22` 小图层各被重绘 **2239 次（≈112 次/秒）**——就是转圈点；整窗 `1920×983` 图层 24 次。

CPU 采样（running 态 10 秒，共 10469ms）：`(program)` native **8307ms = 79.3%**、`(idle)` 9.3%、全部 JS 约 3%。

## 逐动画隔离（每档 12 秒，同一窗口）

| 操作 | Task | Layout | paint 次数 |
|---|---|---|---|
| 基线 | 11350ms | 988ms | 2931 |
| 只停 `row-shimmer`（6 个） | 11542ms | 1066ms | 3169 |
| 只停 `dot-spin`（2 个） | 7843ms | **11ms** | 3847 |
| 只停 `dot-dash`（2 个） | 11408ms | 1026ms | **27** |
| **全部停**（10 个） | **373ms** | 13ms | 26 |

读法：
- `dot-dash` 是 **paint 驱动**（2931 → 27，−99%），但主线程几乎不降；
- `dot-spin` 是 **layout 驱动**（988ms → 11ms，−99%），paint 反而更多；
- **两者叠加**才让主线程崩：全停 → 11350ms → 373ms（**−97%**）。

这也解释了为什么「只关 dash」的插件看起来无效（paint 掉了、CPU 没掉）。

## 为什么 CSS 补丁救不了

实测 `[class*=_spinnerMotion_]{will-change:transform;contain:layout paint}` 让 paint **上升**（2863 → 3280）：Chromium 不会为 SVG `<g>`/`<circle>` 单独建合成层，`will-change` 在此无效。**必须改宿主实现。**

## 建议的修法（按代价从低到高）

1. **把转圈换成 HTML/CSS 合成动画**：容器用 `div` + `border`/`conic-gradient` 的环，动画只用 `transform: rotate` 且 `will-change: transform`，可被合成器接管；SVG 仅保留静态图形。预计 paint 与 layout 同时归零。
2. **非当前会话不播动画**：侧栏只为「当前查看的会话」或最多 1 个会话显示动画点，其余显示静态点。改动最小，效果随 running 数线性下降。
3. **去掉 dash 扫动**：仅保留静止弧 + 一个 1.5s 的 opacity 呼吸（opacity 可合成）。可拿回 paint 的 99%，但 layout 仍受 spin 影响，需配合 1 或 2。
4. **`prefers-reduced-motion` 之外再加一个应用内开关**「减少动效」，让用户能一键关掉状态点动画。

## 复现步骤

1. 以 `--remote-debugging-port=9222` 启动 DSH，打开任意会话，让 ≥2 个会话处于 running；
2. CDP 连 `dsh-app://app/`，`Performance.enable` + `LayerTree.enable`；
3. 读 `Performance.getMetrics()` 的 TaskDuration/LayoutDuration，配合 `LayerTree` 的 `paintCount` 增量，观察 20 秒；
4. 执行 `document.getAnimations().forEach(a => a.pause())`，重复第 3 步对比。

## 修复判据

同样的 20 秒窗口下：`paint` 增量应从 4600 降到 100 量级，`TaskDuration` 从 ~17s 降到 ~1s；两个 `22×22` 图层的 `paintCount` 应停止增长（或该层被合成后不再产生 paint）。
