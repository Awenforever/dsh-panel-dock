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
    const VERSION = '0.5.1'
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
    // The band must not clip: any scroll container turns its children's box-shadow into
    // a hard-edged rectangle. Cards own their shadow, and it has to fall naturally the
    // way it does in the sidebar.

    const zh = { empty: '暂无面板', toLeft: '移到左侧', toRight: '移到右侧' }
    const en = { empty: 'No panels yet', toLeft: 'Move to the left panel', toRight: 'Move to the right panel' }
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
      registry.set(definition.id, Object.assign({}, definition, { minWidth, version }))
      emit()
      return () => { registry.delete(definition.id); emit() }
    }

    function useRegistry() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return panels()
    }

    // A panel owns its own rectangle: the dock passes sizing through `style` and the
    // component must spread it onto its single root element.
    function renderPanel(panel) {
      return h(panel.component, {
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
      }, items.map(renderPanel))
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
      try {
        const handle = [...document.querySelectorAll('[class*="widthHandle"]')]
          .find((el) => el.getAttribute('data-side') === 'right')
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
          .map((el) => ({ left: Math.round(box(el).left), right: Math.round(box(el).right) }))
          // Everything to the right of the handle belongs to the rail side; a squeezed
          // band can leave the rail a single pixel right of the handle.
          .filter((mark) => handleRight === null || mark.left > handleRight)
        const rail = railColumn(railMarks)
        if (rail !== null) {
          right = rail.left - GAP
          railRight = rail.right
        }
        const tabs = document.querySelector('[data-conversation-tabs]')
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
      } catch {}
      return { left, right, top, handleLeft, handleRight, railRight, areaRight, areaLeft }
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
      const left = Math.min(...marks.map((m) => m.left))
      return { left, right: Math.max(...marks.filter((m) => Math.abs(m.left - left) <= 2).map((m) => m.right)) }
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
    function planBand(anchors, required) {
      const vw = typeof window === 'undefined' ? 0 : window.innerWidth
      const areaEdge = Math.min(vw, anchors && anchors.areaRight ? anchors.areaRight : vw)
      const limit = areaEdge - GAP
      const hasRail = Boolean(anchors) && anchors.railRight !== null && anchors.railRight !== undefined
      const inner = anchors && anchors.left !== null && anchors.right !== null ? anchors.right - anchors.left : null
      // The whitespace is used where it exists.
      if (inner !== null && inner >= required) {
        return { mode: 'inner', left: anchors.left, width: Math.min(inner, MAX_PANEL_WIDTH), limit }
      }
      const outer = hasRail ? limit - (anchors.railRight + GAP) : null
      if (outer !== null && outer >= required) {
        return { mode: 'outer', rightEdge: limit, width: Math.min(outer, MAX_PANEL_WIDTH), limit }
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
      return { mode: 'intrude', rightEdge, width: required, limit }
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
      const top = anchors ? anchors.top : 8
      // Default 280 applies only to a panel that declared nothing; a panel that says it
      // can live with 160 gets 160, so it never takes more text than it needs.
      const required = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_WIDTH_FLOOR,
        items.reduce((widest, panel) => Math.max(widest, panel.minWidth || DEFAULT_MIN_WIDTH), 0)))
      const plan = planBand(anchors, required)

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
      }, items.map(renderPanel))
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

      React.useEffect(() => {
        tray.poke = () => bump((n) => n + 1)
        return () => { tray.poke = null }
      }, [])

      React.useEffect(() => {
        let raf = 0
        const sync = () => {
          raf = 0
          const next = measureAnchors()
          setAnchors((prev) => (sameAnchors(prev, next) ? prev : next))
          if (measureStack.current) measureStack.current()
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

      const right = all.filter((panel) => sideOf(panel.id, panel.side) === 'right')
      const top = anchors ? anchors.top : 8
      const required = Math.min(MAX_PANEL_WIDTH, Math.max(MIN_WIDTH_FLOOR,
        right.reduce((widest, panel) => Math.max(widest, panel.minWidth || DEFAULT_MIN_WIDTH), 0)))
      const plan = planBand(anchors, required)
      const inBand = plan.mode !== 'fallback' && right.length > 0

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
            const at = stack.children[index]
            if (at !== el) stack.insertBefore(el, at || null)
          })
        } else if (tray.leftStack && tray.leftStack.parentNode) {
          tray.leftStack.parentNode.removeChild(tray.leftStack)
        }
        const bandEl = band.current
        if (bandEl) {
          wantRight.forEach((id, index) => {
            const el = cellOf(id)
            const at = bandEl.children[index]
            if (at !== el) bandEl.insertBefore(el, at || null)
          })
        }
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
        if (!el || typeof ResizeObserver === 'undefined') return undefined
        const observer = new ResizeObserver(measure)
        for (const kid of el.children) observer.observe(kid)
        return () => { observer.disconnect(); measureStack.current = null }
      }, [inBand, right.length, top])

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
        nodes.push(createPortal(renderPanel(panel), cellOf(panel.id), panel.id))
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
      const side = sideOf(id, panel ? panel.side : 'left')
      const docked = side === 'right'
      const title = props.title || (panel && panel.title) || id
      const version = props.version || (panel && panel.version) || null
      const label = docked ? T('toLeft') : T('toRight')
      return h('div', {
        'data-panel-dock-shell': id,
        style: Object.assign({}, SHELL_STYLE, props.style),
      },
        h('button', {
          type: 'button',
          'data-panel-dock-shell-toggle': '',
          'aria-label': label,
          title: label,
          onClick: () => { try { toggleSide(id) } catch {} },
          style: SHELL_TOGGLE_STYLE,
        }, shellLogo(docked)),
        h('span', { style: SHELL_TITLE_STYLE, title }, title),
        version ? h('span', { style: SHELL_VERSION_STYLE }, 'v' + version) : null,
        h('span', { style: { flex: '1 1 auto', minWidth: 0 } }),
        props.actions ? h('span', { style: SHELL_ACTIONS_STYLE }, props.actions) : null,
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-panel-dock: locale')
      T = ctx.locale.bind(NS)
      // The tray keeps cards mounted when they change hosts; without portals the dock
      // falls back to rendering each host directly (0.3.x behaviour, cards remount).
      const leftHost = createPortal ? LeftSlot : LeftHost
      const rightHost = createPortal ? TrayHost : RightHost
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'panel-dock-left', order: 900, locale: NS,
      }, leftHost))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'panel-dock-right', order: 40, locale: NS,
      }, rightHost))
      try {
        window.__dshPanelDock = {
          version: VERSION,
          define,
          panels: () => panels().map((p) => ({ id: p.id, title: p.title, order: p.order, side: sideOf(p.id, p.side), minWidth: p.minWidth, version: p.version })),
          CardShell,
          getSide: (id) => sideOf(id, registry.has(id) ? registry.get(id).side : 'left'),
          setSide,
          toggleSide,
          subscribe,
        }
      } catch {}
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
