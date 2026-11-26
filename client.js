window.__ModuleLoader__.load({
  id: 'dsh-panel-dock',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // Portals are how a card survives being moved between the sidebar and the band.
    // The loader exposes react-dom (dshmarket relies on it); if a host ever does not,
    // the dock falls back to the plain two-host rendering instead of failing.
    const createPortal = (() => {
      try {
        const dom = require('react-dom')
        return dom && typeof dom.createPortal === 'function' ? dom.createPortal : null
      } catch { return null }
    })()

    // dsh-panel-dock is a slot negotiation layer, not a UI of its own: plugins
    // register a card here and the dock decides where it renders. It never adds a
    // navigation entry, a button or a dialog -- the only affordances belong to the
    // cards themselves.
    const VERSION = '0.8.6'
    const NS = 'panel-dock'
    const STORE_KEY = 'dsh.panel-dock.v1'
    const GAP = 6
    const STACK_GAP = GAP
    // Cards own their shadow, and a scroll container clips at its padding box. So the
    // band only becomes a scroll container when the cards no longer fit the column,
    // and then it grows by the shadow's reach and pads the same amount back.
    const SHADOW_GUTTER = 16
    // The panel declares the width below which its own content is no longer useful
    // (`minWidth` in define()). The dock never renders it narrower than that, and when
    // the whitespace is short it takes exactly the missing pixels out of the transcript.
    // 280 is the default because it is measured, not guessed: at 280 both shipped cards
    // render every value in full, while at 264 the quota card already cuts its 24h column
    // to "35.2/1..." and at 200 it cuts 19 elements.
    const DEFAULT_MIN_WIDTH = 280
    // Nothing is drawn narrower than this, whatever a panel declares.
    const MIN_WIDTH_FLOOR = 120
    // A card wider than this stops reading as a card; the band may be wider than the
    // card and the surplus stays with the conversation.
    const MAX_PANEL_WIDTH = 480
    // A card may eat into the conversation, but not more than half of it: past that the
    // card belongs in the sidebar stack instead of on top of the text.
    const MAX_COVER_RATIO = 0.5
    // A conversation switch tears the transcript down and rebuilds it, so for a few frames
    // the turn rail has no marks at all. Remembering where it was keeps the band's width
    // stable across that gap instead of letting inner mode collapse to intrude.
    const RAIL_MEMORY_MS = 1500
    let railMemory = null
    // The band must not clip: any scroll container turns its children's box-shadow into
    // a hard-edged rectangle. Cards own their shadow, and it has to fall naturally the
    // way it does in the sidebar.

    const zh = { bandUnavailable: '此页无对话区',
      empty: '暂无面板', toLeft: '移到左侧', toRight: '移到右侧', cardCrashed: '渲染失败（已隔离）',
    }
    const en = { bandUnavailable: 'No conversation on this page',
      empty: 'No panels yet', toLeft: 'Move to the left panel', toRight: 'Move to the right panel',
      cardCrashed: 'failed to render (isolated)',
    }
    let T = (key) => key

    // The registry lives on the window, not in this module's closure: a hot reload of
    // the dock creates a fresh closure while the panels keep their existing
    // registrations -- wiping them would silently empty both docks.
    const registry = (() => {
      const existing = typeof window === 'undefined' ? null : window.__dshPanelDockRegistry
      const map = existing instanceof Map ? existing : new Map()
      if (typeof window !== 'undefined') window.__dshPanelDockRegistry = map
      return map
    })()
    const listeners = (() => {
      const existing = typeof window === 'undefined' ? null : window.__dshPanelDockListeners
      const set = existing instanceof Set ? existing : new Set()
      if (typeof window !== 'undefined') window.__dshPanelDockListeners = set
      return set
    })()

    function emit() { for (const fn of listeners) { try { fn() } catch {} } }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
    // Stacking order: `order` ascending (missing = 100), ties keep registration order.
    // Registration order alone made a card's position depend on which plugin happened to
    // activate first -- nothing a card could reason about or fix from its own side.
    function orderOf(panel) {
      const value = Number(panel.order)
      return Number.isFinite(value) ? value : 100
    }
    function panels() {
      // Array.prototype.sort is stable, so equal orders keep the Map's registration order.
      return [...registry.values()].sort((a, b) => orderOf(a) - orderOf(b))
    }

    function readSides() {
      try {
        const raw = window.localStorage.getItem(STORE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        const source = parsed && typeof parsed.sides === 'object' && parsed.sides ? parsed.sides : {}
        const sides = {}
        for (const id of Object.keys(source)) {
          const side = source[id]
          if (side === 'left' || side === 'right') sides[id] = side
        }
        return sides
      } catch { return {} }
    }

    function writeSides(sides) {
      try { window.localStorage.setItem(STORE_KEY, JSON.stringify({ sides })) } catch {}
    }

    function sideOf(id, fallback) {
      const sides = readSides()
      if (sides[id] === 'left' || sides[id] === 'right') return sides[id]
      return fallback === 'right' ? 'right' : 'left'
    }

    function setSide(id, side) {
      const next = side === 'right' ? 'right' : 'left'
      const sides = readSides()
      sides[id] = next
      writeSides(sides)
      emit()
      return next
    }

    function toggleSide(id) {
      const panel = registry.get(id)
      const current = sideOf(id, panel ? panel.side : 'left')
      return setSide(id, current === 'right' ? 'left' : 'right')
    }

    function define(definition) {
      if (!definition || typeof definition.id !== 'string' || definition.id === '') {
        throw new Error('panel-dock: define() needs a non-empty id')
      }
      if (typeof definition.component !== 'function') {
        throw new Error('panel-dock: define(' + definition.id + ') needs a component')
      }
      // minWidth is the panel's own statement of "below this my content stops being
      // useful". The dock honours it as the width it will never undercut, taking the
      // difference out of the transcript only when there is no whitespace left.
      const declared = Number(definition.minWidth)
      const minWidth = Number.isFinite(declared) && declared > 0
        ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_WIDTH_FLOOR, Math.round(declared)))
        : DEFAULT_MIN_WIDTH
      // version is what a shared CardShell shows next to the title; it is the plugin's
      // own version, not the dock's.
      const version = typeof definition.version === 'string' || typeof definition.version === 'number'
        ? String(definition.version)
        : null
      revisions.set(definition.id, revisionOf(definition.id) + 1)
      // frame: the dock owns the visible rectangle (background, border, radius, padding,
      // shadow) for every card. Default ON since 0.8.0 -- three cards each painting their
      // own surface is how three cards end up in three different greys and shadows.
      // A card that genuinely needs its own box opts out with frame: false.
      // frameDeclared separates "said false" from "defaulted false": the registry lives on
      // window and survives client reloads, so records written by 0.7.x carry the old
      // default (false) and would otherwise keep their own surface forever.
      const frameDeclared = definition.frame === true || definition.frame === false
      const frame = frameDeclared ? definition.frame === true : true
      // Keep the exact record so the disposer can tell "mine" from "a newer one's".
      const stored = Object.assign({}, definition, { minWidth, version, frame, frameDeclared })
      registry.set(definition.id, stored)
      emit()
      return () => {
        // HMR race: when a module reloads, the new instance defines first and the old
        // one disposes second. Deleting by id alone would remove the *new* registration
        // and leave the card defined nowhere. Only remove the record we created.
        if (registry.get(definition.id) !== stored) return
        registry.delete(definition.id)
        emit()
      }
    }

    function useRegistry() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return panels()
    }

    // Effective surface ownership. Records written before 0.8.0 have no frameDeclared and
    // a defaulted `frame: false`; they must follow the new default rather than keep it.
    function frameEnabled(panel) {
      if (!panel) return false
      if (panel.frameDeclared === true) return panel.frame === true
      if (panel.frameDeclared === false) return true
      return true
    }

    // Cards that opt in with `frame: true` hand the rectangle to the dock: one token set,
    // one radius, one border, so three cards cannot end up in three different greys. The
    // default stays off -- the dock must not repaint a card that draws itself.
    const FRAME_STYLE = {
      boxSizing: 'border-box',
      width: '100%',
      minWidth: 0,
      padding: '10px 9px 8px',
      borderRadius: 12,
      border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08))',
      background: 'var(--dsw-specific-sidebar-fill, rgba(249,250,251,1))',
      color: 'var(--dsw-alias-label-primary, inherit)',
      // Surface is the dock's business as of 0.8.0: one background, one border, one
      // radius, one shadow for every card. Values are the ones the cards themselves used
      // to write (Codex Advisor's shadow, measured: 0 3px 12px rgba(0,0,0,.16)); they are
      // the user's pick, so changing them needs the user, not a passing maintainer.
      boxShadow: '0 3px 12px 0 rgba(0,0,0,0.16)',
    }

    // A panel owns its own rectangle: the dock passes sizing through `style` and the
    // component must spread it onto its single root element.
    function renderPanel(panel) {
      const card = h(panel.component, {
        key: panel.id,
        active: true,
        'data-panel-dock-item': panel.id,
        style: {
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
          // Cards carry their own sidebar-footer layout (flex basis, order, margins).
          // Inside a dock those must not leak: the dock owns placement and spacing.
          flex: '0 0 auto',
          order: 0,
          margin: 0,
          pointerEvents: 'auto',
        },
      })
      if (!frameEnabled(panel)) return card
      return h('div', {
        'data-panel-dock-frame': panel.id,
        style: Object.assign({}, FRAME_STYLE, { display: 'flex', flexDirection: 'column' }),
      }, card)
    }

    // Left panels live in the sidebar footer, in registration order.
    function LeftHost() {
      const layout = useRegistry()
      // No room on the right (narrow conversation, or the right sidebar is open): a card
      // reads better here than squeezed over the transcript.
      const items = layout.filter((panel) => placement.fallback || sideOf(panel.id, panel.side) === 'left')
      if (items.length === 0) return null
      return h('div', {
        'data-panel-dock-left': '',
        style: {
          display: 'flex',
          flexDirection: 'column',
          gap: STACK_GAP,
          // The host footer is a nowrap flex row; claim it and refuse to shrink,
          // otherwise the stack collapses to a sliver of a few pixels.
          flex: '0 0 100%',
          width: '100%',
          minWidth: 0,
          boxSizing: 'border-box',
        },
      }, items.map((panel) => h(CardBoundary, {
        key: panel.id + ':' + revisionOf(panel.id),
        id: panel.id,
        fallback: () => errorCard(panel),
      }, renderPanel(panel))))
    }

    // Geometry of the right strip: between the transcript drag handle and the turn
    // navigator, starting under the conversation tabs. Both anchors belong to the
    // shipped layout, so they are measured rather than assumed.
    function measureAnchors() {
      if (typeof document === 'undefined') return null
      const box = (el) => el.getBoundingClientRect()
      let left = null
      let right = null
      let top = 8
      let handleRight = null
      let handleLeft = null
      let railRight = null
      let areaRight = null
      let areaLeft = null
      let railInfo = null
      let tabsSeen = false
      let pageRight = null
      let pageTop = 0
      try {
        // Views such as 轨迹/看板 keep the splitter in the DOM at 0x0 while it is not
        // shown. Measuring it yields `left:0/right:0`, which used to drag the band to the
        // top-left corner. Only a splitter with real area is an anchor.
        const handles = [...document.querySelectorAll('[class*="widthHandle"]')]
          .filter((el) => el.getAttribute('data-side') === 'right')
          .filter((el) => { const r = box(el); return r.width > 0 && r.height > 0 })
        const handle = handles[0]
        if (handle) {
          handleRight = Math.round(box(handle).right)
          // The splitter is the only way to widen the conversation back: a squeezed
          // card must stop at its left edge instead of swallowing it.
          handleLeft = Math.round(box(handle).left)
          left = handleRight + GAP
        }
        // The turn rail sits to the right of the band; other turn-navigation buttons live
        // on its left edge. Keep the smallest x that is still right of the handle -- a wide
        // conversation can leave only a few pixels, so the tolerance has to stay small.
        const railMarks = [...document.querySelectorAll('button[aria-label]')]
          .filter((el) => /turnNavigation|轮次|跳转/i.test(el.getAttribute('aria-label') || ''))
          .filter((el) => { const r = box(el); return r.width > 0 && r.height > 0 })
          .map((el) => ({ left: Math.round(box(el).left), right: Math.round(box(el).right) }))
          // Everything to the right of the handle belongs to the rail side; a squeezed
          // band can leave the rail a single pixel right of the handle.
          .filter((mark) => handleRight === null || mark.left > handleRight)
        const rail = railColumn(railMarks)
        railInfo = rail !== null ? { right: rail.left - GAP, railRight: rail.right } : null
        const pageTabs = document.querySelector('[role="tablist"]')
        if (pageTabs) {
          const pr = box(pageTabs)
          if (pr.width > 0) pageTop = Math.round(pr.bottom) + GAP
          // An arbitrary main-area page decides its own content width. Climb from its tab
          // strip to the first ancestor that no longer spans the window: that edge is the
          // page's content boundary, and the gutter right of it is where the band belongs.
          let node = pageTabs.parentElement
          while (node && node !== document.body) {
            const r = box(node)
            if (r.width > 0 && r.height > 40 && r.right < window.innerWidth - 2) {
              pageRight = Math.round(r.right)
              break
            }
            node = node.parentElement
          }
        }
        const tabs = document.querySelector('[data-conversation-tabs]')
        tabsSeen = Boolean(tabs)
        if (tabs) {
          top = Math.round(box(tabs.parentElement || tabs).bottom) + GAP
          // The right sidebar (开始 / 终端 / 浏览器) owns the window's right side. The column
          // that holds the tabs is the conversation area: climb to the outermost ancestor
          // that still ends where the column ends (the tab strip itself is padded, so it
          // is skipped), and take that edge as the hard limit.
          let node = tabs.parentElement
          let columnRight = null
          while (node && node !== document.body) {
            const rect = box(node)
            if (rect.width === 0 || rect.height < 40) { node = node.parentElement; continue }
            if (columnRight === null) columnRight = rect.right
            else if (Math.abs(rect.right - columnRight) > 3) break
            node = node.parentElement
          }
          if (columnRight !== null && columnRight < window.innerWidth - 2) {
            areaRight = Math.round(columnRight)
            areaLeft = Math.round(box(tabs).left)
            let up = tabs.parentElement
            while (up && up !== document.body) {
              const r = box(up)
              if (r.width > 0 && r.height >= 40 && Math.abs(r.right - columnRight) <= 3) areaLeft = Math.round(r.left)
              up = up.parentElement
            }
          }
        }
        if (railInfo !== null) {
          right = railInfo.right
          railRight = railInfo.railRight
          railMemory = { right, railRight, handleRight, areaRight, at: Date.now() }
        } else if (
          railMemory !== null
          && Date.now() - railMemory.at < RAIL_MEMORY_MS
          && railMemory.handleRight === handleRight
          && railMemory.areaRight === areaRight
        ) {
          // Same window geometry, rail momentarily missing: keep the last known rail.
          right = railMemory.right
          railRight = railMemory.railRight
        }
      } catch {}
      return { left, right, top, handleLeft, handleRight, railRight, areaRight, areaLeft, pageTop, tabsSeen, pageRight }
    }

    function sameAnchors(a, b) {
      if (!a || !b) return a === b
      return a.left === b.left && a.right === b.right && a.top === b.top
        && a.handleLeft === b.handleLeft && a.handleRight === b.handleRight
        && a.railRight === b.railRight && a.areaRight === b.areaRight && a.areaLeft === b.areaLeft
    }

    // What the cards want, gap included.
    function stackedHeight(el) {
      const kids = [...el.children]
      let total = 0
      for (const kid of kids) total += kid.getBoundingClientRect().height
      return total + STACK_GAP * Math.max(0, kids.length - 1)
    }

    // The turn rail is a *column*: dozens of marks share one x. Message-level actions
    // ("跳转到该消息", ...) match the same words but stand alone, and one of them sitting
    // left of the rail used to drag the whole band left with it -- cards then rendered
    // at the 200px floor while their real whitespace stayed empty. Pick the column.
    function railColumn(marks) {
      if (!marks.length) return null
      const groups = []
      for (const mark of marks) {
        const group = groups.find((g) => Math.abs(g.left - mark.left) <= 2)
        if (group) {
          group.count += 1
          group.right = Math.max(group.right, mark.right)
        } else {
          groups.push({ left: mark.left, right: mark.right, count: 1 })
        }
      }
      const columns = groups.filter((g) => g.count >= 4).sort((a, b) => (b.count - a.count) || (a.left - b.left))
      if (columns.length) return columns[0]
      // A short conversation has few marks, but they still share one x. A *single* mark is
      // usually an unrelated "跳转" button floating in the view (轨迹/看板 do that): treating
      // it as the rail put the band at x≈6. Require at least two marks in one column.
      const short = groups.filter((g) => g.count >= 2).sort((a, b) => (b.count - a.count) || (a.left - b.left))
      return short.length ? short[0] : null
    }

    // Where right-side cards can live: the gutter left of the turn rail, the gutter right
    // of it, or -- when neither can hold a readable card -- back in the sidebar stack.
    // A card squeezed over the transcript is not an option: it hides text to buy a width
    // that is still too small to read.
    const placement = { fallback: false }
    function setFallback(next) {
      if (placement.fallback === next) return
      placement.fallback = next
      emit()
    }

    // `required` is the widest minimum any right-side card declared: the band is one
    // column, so it has to satisfy the most demanding card in it.
    // Kept so a main-area page shows the card at the same width it had beside the
    // conversation: dropping to `required` there made the card visibly jump narrower.
    let lastPlannedWidth = 0
    // Switching conversations unmounts the turn rail for a moment ("载入历史…"). Treating
    // that as "no conversation surface" flung the band to the window edge and pulled it
    // back once loading finished -- the shrink-then-expand the user sees. Keep the last
    // anchored plan through that gap instead of re-deciding on a half-built page.
    const STICKY_PLAN_MS = 2500
    let lastAnchoredPlan = null
    let lastAnchoredAt = 0

    // A main-area page (Memory, settings, a plugin panel, 轨迹/看板) has no conversation
    // column to measure, so the band is laid out against the page's own content boundary:
    // sit in the gutter right of the content when it is wide enough, otherwise take only
    // the minimum width so as little content as possible is covered.
    function pagePlan(anchors, required, top) {
      const vw = typeof window === 'undefined' ? 0 : window.innerWidth
      const limit = Math.min(vw, anchors && anchors.areaRight ? anchors.areaRight : vw) - GAP
      const desired = Math.min(MAX_PANEL_WIDTH, Math.max(required, lastPlannedWidth || required))
      const contentRight = anchors && anchors.pageRight ? anchors.pageRight : null
      // Default to the width the band had beside the conversation, so switching between a
      // page and a conversation does not visibly resize the card.
      let width = desired
      if (contentRight !== null) {
        const gutter = vw - contentRight - GAP * 2
        // Only a real gutter may shrink it; a full-width page has nowhere to put the band,
        // so keep the familiar width and let the hover dim signal what it covers.
        if (gutter >= required) width = Math.min(desired, gutter)
      }
      return { mode: 'page', pageTop: top, rightEdge: limit, width, limit }
    }

    function planBand(anchors, required) {
      const vw = typeof window === 'undefined' ? 0 : window.innerWidth
      const areaEdge = Math.min(vw, anchors && anchors.areaRight ? anchors.areaRight : vw)
      const limit = areaEdge - GAP
      // The band only makes sense beside a conversation. Other main-area surfaces (a plugin
      // panel, settings) have no conversation column, no splitter and no turn rail -- with no
      // surface to dock against, the band used to pin itself to the window top-right corner and
      // cover that page. Fall back to the sidebar stack instead.
      const hasSurface = Boolean(anchors) && (
        anchors.tabsSeen === true
        || (anchors.handleRight !== null && anchors.handleRight !== undefined)
        || (anchors.areaRight !== null && anchors.areaRight !== undefined)
        || (anchors.railRight !== null && anchors.railRight !== undefined)
      )
      if (!hasSurface) {
        const t = (anchors && anchors.pageTop) || 56
        return pagePlan(anchors, required, t)
      }
      const hasRail = Boolean(anchors) && anchors.railRight !== null && anchors.railRight !== undefined
      // 轨迹 / 看板 / Codex are conversation views without a turn rail: they keep the band
      // flush to the right edge. But a *conversation* also loses its rail for a moment
      // while history loads, and that is not a view change -- reuse the anchored plan for
      // a short window so the band does not jump to the edge and back.
      if (!hasRail && anchors !== null && anchors.tabsSeen === true) {
        const now = Date.now()
        if (lastAnchoredPlan && now - lastAnchoredAt < STICKY_PLAN_MS) return lastAnchoredPlan
        return pagePlan(anchors, required, anchors.top || 8)
      }
      // A conversation without turns has no rail yet. That is not "no space": the column
      // simply runs to its own right edge, and that edge is the boundary the band must
      // respect. Treating the missing rail as a wall collapsed the band into the sidebar
      // for the first frames of every new conversation, then brought it back when the
      // rail appeared -- the "shrink in and come back" the user saw.
      const innerRight = anchors && anchors.right !== null ? anchors.right : limit
      const inner = anchors && anchors.left !== null ? innerRight - anchors.left : null
      // The whitespace is used where it exists.
      const remember = (plan) => {
        lastAnchoredPlan = plan
        lastAnchoredAt = Date.now()
        if (plan.width) lastPlannedWidth = plan.width
        return plan
      }
      if (inner !== null && inner >= required) {
        return remember({ mode: 'inner', left: anchors.left, width: Math.min(inner, MAX_PANEL_WIDTH), limit })
      }
      const outer = hasRail ? limit - (anchors.railRight + GAP) : null
      if (outer !== null && outer >= required) {
        return remember({ mode: 'outer', rightEdge: limit, width: Math.min(outer, MAX_PANEL_WIDTH), limit })
      }
      // No whitespace wide enough: take the minimum a card needs out of the transcript,
      // and only that much. The card sits flush with the conversation column so it takes
      // the least possible text out of view; covering the turn rail is accepted.
      const rightEdge = limit
      const column = anchors && anchors.areaRight && anchors.areaLeft
        ? Math.max(1, anchors.areaRight - anchors.areaLeft)
        : Math.max(1, areaEdge)
      // The card may cover at most half of the conversation column.
      if (required > column * MAX_COVER_RATIO) return { mode: 'fallback', width: 0, limit }
      return remember({ mode: 'intrude', rightEdge, width: required, limit })
    }

    function RightHost() {
      const all = useRegistry()
      const [anchors, setAnchors] = React.useState(() => measureAnchors())
      const [scrolls, setScrolls] = React.useState(false)
      const stack = React.useRef(null)
      const measureStack = React.useRef(() => {})

      React.useEffect(() => {
        let raf = 0
        const sync = () => {
          raf = 0
          const next = measureAnchors()
          // measureAnchors() builds a fresh object on every tick; keep the previous one
          // while nothing moved, otherwise every card re-renders four times a second.
          setAnchors((prev) => (sameAnchors(prev, next) ? prev : next))
          // The tick also re-checks the stack: a minimised or occluded window holds
          // ResizeObserver notifications back far longer than the user can see.
          measureStack.current()
        }
        const schedule = () => { if (!raf) raf = requestAnimationFrame(sync) }
        window.addEventListener('resize', schedule)
        const timer = setInterval(schedule, 700)
        return () => {
          window.removeEventListener('resize', schedule)
          clearInterval(timer)
          if (raf) cancelAnimationFrame(raf)
        }
      }, [])

      const items = all.filter((panel) => sideOf(panel.id, panel.side) === 'right')
      // Default 280 applies only to a panel that declared nothing; a panel that says it
      // can live with 160 gets 160, so it never takes more text than it needs.
      const required = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_WIDTH_FLOOR,
        items.reduce((widest, panel) => Math.max(widest, panel.minWidth || DEFAULT_MIN_WIDTH), 0)))
      const plan = planBand(anchors, required)
      const top = plan.mode === 'page' ? plan.pageTop : (anchors ? anchors.top : 8)

      // Publish the decision so the sidebar stack can take the cards over.
      React.useEffect(() => { setFallback(plan.mode === 'fallback') })

      // A stack that fits stays a plain, non-clipping column, because a card may draw
      // outside its own box (its shadow). Scroll only when the cards exceed the column.
      // Cards reach their real height asynchronously (data arrives after mount), and
      // that never re-renders the dock -- so watch the cards themselves.
      React.useEffect(() => {
        const el = stack.current
        const measure = () => {
          if (!el) { setScrolls(false); return }
          const column = Math.max(0, window.innerHeight - 8 - top)
          const next = stackedHeight(el) > column + 0.5
          setScrolls((prev) => (prev === next ? prev : next))
        }
        measureStack.current = measure
        measure()
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        for (const kid of el.children) observer.observe(kid)
        return () => { observer.disconnect(); measureStack.current = () => {} }
      }, [items.length, top])

      // An empty column must cost nothing: no panels, no strip, no reserved width.
      // The same goes for a column the band cannot hold: the cards moved to the sidebar.
      if (items.length === 0 || plan.mode === 'fallback') return null

      const width = plan.width

      const style = {
        position: 'fixed',
        top,
        bottom: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: STACK_GAP,
        minWidth: 0,
        boxSizing: 'border-box',
        overflow: 'visible',
        // The band is a transparent overlay over the transcript's right margin: it
        // must not swallow clicks meant for the conversation behind it.
        pointerEvents: 'none',
        zIndex: 10000,
      }
      style.width = width
      if (plan.mode === 'inner') {
        // The gutter between the transcript handle and the turn rail.
        style.left = plan.left
      } else {
        // Right of the rail (or, before any conversation is measured, the area's edge).
        style.right = Math.max(GAP, window.innerWidth - plan.rightEdge)
      }

      if (scrolls) {
        // Grow the box by the shadow's reach, pad the same amount back, and only then
        // scroll. Every card keeps the exact rectangle it had; the scrollport's clip
        // line lands in the gutter instead of across a card's shadow.
        const gutter = SHADOW_GUTTER
        style.top = top - gutter
        style.height = Math.max(0, window.innerHeight - 8 - top) + gutter * 2
        style.bottom = 'auto'
        style.width = width + gutter * 2
        if (style.left !== undefined) style.left -= gutter
        if (style.right !== undefined) style.right -= gutter
        style.padding = gutter
        style.overflowY = 'auto'
        style.overflowX = 'hidden'
        // No scrollbar: it would sit in the gutter as a foreign affordance, and a
        // classic scrollbar would also narrow every card by its own width.
        style.scrollbarWidth = 'none'
      }

      return h('div', {
        'data-panel-dock-strip': '',
        'data-panel-dock-scrolls': scrolls ? '' : undefined,
        ref: stack,
        style,
      }, items.map((panel) => h(CardBoundary, {
        key: panel.id + ':' + revisionOf(panel.id),
        id: panel.id,
        fallback: () => errorCard(panel),
      }, renderPanel(panel))))
    }


    // ---- tray (portal transport) ----
    // Moving a card between the sidebar and the band must not remount it: a data card
    // would refetch and flash. So each card lives in a portal whose *container* is moved
    // in the DOM (appendChild / insertBefore) instead of being recreated. React keeps the
    // subtree mounted across a DOM move -- measured on a live card: content and data stay,
    // loading never flips back on.
    const tray = { cells: new Map(), leftSlot: null, leftStack: null, poke: null }

    function cellOf(id) {
      let el = tray.cells.get(id)
      if (!el) {
        el = document.createElement('div')
        el.setAttribute('data-panel-dock-cell', id)
        // The card is the visible rectangle; the cell is only a transport box.
        el.style.cssText = 'display:flex;flex-direction:column;flex:0 0 auto;min-width:0;pointer-events:none'
        tray.cells.set(id, el)
      }
      return el
    }

    function dropDeadCells(alive) {
      for (const [id, el] of [...tray.cells]) {
        if (alive.has(id)) continue
        if (el.parentNode) el.parentNode.removeChild(el)
        tray.cells.delete(id)
      }
    }

    // ---- deck: same-side cards as a stack (one full card + 24px peek strips) ----
    // Column behaviour up to 0.6.13 is a plain list. A deck trades height for order:
    // every rear card shows only its top strip and the wheel shuffles the front one.
    const DECK_PEEK = 24
    const DECK_KEY = 'dsh.panel-dock.deck'
    const deck = { on: null, front: { band: null, left: null }, order: { band: null, left: null }, resync: null, wheelAt: 0 }

    function deckOn() {
      if (deck.on === null) {
        try { deck.on = localStorage.getItem(DECK_KEY) === '1' } catch { deck.on = false }
      }
      return deck.on
    }

    function setDeckMode(next) {
      if (deckOn() === next) return
      deck.on = next
      try { localStorage.setItem(DECK_KEY, next ? '1' : '0') } catch {}
      if (deck.resync) deck.resync()
      if (tray.poke) tray.poke()
    }

    function deckKeyOf(container) {
      return container && container.hasAttribute('data-panel-dock-strip') ? 'band' : 'left'
    }

    function cellAt(container, index) {
      const cells = []
      for (const kid of container.children) {
        if (kid.hasAttribute && kid.hasAttribute('data-panel-dock-cell')) cells.push(kid)
      }
      return cells[index] || null
    }

    function deckBarOf(container) {
      for (const kid of container.children) {
        if (kid.hasAttribute && kid.hasAttribute('data-panel-dock-deck-bar')) return kid
      }
      return null
    }

    // The affordance is the card edge itself: a narrow strip that drops into a gradient
    // band with three travelling chevrons when the pointer arrives. It is absolutely
    // positioned so it never takes part in the column's flow.
    function ensureDeckBar(container) {
      let bar = deckBarOf(container)
      if (bar) return bar
      // The strip is positioned against this column: without a positioning context it
      // resolved against the viewport and sat at y=-6, off screen (measured).
      if (typeof getComputedStyle === 'function') {
        const position = getComputedStyle(container).position
        if (position === 'static') container.style.position = 'relative'
      }
      bar = document.createElement('div')
      bar.setAttribute('data-panel-dock-deck-bar', '')
      bar.setAttribute('role', 'button')
      bar.setAttribute('tabindex', '-1')
      bar.setAttribute('aria-label', '堆叠 / 并列')
      bar.setAttribute('title', '堆叠 / 并列')
      bar.appendChild(document.createElement('i'))
      bar.appendChild(document.createElement('i'))
      bar.appendChild(document.createElement('i'))
      bar.addEventListener('click', (event) => {
        event.preventDefault()
        event.stopPropagation()
        setDeckMode(!deckOn())
      })
      container.appendChild(bar)
      return bar
    }

    function rotateDeck(container, step) {
      const key = deckKeyOf(container)
      const order = deck.order[key]
      if (!order || order.length < 2) return
      const at = order.indexOf(deck.front[key])
      const from = at < 0 ? 0 : at
      const next = (from + step + order.length) % order.length
      deck.front[key] = order[next]
      if (deck.resync) deck.resync()
    }

    function wireDeckInput(container) {
      if (!container || container.__pdDeckWired) return
      container.__pdDeckWired = true
      container.addEventListener('wheel', (event) => {
        if (!deckOn()) return
        const key = deckKeyOf(container)
        const order = deck.order[key]
        if (!order || order.length < 2) return
        event.preventDefault()
        event.stopPropagation()
        const now = Date.now()
        if (now - deck.wheelAt < 130) return
        deck.wheelAt = now
        rotateDeck(container, event.deltaY > 0 ? 1 : -1)
      }, { passive: false })
      // A click on a rear card's strip promotes that card instead of reaching the card.
      container.addEventListener('pointerdown', (event) => {
        if (!deckOn()) return
        const key = deckKeyOf(container)
        const order = deck.order[key]
        if (!order || order.length < 2) return
        const box = container.getBoundingClientRect()
        const y = event.clientY - box.top
        const slot = Math.floor(y / DECK_PEEK)
        if (slot < 0 || slot >= order.length - 1) return
        const target = order[order.length - 1 - slot]
        event.preventDefault()
        event.stopPropagation()
        deck.front[key] = target
        if (deck.resync) deck.resync()
      }, true)
    }

    // Cards reach their real height asynchronously (data arrives after mount) and never
    // re-render the dock, so the deck height has to follow the front card's size.
    function refreshDeckHeight(container) {
      if (!container || !container.hasAttribute('data-panel-dock-deck')) return
      const key = deckKeyOf(container)
      const order = deck.order[key]
      if (!order || !order.length) return
      const front = tray.cells.get(order[0])
      if (!front) return
      const frontHeight = Math.round(front.getBoundingClientRect().height)
      if (!frontHeight) return
      const total = frontHeight + (order.length - 1) * DECK_PEEK
      const box = container.getBoundingClientRect()
      const room = box.top > 0 ? Math.max(0, Math.round(window.innerHeight - box.top - 8)) : 0
      const capped = room > 0 && total > room
      const next = (capped ? room : total) + 'px'
      if (container.style.height !== next) container.style.height = next
      const overflow = capped ? 'auto' : ''
      if (container.style.overflowY !== overflow) container.style.overflowY = overflow
    }

    function watchDeckCells(container) {
      if (!container || typeof ResizeObserver === 'undefined') return
      if (!container.__pdDeckObserver) {
        container.__pdDeckObserver = new ResizeObserver(() => refreshDeckHeight(container))
      }
      const observer = container.__pdDeckObserver
      const seen = container.__pdDeckSeen || new Set()
      for (const kid of container.children) {
        if (!kid.hasAttribute || !kid.hasAttribute('data-panel-dock-cell')) continue
        if (seen.has(kid)) continue
        seen.add(kid)
        observer.observe(kid)
      }
      container.__pdDeckSeen = seen
    }

    function syncDeck(container, ids, active) {
      if (!container) return
      wireDeckInput(container)
      const key = deckKeyOf(container)
      const usable = active && deckOn() && ids.length >= 2
      const bar = ensureDeckBar(container)
      if (!usable) {
        deck.order[key] = null
        container.removeAttribute('data-panel-dock-deck')
        container.style.height = ''
        bar.removeAttribute('data-panel-dock-deck-on')
        if (bar) {
          if (ids.length >= 2) bar.removeAttribute('data-panel-dock-hidden')
          else bar.setAttribute('data-panel-dock-hidden', '')
        }
        container.style.overflowY = ''
        container.style.flex = ''
        for (const id of ids) {
          const el = tray.cells.get(id)
          if (!el) continue
          el.style.position = ''
          el.style.left = ''
          el.style.right = ''
          el.style.top = ''
          el.style.transform = ''
          el.style.zIndex = ''
          el.style.clipPath = ''
        }
        return
      }
      container.setAttribute('data-panel-dock-deck', '')
      bar.setAttribute('data-panel-dock-deck-on', '')
      let front = deck.front[key]
      if (!front || ids.indexOf(front) < 0) front = ids[0]
      deck.front[key] = front
      const start = ids.indexOf(front)
      const order = ids.slice(start).concat(ids.slice(0, start))
      deck.order[key] = order
      let frontHeight = 0
      order.forEach((id, position) => {
        const el = tray.cells.get(id)
        if (!el) return
        el.style.position = 'absolute'
        el.style.left = '0'
        el.style.right = '0'
        el.style.top = '0'
        el.style.zIndex = String(200 - position)
        el.style.transform = 'translateY(' + ((order.length - 1 - position) * DECK_PEEK) + 'px)'
        // A rear card is only its strip: without clipping, a tall rear card would show
        // its bottom edge below a shorter front card (measured: 222px rear under a 170px
        // front in a 218px column).
        el.style.clipPath = position === 0
          ? ''
          : 'inset(0px 0px calc(100% - ' + DECK_PEEK + 'px) 0px)'
        if (position === 0) frontHeight = Math.round(el.getBoundingClientRect().height)
      })
      const total = frontHeight + (order.length - 1) * DECK_PEEK
      deck.frontHeights = deck.frontHeights || {}
      deck.frontHeights[key] = frontHeight
      const box = container.getBoundingClientRect()
      const room = box.top > 0 ? Math.max(0, Math.round(window.innerHeight - box.top - 8)) : 0
      // A deck taller than the column still has to be reachable; cap and scroll rather
      // than push the rear strips off the top of the screen.
      const capped = room > 0 && total > room
      container.style.height = total > 0 ? (capped ? room : total) + 'px' : ''
      container.style.overflowY = capped ? 'auto' : ''
      watchDeckCells(container)
      // The sidebar stack is a flex child sized to 100%; with an explicit height it has
      // to opt out or the host's basis wins.
      container.style.flex = container.hasAttribute('data-panel-dock-left') ? '0 0 auto' : ''
    }

    function leftStackNode() {
      if (!tray.leftStack) {
        const el = document.createElement('div')
        el.setAttribute('data-panel-dock-left', '')
        el.style.cssText = [
          'display:flex', 'flex-direction:column', 'gap:' + STACK_GAP + 'px',
          'flex:0 0 100%', 'width:100%', 'min-width:0', 'box-sizing:border-box',
        ].join(';')
        tray.leftStack = el
      }
      return tray.leftStack
    }

    // The sidebar column does not scroll on its own: the host lays it out with
    // overflow:visible and simply clips at the window edge, so a stack taller than the
    // space below it hides its last cards with no way to reach them (verified at
    // 1280x560: last card bottom 567 in a 560px viewport, no scrollable ancestor).
    // Cap the stack at the room that actually exists and let it scroll instead.
    function syncLeftStackScroll() {
      const el = tray.leftStack
      if (!el || !el.parentNode) return false
      const rect = el.getBoundingClientRect()
      if (rect.top <= 0 && rect.height === 0) return false
      const room = Math.max(0, Math.round(window.innerHeight - rect.top - 8))
      const over = el.scrollHeight > room + 0.5
      el.style.maxHeight = over ? room + 'px' : ''
      el.style.overflowY = over ? 'auto' : ''
      el.style.scrollbarWidth = over ? 'thin' : ''
      if (over) el.setAttribute('data-panel-dock-left-scrolls', '')
      else el.removeAttribute('data-panel-dock-left-scrolls')
      return over
    }

    // The sidebar half is only a placeholder: the tray moves the cell containers in.
    function LeftSlot() {
      const ref = React.useRef(null)
      React.useEffect(() => {
        tray.leftSlot = ref.current
        if (tray.poke) tray.poke()
        return () => { if (tray.leftSlot === ref.current) tray.leftSlot = null }
      }, [])
      return h('div', { 'data-panel-dock-left-slot': '', ref, style: { display: 'contents' } })
    }

    function TrayHost() {
      const all = useRegistry()
      const [anchors, setAnchors] = React.useState(() => measureAnchors())
      const [scrolls, setScrolls] = React.useState(false)
      const [, bump] = React.useState(0)
      const band = React.useRef(null)
      const measureStack = React.useRef(null)
      const lastPlacement = React.useRef({ left: [], right: [], inBand: false })

      React.useEffect(() => {
        tray.poke = () => bump((n) => n + 1)
        return () => { tray.poke = null }
      }, [])

      const right = all.filter((panel) => sideOf(panel.id, panel.side) === 'right')
      const needsBand = right.length > 0

      React.useEffect(() => {
        // Nothing lives on the right: the anchors are irrelevant, and measuring them is a
        // full-document scan plus ~20 layout reads. Polling that while every card sits in
        // the sidebar made the dock the busiest thing on the page for no benefit.
        if (!needsBand) {
          setAnchors(null)
          return undefined
        }
        let raf = 0
        const sync = () => {
          raf = 0
          const next = measureAnchors()
          setAnchors((prev) => (sameAnchors(prev, next) ? prev : next))
          if (measureStack.current) measureStack.current()
        }
        const schedule = () => { if (!raf) raf = requestAnimationFrame(sync) }
        schedule()
        window.addEventListener('resize', schedule)
        // The band's anchors move when the window resizes, when the right sidebar opens or
        // closes, or when the conversation column is dragged -- all of them resize the
        // column, so observing it replaces the old 700ms poll. The timer stays as a slow
        // safety net for anything that moves without changing the column's size.
        let observer = null
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(schedule)
        const tabs = document.querySelector('[data-conversation-tabs]')
          const column = tabs && (tabs.parentElement || tabs)
          if (column) observer.observe(column)
        }
        const timer = setInterval(schedule, 2500)
        return () => {
          window.removeEventListener('resize', schedule)
          if (observer) observer.disconnect()
          clearInterval(timer)
          if (raf) cancelAnimationFrame(raf)
        }
      }, [needsBand])

      const required = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_WIDTH_FLOOR,
        right.reduce((widest, panel) => Math.max(widest, panel.minWidth || DEFAULT_MIN_WIDTH), 0)))
      const plan = planBand(anchors, required)
      const top = plan.mode === 'page' ? plan.pageTop : (anchors ? anchors.top : 8)
      const inBand = plan.mode !== 'fallback' && right.length > 0
      React.useEffect(() => { setFallback(plan.mode === 'fallback') }, [plan.mode])

      // The wheel/click path must not wait for a React render: it re-applies the deck
      // straight from the last placement it knows about.
      React.useEffect(() => {
        deck.resync = () => {
          const last = lastPlacement.current
          if (tray.leftStack) syncDeck(tray.leftStack, last.left, true)
          if (band.current) syncDeck(band.current, last.right, last.inBand)
        }
        return () => { deck.resync = null }
      }, [])

      // Placement: every frame after render, put each cell into the stack that owns it.
      React.useEffect(() => {
        const alive = new Set(all.map((panel) => panel.id))
        dropDeadCells(alive)
        const wantLeft = []
        const wantRight = []
        for (const panel of all) {
          const side = sideOf(panel.id, panel.side)
          if (side === 'right' && inBand) wantRight.push(panel.id)
          else wantLeft.push(panel.id)
        }
        if (wantLeft.length && tray.leftSlot) {
          const stack = leftStackNode()
          if (stack.parentNode !== tray.leftSlot) tray.leftSlot.appendChild(stack)
          wantLeft.forEach((id, index) => {
            const el = cellOf(id)
            const at = cellAt(stack, index)
            if (at !== el) stack.insertBefore(el, at || deckBarOf(stack) || null)
          })
        } else if (tray.leftStack && tray.leftStack.parentNode) {
          tray.leftStack.parentNode.removeChild(tray.leftStack)
        }
        const bandEl = band.current
        if (bandEl) {
          wantRight.forEach((id, index) => {
            const el = cellOf(id)
            const at = cellAt(bandEl, index)
            if (at !== el) bandEl.insertBefore(el, at || deckBarOf(bandEl) || null)
          })
        }
        // Deck last: it needs the cells already in their containers to measure the front
        // card and to compute the strips.
        lastPlacement.current = { left: wantLeft, right: wantRight, inBand }
        if (tray.leftStack) syncDeck(tray.leftStack, wantLeft, true)
        if (bandEl) syncDeck(bandEl, wantRight, inBand)
        if (wantLeft.length && !deckOn()) syncLeftStackScroll()
      })

      // The stack scrolls only when the cards outgrow the column (see SHADOW_GUTTER).
      React.useEffect(() => {
        const el = band.current
        const measure = () => {
          if (!el) { setScrolls(false); return }
          const column = Math.max(0, window.innerHeight - 8 - top)
          const next = stackedHeight(el) > column + 0.5
          setScrolls((prev) => (prev === next ? prev : next))
        }
        measureStack.current = measure
        measure()
        // The left stack is not covered by the band's own observer above.
        if (!deckOn()) syncLeftStackScroll()
        if (typeof ResizeObserver === 'undefined') return () => { measureStack.current = null }
        const observer = new ResizeObserver(() => { measure(); syncLeftStackScroll() })
        if (el) for (const kid of el.children) observer.observe(kid)
        if (tray.leftStack) observer.observe(tray.leftStack)
        return () => { observer.disconnect(); measureStack.current = null }
      }, [inBand, right.length, top])

      // Cards in detached containers look perfectly healthy from the registry side, so
      // say it out loud once if nothing ever mounted a host for them.
      React.useEffect(() => {
        if (all.length === 0) return undefined
        const timer = setTimeout(() => {
          if (!tray.leftSlot && !band.current) {
            try {
              console.error('[panel-dock] ' + all.length + ' card(s) registered but no host slot is mounted (sidebar footer / overlay).')
            } catch {}
          }
        }, 1500)
        return () => clearTimeout(timer)
      }, [all.length])

      React.useEffect(() => () => {
        for (const el of tray.cells.values()) if (el.parentNode) el.parentNode.removeChild(el)
        tray.cells.clear()
        if (tray.leftStack && tray.leftStack.parentNode) tray.leftStack.parentNode.removeChild(tray.leftStack)
        tray.leftStack = null
      }, [])

      const nodes = []
      if (inBand) {
        const style = {
          position: 'fixed',
          top,
          bottom: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: STACK_GAP,
          minWidth: 0,
          boxSizing: 'border-box',
          overflow: 'visible',
          pointerEvents: 'none',
          zIndex: 10000,
        }
        style.width = plan.width
        if (plan.mode === 'inner') style.left = plan.left
        else style.right = Math.max(GAP, window.innerWidth - plan.rightEdge)
        if (scrolls) {
          const gutter = SHADOW_GUTTER
          style.top = top - gutter
          style.height = Math.max(0, window.innerHeight - 8 - top) + gutter * 2
          style.bottom = 'auto'
          style.width = plan.width + gutter * 2
          if (style.left !== undefined) style.left -= gutter
          if (style.right !== undefined) style.right -= gutter
          style.padding = gutter
          style.overflowY = 'auto'
          style.overflowX = 'hidden'
          style.scrollbarWidth = 'none'
        }
        nodes.push(h('div', {
          key: 'band',
          'data-panel-dock-strip': '',
          'data-panel-dock-scrolls': scrolls ? '' : undefined,
          ref: band,
          style,
        }))
      }
      for (const panel of all) {
        nodes.push(createPortal(h(CardBoundary, {
          key: panel.id + ':' + revisionOf(panel.id),
          id: panel.id,
          fallback: () => errorCard(panel),
        }, renderPanel(panel)), cellOf(panel.id), panel.id))
      }
      return h(React.Fragment, null, nodes)
    }


    // CardShell: the one shared top bar for a 侧栏卡片 (a card the dock hosts). It is NOT
    // a layout container -- the card still renders its own frame and body; the shell is
    // only the row above them: [logo = side toggle] [title] [version] ... [actions].
    const SHELL_STYLE = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      minWidth: 0,
      marginBottom: 6,
      color: 'var(--dsw-alias-label-primary)',
    }
    const SHELL_TOGGLE_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 18,
      height: 18,
      padding: 0,
      border: 0,
      borderRadius: 4,
      background: 'transparent',
      color: 'inherit',
      cursor: 'pointer',
      flex: '0 0 auto',
    }
    const SHELL_TITLE_STYLE = {
      fontSize: 13,
      fontWeight: 600,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      minWidth: 0,
    }
    const SHELL_VERSION_STYLE = {
      fontSize: 10,
      fontWeight: 400,
      lineHeight: 1.2,
      color: 'var(--dsw-alias-label-secondary)',
      flex: '0 0 auto',
    }
    const SHELL_ACTIONS_STYLE = { display: 'inline-flex', alignItems: 'center', gap: 4, flex: '0 0 auto' }

    // Monochrome logo that doubles as the side toggle: a panel glyph with an arrow
    // pointing at the side the card would move to.
    function shellLogo(docked) {
      return h('svg', {
        width: 15, height: 15, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', focusable: 'false',
      },
        h('rect', { x: 1.6, y: 2.6, width: 12.8, height: 10.8, rx: 2.4, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', { d: docked ? 'M10.4 2.8 V13.2' : 'M5.6 2.8 V13.2', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('path', {
          d: docked ? 'M7.1 6.4 L5.3 8 L7.1 9.6' : 'M8.9 6.4 L10.7 8 L8.9 9.6',
          stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    // Header only, by design: the card renders its own frame and body *under* this row.
    // Children are deliberately not rendered -- but silently dropping them would be the
    // worst kind of bug, so passing them is reported once per card instead of ignored.
    const shellWarned = new Set()

    function CardShell(props) {
      const id = props.id
      if (props.children !== undefined && props.children !== null && !shellWarned.has(id)) {
        shellWarned.add(id)
        try {
          console.warn('[panel-dock] CardShell renders the header row only; put your body next to it, not inside it (card: ' + id + ').')
        } catch {}
      }
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      const panel = registry.get(id)
      const preferred = sideOf(id, panel ? panel.side : 'left')
      const side = effectiveSide(id)
      const docked = side === 'right'
      const blocked = preferred !== side
      const title = props.title || (panel && panel.title) || id
      const version = props.version || (panel && panel.version) || null
      const label = blocked ? T('bandUnavailable') : (docked ? T('toLeft') : T('toRight'))
      return h('div', {
        'data-panel-dock-shell': id,
        style: Object.assign({}, SHELL_STYLE, props.style),
      },
        h('button', {
          type: 'button',
          'data-panel-dock-shell-toggle': '',
          'aria-label': label,
          title: label,
          disabled: blocked,
          onClick: () => { try { if (!blocked) toggleSide(id) } catch {} },
          style: blocked ? Object.assign({}, SHELL_TOGGLE_STYLE, { opacity: 0.4, cursor: 'default' }) : SHELL_TOGGLE_STYLE,
        }, shellLogo(docked)),
        h('span', { style: SHELL_TITLE_STYLE, title }, title),
        version ? h('span', { style: SHELL_VERSION_STYLE }, 'v' + version) : null,
        h('span', { style: { flex: '1 1 auto', minWidth: 0 } }),
        props.actions ? h('span', { style: SHELL_ACTIONS_STYLE }, props.actions) : null,
      )
    }


    // ---- crash isolation ----
    // The host treats a slot entry that throws as broken and drops the *whole entry*:
    // one bad card used to take every card down with it, and nothing recovered until a
    // reload. Each card therefore gets its own boundary, and each slot entry is sealed
    // so a dock bug cannot be mistaken for a broken host slot.
    class CardBoundary extends React.Component {
      constructor(props) {
        super(props)
        this.state = { failed: false }
      }
      static getDerivedStateFromError() {
        return { failed: true }
      }
      componentDidCatch(error) {
        try { console.error('[panel-dock] card crashed and was isolated: ' + this.props.id, error) } catch {}
      }
      render() {
        if (!this.state.failed) return this.props.children
        return this.props.fallback ? this.props.fallback() : null
      }
    }

    function errorCard(panel) {
      return h('div', {
        'data-panel-dock-item': panel.id,
        'data-panel-dock-error': '',
        style: {
          width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '8px 9px',
          border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 12,
          background: 'var(--dsw-alias-bg-layer-1)',
          color: 'var(--dsw-alias-label-secondary)',
          fontSize: 11, lineHeight: 1.35, pointerEvents: 'auto',
        },
      }, (panel.title || panel.id) + ' · ' + T('cardCrashed'))
    }

    // Re-registering an id means a new component: remount the boundary instead of leaving
    // it stuck in the failed state forever.
    const revisions = new Map()
    function revisionOf(id) {
      return revisions.get(id) || 0
    }

    // A sealed slot entry renders nothing instead of throwing into the host.
    function seal(Component, name, Alt) {
      return function SealedSlot() {
        return h(CardBoundary, { id: name, fallback: Alt ? () => h(Alt) : null }, h(Component))
      }
    }

    function effectiveSide(id) {
      const panel = registry.get(id)
      const preferred = sideOf(id, panel ? panel.side : 'left')
      return preferred === 'right' && placement.fallback ? 'left' : preferred
    }

    // The band floats over the transcript, so a card that swallows the pointer is
    // worse than one that merely looks solid. Hovering dims it to show what it covers;
    // it stays hit-testable (click-through is self-contradictory in CSS: an element
    // that ignores the pointer can never observe hover, so it would flicker).
    const BAND_CSS = [
      '[data-panel-dock-strip] [data-panel-dock-cell]{transition:opacity 120ms ease}',
      '[data-panel-dock-strip] [data-panel-dock-cell]:hover{opacity:0.45}',
      // ---- deck ----
      '[data-panel-dock-deck]{position:relative;transition:height 200ms cubic-bezier(.2,.8,.2,1)}',
      '[data-panel-dock-deck] > [data-panel-dock-cell]{position:absolute;left:0;right:0;top:0;',
      'transition:transform 200ms cubic-bezier(.2,.8,.2,1),opacity 160ms ease}',
      // Rear cards are only strips: keep them clickable but not visually loud.
      '[data-panel-dock-deck] > [data-panel-dock-cell]:hover{opacity:1}',
      '[data-panel-dock-deck-bar][data-panel-dock-hidden]{display:none}',
      // The strip is easy to miss at 10px when the pointer approaches from the middle of
      // the card, so a transparent tab hangs below the centre (ends untouched, nothing
      // painted): the middle catches the pointer 16px lower, the sides behave as before.
      '[data-panel-dock-deck-bar]::after{content:"";position:absolute;left:25%;right:25%;',
      'top:100%;height:16px;border-radius:0 0 10px 10px;}',
      // frame:true means the dock owns the rectangle, so the card body must not paint a
      // second one. Cards get this for free -- a card that keeps its own border shows a
      // box inside a box (seen live: loci drew 12px radius + white fill inside the frame).
      // !important is deliberate and scoped: the card's own `.card-root` rule has equal
      // specificity and lands later in the cascade, so without it the frame keeps a box
      // inside a box (verified: padding/border/radius survived the plain rule).
      '[data-panel-dock-frame] > *{padding:0 !important;margin:0 !important;border:0 !important;',
      'border-radius:0 !important;background:transparent !important;box-shadow:none !important;}',
      // ---- affordance: the card edge drops into a gradient band ----
      // The affordance is a glass overlay, not a row: it takes no layout space, sits on
      // the column's own top edge (not above it) and stays invisible until the pointer
      // arrives -- a permanently visible bar read as "the column got taller".
      // pointer-events:auto is essential: the band is pointer-events:none, and a child
      // inherits that, so the strip was unclickable (reported as "click does nothing").
      // Exactly the card's width: the strip used to stick out 4px on each side, which read
      // as a floating bar rather than a drawer pulled out of the card. Top corners follow
      // the card radius (12) so the square edge does not poke out of the rounded corner.
      '[data-panel-dock-deck-bar]{position:absolute;left:0;right:0;top:0;height:10px;',
      'z-index:400;box-sizing:border-box;pointer-events:auto;cursor:pointer;',
      'display:flex;align-items:center;justify-content:center;gap:3px;',
      // Top corners follow the card (12px); the bottom edge is square on purpose --
      // it reads as a drawer face pulled out of the card, not a floating pill.
      'border-radius:12px 12px 0 0;border-bottom:1px solid transparent;',
      'background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,0));',
      'opacity:0;transition:height 170ms ease,opacity 140ms ease,background 170ms ease,',
      'border-color 170ms ease;-webkit-backdrop-filter:blur(0px);backdrop-filter:blur(0px);}',
      '[data-panel-dock-deck-bar]:hover,[data-panel-dock-deck-bar]:focus-visible{',
      'height:30px;opacity:1;',
      // Real frosted glass needs a *translucent* veil: at 96% the fill hid everything
      // behind it, so backdrop-filter had nothing to blur and the strip read as opaque.
      // Keep the veil low-opacity, blur hard, and let a white top highlight carry the
      // glass edge; the darker tone is now only the bottom hairline.
      'background:',
      'linear-gradient(180deg,rgba(255,255,255,.26),rgba(255,255,255,.06)),',
      'linear-gradient(180deg,',
      'color-mix(in srgb,var(--dsw-specific-sidebar-fill,#f9fafb) 52%,transparent),',
      'color-mix(in srgb,var(--dsw-specific-sidebar-fill,#f9fafb) 28%,transparent));',
      'border-bottom-color:rgba(15,23,42,.09);',
      'box-shadow:inset 0 1px 0 rgba(255,255,255,.55),inset 0 -1px 0 rgba(15,23,42,.04);',
      '-webkit-backdrop-filter:blur(14px) saturate(1.25);backdrop-filter:blur(14px) saturate(1.25);}',
      '[data-panel-dock-deck-bar] > i{display:block;width:7px;height:7px;margin-top:-6px;',
      'border-right:1.8px solid var(--dsw-alias-label-secondary,rgba(15,23,42,.62));',
      'border-bottom:1.8px solid var(--dsw-alias-label-secondary,rgba(15,23,42,.62));',
      'transform:rotate(45deg);opacity:0;',
      'transition:opacity 140ms ease;animation:pdDeckChevron 1.2s ease-in-out infinite}',
      '[data-panel-dock-deck-bar]:hover > i,[data-panel-dock-deck-bar]:focus-visible > i{opacity:.92}',
      // Deck already on: the same gesture splits the stack back into rows, so point
      // the chevrons at the rows instead of repeating "stack down".
      '[data-panel-dock-deck-bar][data-panel-dock-deck-on] > i{transform:rotate(-45deg);margin-top:5px;margin-left:-3px}',
      '@media (prefers-reduced-motion: reduce){[data-panel-dock-deck-bar] > i{animation:none}}',
      '[data-panel-dock-deck-bar] > i:nth-child(2){animation-delay:.14s}',
      '[data-panel-dock-deck-bar] > i:nth-child(3){animation-delay:.28s}',
      '@keyframes pdDeckChevron{0%{opacity:.15;transform:translateY(-2px) rotate(45deg)}',
      '50%{opacity:.95;transform:translateY(2px) rotate(45deg)}',
      '100%{opacity:.15;transform:translateY(-2px) rotate(45deg)}}',
      '@media (prefers-reduced-motion: reduce){',
      '[data-panel-dock-strip] [data-panel-dock-cell]{transition:none}',
      '[data-panel-dock-deck]{transition:none}',
      '[data-panel-dock-deck] > [data-panel-dock-cell]{transition:none}}',
    ].join('')
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-panel-dock: locale')
      // Dock-level affordance: every card in the band dims on hover without opting in.
      ctx.effect(() => {
        if (typeof document === 'undefined') return undefined
        const style = document.createElement('style')
        style.setAttribute('data-dsh-panel-dock', 'band-hover')
        style.textContent = BAND_CSS
        document.head.appendChild(style)
        return () => { try { style.remove() } catch {} }
      }, 'dsh-panel-dock: band css')
      T = ctx.locale.bind(NS)
      // The tray keeps cards mounted when they change hosts; without portals the dock
      // falls back to rendering each host directly (0.3.x behaviour, cards remount).
      const leftHost = createPortal ? seal(LeftSlot, 'panel-dock-left', LeftHost) : seal(LeftHost, 'panel-dock-left')
      const rightHost = createPortal ? seal(TrayHost, 'panel-dock-right', RightHost) : seal(RightHost, 'panel-dock-right')
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'panel-dock-left', order: 900, locale: NS,
      }, leftHost))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'panel-dock-right', order: 40, locale: NS,
      }, rightHost))
      const api = {
          version: VERSION,
          define,
          placementOf: effectiveSide,
          // Consumers use this to decide whether their native fallback must draw: with the
          // dock present but their registration missing, neither side used to render.
          has: (id) => registry.has(id),
          panel: (id) => {
            const p = registry.get(id)
            return p ? { id: p.id, title: p.title, order: p.order, side: sideOf(p.id, p.side), effective: effectiveSide(p.id), minWidth: p.minWidth, version: p.version, frame: frameEnabled(p) } : null
          },
          panels: () => panels().map((p) => ({ id: p.id, title: p.title, order: p.order, side: sideOf(p.id, p.side), effective: effectiveSide(p.id), minWidth: p.minWidth, version: p.version, frame: frameEnabled(p) })),
          CardShell,
          getSide: (id) => sideOf(id, registry.has(id) ? registry.get(id).side : 'left'),
          setSide,
          toggleSide,
          subscribe,
        }
      ctx.effect(() => {
        try { window.__dshPanelDock = api } catch {}
        // Disabling the plugin must hand the panels back to their own fallbacks, so the
        // global has to disappear with us -- leaving it behind silently keeps every card
        // believing the dock is alive.
        return () => {
          try { if (window.__dshPanelDock === api) delete window.__dshPanelDock } catch {}
        }
      }, 'dsh-panel-dock: global')
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
