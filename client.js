window.__ModuleLoader__.load({
  id: 'dsh-panel-dock',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // dsh-panel-dock is a slot negotiation layer, not a UI of its own: plugins
    // register a card here and the dock decides where it renders. It never adds a
    // navigation entry, a button or a dialog -- the only affordances belong to the
    // cards themselves.
    const VERSION = '0.3.9'
    const NS = 'panel-dock'
    const STORE_KEY = 'dsh.panel-dock.v1'
    const GAP = 6
    const STACK_GAP = GAP
    // A panel narrower than this stops being readable; the gutter keeps this floor
    // and lets its left edge sit over the transcript margin instead.
    const MIN_PANEL_WIDTH = 200
    // A card wider than this stops reading as a card; the band may be wider than the
    // card and the surplus stays with the conversation.
    const MAX_PANEL_WIDTH = 480
    // The band must not clip: any scroll container turns its children's box-shadow into
    // a hard-edged rectangle. Cards own their shadow, and it has to fall naturally the
    // way it does in the sidebar.

    const zh = { empty: '暂无面板' }
    const en = { empty: 'No panels yet' }
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
    // Stacking is first-come-first-served: the Map keeps registration order, so a
    // panel never jumps above one that arrived earlier because of a numeric field.
    function panels() {
      return [...registry.values()]
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
      registry.set(definition.id, definition)
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
      const items = layout.filter((panel) => sideOf(panel.id, panel.side) === 'left')
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
      try {
        const handle = [...document.querySelectorAll('[class*="widthHandle"]')]
          .find((el) => el.getAttribute('data-side') === 'right')
        if (handle) {
          handleRight = Math.round(box(handle).right)
          left = handleRight + GAP
        }
        // The turn rail sits to the right of the band; other turn-navigation buttons live
        // on its left edge. Keep the smallest x that is still right of the handle -- a wide
        // conversation can leave only a few pixels, so the tolerance has to stay small.
        const railXs = [...document.querySelectorAll('button[aria-label]')]
          .filter((el) => /turnNavigation|轮次|跳转/i.test(el.getAttribute('aria-label') || ''))
          .map((el) => Math.round(box(el).left))
          // Everything to the right of the handle belongs to the rail side; a squeezed
          // band can leave the rail a single pixel right of the handle.
          .filter((x) => handleRight === null || x > handleRight)
        if (railXs.length) right = Math.round(Math.min(...railXs)) - GAP
        const tabs = document.querySelector('[data-conversation-tabs]')
        if (tabs) top = Math.round(box(tabs.parentElement || tabs).bottom) + GAP
      } catch {}
      return { left, right, top }
    }

    function RightHost() {
      const all = useRegistry()
      const [anchors, setAnchors] = React.useState(() => measureAnchors())

      React.useEffect(() => {
        let raf = 0
        const sync = () => { raf = 0; setAnchors(measureAnchors()) }
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
      // An empty column must cost nothing: no panels, no strip, no reserved width.
      if (items.length === 0) return null

      const anchored = anchors && anchors.left !== null && anchors.right !== null
      const span = anchored ? anchors.right - anchors.left : 0
      // A wide conversation squeezes the band away. The panel keeps a usable width by
      // growing leftwards over the transcript instead of vanishing; the turn rail stays
      // clear, so the right edge never moves past it.
      const width = anchored
        ? Math.min(Math.max(span, MIN_PANEL_WIDTH), MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, anchors.right - 8))
        : MAX_PANEL_WIDTH

      const style = {
        position: 'fixed',
        top: anchored ? anchors.top : 8,
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
      if (anchored) {
        if (width > span + 0.5) {
          // Squeezed: pin to the rail side and let the card cover the transcript edge.
          style.right = Math.max(GAP, window.innerWidth - anchors.right)
        } else {
          // Roomy: follow the transcript handle, leaving the surplus band near the rail.
          style.left = anchors.left
        }
      } else {
        style.right = 8
      }
      return h('div', { 'data-panel-dock-strip': '', style }, items.map(renderPanel))
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-panel-dock: locale')
      T = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action', id: 'panel-dock-left', order: 900, locale: NS,
      }, LeftHost))
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay', id: 'panel-dock-right', order: 40, locale: NS,
      }, RightHost))
      try {
        window.__dshPanelDock = {
          version: VERSION,
          define,
          panels: () => panels().map((p) => ({ id: p.id, title: p.title, order: p.order, side: sideOf(p.id, p.side) })),
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
