// Pure model of the band placement rules that client.js implements at runtime.
//
// client.js is the single source of truth (it runs inside the web client and cannot
// import this file), so this module exists to make those rules testable and to guard
// against silent drift: test/dock.test.js asserts both the behaviour below and that
// the constants still match the ones literally written in client.js.
//
// Since 0.6.0 there is no user-resizable width, no collapse flag and no persisted
// layout: the band is planned from what the window can afford on every frame.

export const GAP = 6
export const MIN_WIDTH_FLOOR = 120
export const MAX_COVER_RATIO = 0.5
export const MAX_PANEL_WIDTH = 480
export const DEFAULT_MIN_WIDTH = 280

// A view that hides its splitter keeps the element in the DOM at 0x0. Measuring it
// yields left/right = 0, which once dragged the band to the window corner; anchors
// only count when they have real area.
export function isVisibleAnchor(rect) {
  return Boolean(rect) && rect.width > 0 && rect.height > 0
}

// The turn rail is a column of buttons. Short conversations have few of them, but
// they still share one x; a single stray button (轨迹/看板 leave one floating) must
// not be mistaken for the rail.
export function railColumn(marks) {
  const list = Array.isArray(marks) ? marks.filter((m) => m && Number.isFinite(m.left)) : []
  if (!list.length) return null
  const groups = []
  for (const mark of list) {
    const group = groups.find((g) => Math.abs(g.left - mark.left) <= 2)
    if (group) {
      group.count += 1
      group.right = Math.max(group.right, mark.right || mark.left)
    } else {
      groups.push({ left: mark.left, right: mark.right || mark.left, count: 1 })
    }
  }
  const columns = groups.filter((g) => g.count >= 4).sort((x, y) => (y.count - x.count) || (x.left - y.left))
  if (columns.length) return columns[0]
  const short = groups.filter((g) => g.count >= 2).sort((x, y) => (y.count - x.count) || (x.left - y.left))
  return short.length ? short[0] : null
}

// A main-area page (Memory, settings, a plugin panel, 轨迹/看板) has no conversation
// column to measure, so the band is laid out against the page content boundary.
export function pagePlan(anchors, required, top, options) {
  const opts = options || {}
  const vw = Number.isFinite(opts.vw) ? opts.vw : 0
  const last = Number.isFinite(opts.lastWidth) ? opts.lastWidth : 0
  const limit = Math.min(vw, anchors && anchors.areaRight ? anchors.areaRight : vw) - GAP
  const desired = Math.min(MAX_PANEL_WIDTH, Math.max(required, last || required))
  let width = desired
  const contentRight = anchors && Number.isFinite(anchors.pageRight) ? anchors.pageRight : null
  if (contentRight !== null) {
    const gutter = vw - contentRight - GAP * 2
    if (gutter >= required) width = Math.min(desired, gutter)
  }
  return { mode: 'page', top, rightEdge: limit, width, limit }
}

export function planBand(anchors, required, options) {
  const opts = options || {}
  const vw = Number.isFinite(opts.vw) ? opts.vw : 0
  const limit = Math.min(vw, anchors && anchors.areaRight ? anchors.areaRight : vw) - GAP
  const hasSurface = Boolean(anchors) && (
    anchors.tabsSeen === true
    || Number.isFinite(anchors.handleRight)
    || Number.isFinite(anchors.areaRight)
    || Number.isFinite(anchors.railRight)
  )
  if (!hasSurface) return pagePlan(anchors, required, (anchors && anchors.pageTop) || 56, opts)
  const hasRail = Boolean(anchors) && Number.isFinite(anchors.railRight)
  // 轨迹 / 看板 are conversation views with tabs but no turn rail: stay on the same
  // right edge, at the conversation own top, with the familiar width.
  if (!hasRail && anchors && anchors.tabsSeen === true) {
    return pagePlan(anchors, required, anchors.top || 8, opts)
  }
  const innerRight = anchors && Number.isFinite(anchors.right) ? anchors.right : limit
  const inner = anchors && Number.isFinite(anchors.left) ? innerRight - anchors.left : null
  if (inner !== null && inner >= required) {
    return { mode: 'inner', left: anchors.left, width: Math.min(inner, MAX_PANEL_WIDTH), limit }
  }
  const outer = hasRail ? limit - (anchors.railRight + GAP) : null
  if (outer !== null && outer >= required) {
    return { mode: 'outer', rightEdge: limit, width: Math.min(outer, MAX_PANEL_WIDTH), limit }
  }
  // No whitespace fits: take the minimum out of the transcript, but never cover more
  // than half of the conversation column -- past that the card belongs in the sidebar.
  const column = anchors && anchors.areaRight && anchors.areaLeft
    ? Math.max(1, anchors.areaRight - anchors.areaLeft)
    : Math.max(1, vw - 2 * GAP)
  if (required > column * MAX_COVER_RATIO) return { mode: 'fallback', width: 0, limit }
  return { mode: 'intrude', rightEdge: limit, width: required, limit }
}

// Effective side: the panel declares a preference, the user can move it, and a
// band that cannot exist (fallback) sends right-preferring cards to the left stack.
export function sideOf(preferred, userSide, fallback) {
  const base = userSide === 'left' || userSide === 'right' ? userSide : preferred
  if (base === 'right' && fallback) return 'left'
  return base === 'left' ? 'left' : 'right'
}
