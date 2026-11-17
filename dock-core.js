export const DEFAULT_WIDTH = 320
export const MIN_WIDTH = 200
export const MAX_WIDTH = 720
export const STORE_KEY = 'dsh.panel-dock.v1'

export function clampWidth(width) {
  const value = Number(width)
  if (!Number.isFinite(value)) return DEFAULT_WIDTH
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)))
}

export function heightStyle(height) {
  if (height === 'fill') return { flex: '1 1 0' }
  if (height === 'auto') return { flex: '0 0 auto' }
  const px = Number(height)
  if (!Number.isFinite(px) || px <= 0) return { flex: '1 1 0' }
  return { flex: '0 0 ' + Math.round(px) + 'px' }
}

export function normalizePanels(panels) {
  const list = Array.isArray(panels) ? panels.slice() : []
  return list.sort((a, b) => {
    const ao = Number.isFinite(a.order) ? a.order : 100
    const bo = Number.isFinite(b.order) ? b.order : 100
    if (ao !== bo) return ao - bo
    return String(a.id).localeCompare(String(b.id))
  })
}

export function defaultLayout() {
  return { width: DEFAULT_WIDTH, collapsed: {} }
}

export function parseLayout(raw) {
  if (typeof raw !== 'string' || raw === '') return defaultLayout()
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { return defaultLayout() }
  if (!parsed || typeof parsed !== 'object') return defaultLayout()
  const collapsed = {}
  if (parsed.collapsed && typeof parsed.collapsed === 'object') {
    for (const key of Object.keys(parsed.collapsed)) collapsed[key] = parsed.collapsed[key] === true
  }
  return { width: clampWidth(parsed.width), collapsed }
}

export function serializeLayout(layout) {
  return JSON.stringify({ width: clampWidth(layout && layout.width), collapsed: Object.assign({}, (layout && layout.collapsed) || {}) })
}

export function isCollapsed(layout, id) {
  return Boolean(layout && layout.collapsed && layout.collapsed[id] === true)
}

export function toggleCollapsed(layout, id) {
  const next = { width: clampWidth(layout && layout.width), collapsed: Object.assign({}, (layout && layout.collapsed) || {}) }
  next.collapsed[id] = next.collapsed[id] !== true
  return next
}

export function visiblePanels(panels, layout) {
  return normalizePanels(panels).filter((panel) => panel && typeof panel.id === 'string')
}
