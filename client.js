window.__ModuleLoader__.load({
  id: 'dsh-panel-dock',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    // The client module loader resolves bare ids only, so the pure core is inlined
    // here; dock-core.js stays the single source for unit tests.
    const DEFAULT_WIDTH = 320
    const MIN_WIDTH = 200
    const MAX_WIDTH = 720
    const STORE_KEY = 'dsh.panel-dock.v1'
    const SPLITTER_WIDTH = 5
    const MIN_CONVERSATION = 420
    const core = {
      STORE_KEY,
      DEFAULT_WIDTH,
      MIN_WIDTH,
      MAX_WIDTH,
      clampWidth(width) {
        const value = Number(width)
        if (!Number.isFinite(value)) return DEFAULT_WIDTH
        return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value)))
      },
      heightStyle(height) {
        if (height === 'fill') return { flex: '1 1 0' }
        if (height === 'auto') return { flex: '0 0 auto' }
        const px = Number(height)
        if (!Number.isFinite(px) || px <= 0) return { flex: '1 1 0' }
        return { flex: '0 0 ' + Math.round(px) + 'px' }
      },
      normalizePanels(panels) {
        const list = Array.isArray(panels) ? panels.slice() : []
        return list.sort((a, b) => {
          const ao = Number.isFinite(a.order) ? a.order : 100
          const bo = Number.isFinite(b.order) ? b.order : 100
          if (ao !== bo) return ao - bo
          return String(a.id).localeCompare(String(b.id))
        })
      },
      defaultLayout() { return { width: DEFAULT_WIDTH, collapsed: {} } },
      parseLayout(raw) {
        if (typeof raw !== 'string' || raw === '') return { width: DEFAULT_WIDTH, collapsed: {} }
        let parsed = null
        try { parsed = JSON.parse(raw) } catch { return { width: DEFAULT_WIDTH, collapsed: {} } }
        if (!parsed || typeof parsed !== 'object') return { width: DEFAULT_WIDTH, collapsed: {} }
        const collapsed = {}
        if (parsed.collapsed && typeof parsed.collapsed === 'object') {
          for (const key of Object.keys(parsed.collapsed)) collapsed[key] = parsed.collapsed[key] === true
        }
        return { width: core.clampWidth(parsed.width), collapsed }
      },
      serializeLayout(layout) {
        return JSON.stringify({ width: core.clampWidth(layout && layout.width), collapsed: Object.assign({}, (layout && layout.collapsed) || {}) })
      },
      isCollapsed(layout, id) { return Boolean(layout && layout.collapsed && layout.collapsed[id] === true) },
      effectiveStripWidth(stageWidth, preferred, splitter) {
        const stage = Number(stageWidth)
        if (!Number.isFinite(stage) || stage <= 0) return core.clampWidth(preferred)
        const affordable = Math.floor(stage - MIN_CONVERSATION - splitter)
        const capped = Math.min(core.clampWidth(preferred), affordable)
        return Math.max(MIN_WIDTH, capped)
      },
      toggleCollapsed(layout, id) {
        const next = { width: core.clampWidth(layout && layout.width), collapsed: Object.assign({}, (layout && layout.collapsed) || {}) }
        next.collapsed[id] = next.collapsed[id] !== true
        return next
      },
    }

    const KEY = 'panel-dock'
    const VIEW_SLOT = 'panel-dock.view'
    const NS = 'panel-dock'
    const SIDE_STORE = 'dsh.panel-dock.side.v1'

    let CTX = null
    const registry = new Map()
    const listeners = new Set()

    const zh = { panel: '面板坞', empty: '暂无面板', collapse: '收起', expand: '展开' }
    const en = { panel: 'Panel dock', empty: 'No panels yet', collapse: 'Collapse', expand: 'Expand' }
    let T = (k) => k

    function emit() { for (const fn of listeners) { try { fn() } catch {} } }
    function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) }
    function panels() { return core.normalizePanels([...registry.values()]) }

    function readLayout() {
      try { return core.parseLayout(window.localStorage.getItem(core.STORE_KEY)) } catch { return core.defaultLayout() }
    }
    function writeLayout(layout) {
      try { window.localStorage.setItem(core.STORE_KEY, core.serializeLayout(layout)) } catch {}
    }

    function define(definition) {
      if (!definition || typeof definition.id !== 'string' || definition.id === '') {
        throw new Error('panel-dock: define() needs a non-empty id')
      }
      if (typeof definition.component !== 'function') {
        throw new Error('panel-dock: define(' + definition.id + ') needs a component')
      }
      if (registry.has(definition.id)) throw new Error('panel-dock: duplicate panel id ' + definition.id)
      registry.set(definition.id, {
        id: definition.id,
        title: definition.title || definition.id,
        order: definition.order,
        height: definition.height === undefined ? 'fill' : definition.height,
        component: definition.component,
        collapsible: definition.collapsible !== false,
        side: definition.side === 'left' || definition.side === 'auto' ? definition.side : 'right',
      })
      emit()
      return () => { registry.delete(definition.id); emit() }
    }

    function FixedChatView(props) {
      return h(React.Fragment, null, props.renderSlot('conversation.session', { view: 'chat' }))
    }

    function ConversationSurface(props) {
      return props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false }, {
        slots: { views: FixedChatView },
        fallback: h('div', { style: { padding: 12, fontSize: 12 } }, 'no conversation content'),
      })
    }

    class SurfaceBoundary extends React.Component {
      constructor(props) { super(props); this.state = { failed: false, message: '' } }
      static getDerivedStateFromError(error) { return { failed: true, message: String(error && error.message ? error.message : error) } }
      componentDidCatch(error) { try { console.error('panel-dock: surface crashed', error) } catch {} }
      render() {
        if (this.state.failed) return h('div', { style: { padding: 12, fontSize: 12, color: '#b91c1c' } }, 'conversation failed: ' + this.state.message)
        return this.props.children
      }
    }

    function useRegistry() {
      const [, force] = React.useState(0)
      React.useEffect(() => subscribe(() => force((n) => n + 1)), [])
      return panels()
    }

    // Render a panel element directly into the strip: no wrapper chrome.
    function renderPanel(panel, layout, setLayout) {
      const collapsed = core.isCollapsed(layout, panel.id)
      if (collapsed) {
        return h('div', {
          key: panel.id,
          'data-panel-dock-item': panel.id,
          'data-panel-dock-collapsed': '',
          style: { flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', cursor: 'pointer',
            border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)',
            fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
          onClick: () => setLayout((current) => { const next = core.toggleCollapsed(current, panel.id); writeLayout(next); return next }),
        }, panel.title)
      }
      // Contract: a panel component renders ONE root element and spreads the props
      // it receives onto it. The dock then sizes the panel directly, with no wrapper
      // element between the strip and the panel.
      return h(panel.component, {
        key: panel.id,
        active: true,
        'data-panel-dock-item': panel.id,
        style: Object.assign({
          width: '100%', minWidth: 0, minHeight: 0, boxSizing: 'border-box', overflow: 'hidden',
        }, core.heightStyle(panel.height)),
      })
    }

    function Stage(props) {
      const { SessionProvider, renderSlot, useSessions } = props
      const list = useSessions((state) => state)
      const registered = useRegistry().filter((panel) => panel.side === 'right')
      const sessionId = React.useMemo(() => {
        if (!list || !Array.isArray(list.ids) || list.ids.length === 0) return null
        const retained = list.ids.find((id) => ((list.byId[id] || {}).retainedBy || {}).mainView > 0)
        return retained || list.ids[0]
      }, [list])
      const [reference, setReference] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [layout, setLayout] = React.useState(readLayout)
      const [stageWidth, setStageWidth] = React.useState(0)
      const stageRef = React.useRef(null)
      React.useEffect(() => {
        const node = stageRef.current
        if (!node || typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver((entries) => {
          const width = entries && entries[0] && entries[0].contentRect ? entries[0].contentRect.width : 0
          setStageWidth(Math.round(width))
        })
        observer.observe(node)
        const measure = () => {
          const current = stageRef.current
          if (!current) return
          const width = Math.round(current.getBoundingClientRect().width)
          setStageWidth((previous) => (previous === width ? previous : width))
        }
        measure()
        window.addEventListener('resize', measure)
        const timer = window.setInterval(measure, 1000)
        return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.clearInterval(timer) }
      }, [])
      React.useEffect(() => {
        const sync = () => setLayout(readLayout())
        listeners.add(sync)
        return () => { listeners.delete(sync) }
      }, [])
      const dragRef = React.useRef(null)

      React.useEffect(() => {
        if (!sessionId || !CTX) return undefined
        let cancelled = false
        let ref = null
        try { ref = CTX.sessions.retain(sessionId, { source: KEY }) } catch (error) {
          setFailure(String(error && error.message ? error.message : error)); return undefined
        }
        ref.ready.then(() => { if (!cancelled) setReference(ref) }, (error) => {
          if (!cancelled) setFailure(String(error && error.message ? error.message : error))
        })
        return () => { cancelled = true; setReference(null); try { ref.release() } catch {} }
      }, [sessionId])

      React.useEffect(() => {
        try {
          window.__panelDockDebug = {
            panels: registered.map((p) => p.id),
            width: layout.width,
            stripWidth,
            collapsed: Object.assign({}, layout.collapsed),
            stageWidth,
            sessionId,
            hasReference: Boolean(reference),
            hasSessionProvider: Boolean(SessionProvider),
            failure,
          }
        } catch {}
      }, [registered, layout, sessionId, reference, SessionProvider, failure])

      const onDown = (event) => {
        event.preventDefault()
        dragRef.current = { startX: event.clientX, startWidth: layout.width }
        const move = (e) => {
          if (!dragRef.current) return
          const raw = dragRef.current.startWidth + (dragRef.current.startX - e.clientX)
          const next = core.effectiveStripWidth(stageWidth, raw, SPLITTER_WIDTH)
          setLayout((current) => ({ width: next, collapsed: current.collapsed }))
        }
        const up = () => {
          dragRef.current = null
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          setLayout((current) => { writeLayout(current); return current })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const conversation = reference && SessionProvider
        ? h(SessionProvider, { session: reference }, h(SurfaceBoundary, null, renderSlot(VIEW_SLOT, {})))
        : h('div', { style: { padding: 12, fontSize: 12, color: '#666' } }, failure || 'opening session…')

      const stripWidth = core.effectiveStripWidth(stageWidth, layout.width, SPLITTER_WIDTH)
      return h('div', {
        'data-panel-dock-stage': '',
        ref: stageRef,
        style: { display: 'flex', flexDirection: 'row', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden' },
      },
        h('div', { style: { flex: '1 1 auto', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } }, conversation),
        h('div', {
          'data-panel-dock-splitter': '',
          onPointerDown: onDown,
          title: 'drag to resize',
          style: { flex: '0 0 5px', cursor: 'col-resize', background: 'transparent', borderLeft: '1px solid var(--dsw-alias-border-l1)' },
        }),
        h('div', {
          'data-panel-dock-strip': '',
          style: {
            flex: '0 0 auto', width: stripWidth + 'px', height: '100%', boxSizing: 'border-box',
            display: 'flex', flexDirection: 'column', gap: 8, padding: 8, minHeight: 0,
            background: 'var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-module-platform))',
          },
        },
          registered.length === 0
            ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', padding: 8 } }, T('empty'))
            : registered.map((panel) => renderPanel(panel, layout, setLayout))),
      )
    }

    function LeftDock() {
      const registered = useRegistry()
      const [layout, setLayout] = React.useState(readLayout)
      React.useEffect(() => {
        const sync = () => setLayout(readLayout())
        listeners.add(sync)
        return () => { listeners.delete(sync) }
      }, [])
      const leftPanels = registered.filter((panel) => panel.side === 'left' || panel.side === 'auto')
      if (leftPanels.length === 0) return null
      return h('div', {
        'data-panel-dock-left': '',
        style: { display: 'flex', flexDirection: 'column', gap: 6, width: '100%', minWidth: 0 },
      }, leftPanels.map((panel) => {
        const collapsed = core.isCollapsed(layout, panel.id)
        if (collapsed) {
          return h('div', {
            key: panel.id,
            'data-panel-dock-left-item': panel.id,
            'data-panel-dock-collapsed': '',
            style: { display: 'flex', alignItems: 'center', padding: '4px 8px', cursor: 'pointer',
              border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-1)',
              fontSize: 11, color: 'var(--dsw-alias-label-secondary)' },
            onClick: () => setLayout((current) => { const next = core.toggleCollapsed(current, panel.id); writeLayout(next); return next }),
          }, panel.title)
        }
        return h(panel.component, {
          key: panel.id,
          active: true,
          'data-panel-dock-left-item': panel.id,
          style: { width: '100%', minWidth: 0, boxSizing: 'border-box' },
        })
      }))
    }
    function PanelIcon() {
      return h('svg', { viewBox: '0 0 16 16', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 },
        h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2.5 }),
        h('line', { x1: 10, y1: 2.5, x2: 10, y2: 13.5 }))
    }

    function apply(ctx) {
      try { console.log('panel-dock: apply start') } catch {}
      CTX = ctx
      T = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'panel-dock: dictionaries')
      // Cross-plugin API. Client plugin bundles resolve bare ids only and the
      // reflect service is not injectable here, so the dock publishes a single
      // well-known global that consumers poll for (see README: readiness).
      const api = {
        version: 1,
        define,
        panels: () => panels().map((p) => ({ id: p.id, title: p.title, order: p.order })),
        open: () => { try { ctx.layout.selectPanel(KEY) } catch {} },
        close: () => { try { ctx.layout.selectPanel(null) } catch {} },
        isOpen: () => { try { return ctx.layout.panelInfo.getSnapshot().activePanelId === KEY } catch { return false } },
        getWidth: () => readLayout().width,
        setWidth: (width) => { const next = { width: core.clampWidth(width), collapsed: readLayout().collapsed }; writeLayout(next); emit(); return next.width },
        setCollapsed: (id, value) => { const current = readLayout(); const next = { width: current.width, collapsed: Object.assign({}, current.collapsed) }; if (value) next.collapsed[id] = true; else delete next.collapsed[id]; writeLayout(next); emit(); return Boolean(next.collapsed[id]) },
        toggle: (id) => { const current = readLayout(); const next = core.toggleCollapsed(current, id); writeLayout(next); emit(); return Boolean(next.collapsed[id]) },
        getLayout: () => readLayout(),
      }
      try { window.__dshPanelDock = api } catch {}
      try { ctx.effect(() => { const previous = window.__dshPanelDock; return () => { if (window.__dshPanelDock === api) window.__dshPanelDock = undefined } }, 'panel-dock: global') } catch {}
      // Register the sidebar entries at the top level: entries contributed from
      // inside another entry's effect are torn down when that entry is not active,
      // which would hide the left stack whenever the right column is closed.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: KEY, order: 25, label: () => T('panel'), locale: NS }, PanelIcon))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: KEY, order: 900, label: () => T('panel'), locale: NS }, LeftDock))
      ctx.slots.inject('main', function* () {
        yield ctx.slots.register({ name: 'main', key: KEY, locale: NS, children: { [VIEW_SLOT]: { kind: 'single', scope: 'session' } } }, Stage)
      })
      ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({ name: VIEW_SLOT, locale: NS }, ConversationSurface))
      try { console.log('panel-dock: apply done') } catch {}
    }

    return { inject: ['slots', 'sessions', 'locale', 'layout'], apply }
  },
})
