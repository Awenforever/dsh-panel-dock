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
      defaultLayout() { return { width: DEFAULT_WIDTH, collapsed: {}, sides: {}, open: false } },
      parseLayout(raw) {
        if (typeof raw !== 'string' || raw === '') return { width: DEFAULT_WIDTH, collapsed: {}, sides: {}, open: false }
        let parsed = null
        try { parsed = JSON.parse(raw) } catch { return { width: DEFAULT_WIDTH, collapsed: {}, sides: {}, open: false } }
        if (!parsed || typeof parsed !== 'object') return { width: DEFAULT_WIDTH, collapsed: {}, sides: {}, open: false }
        const collapsed = {}
        if (parsed.collapsed && typeof parsed.collapsed === 'object') {
          for (const key of Object.keys(parsed.collapsed)) collapsed[key] = parsed.collapsed[key] === true
        }
        const sides = {}
        if (parsed.sides && typeof parsed.sides === 'object') {
          for (const key of Object.keys(parsed.sides)) {
            const value = parsed.sides[key]
            if (value === 'left' || value === 'right') sides[key] = value
          }
        }
        return { width: core.clampWidth(parsed.width), collapsed, sides, open: parsed.open === true }
      },
      serializeLayout(layout) {
        return JSON.stringify({
          width: core.clampWidth(layout && layout.width),
          collapsed: Object.assign({}, (layout && layout.collapsed) || {}),
          sides: Object.assign({}, (layout && layout.sides) || {}),
          open: Boolean(layout && layout.open),
        })
      },
      isCollapsed(layout, id) { return Boolean(layout && layout.collapsed && layout.collapsed[id] === true) },
      effectiveStripWidth(stageWidth, preferred, splitter) {
        const stage = Number(stageWidth)
        if (!Number.isFinite(stage) || stage <= 0) return core.clampWidth(preferred)
        const affordable = Math.floor(stage - MIN_CONVERSATION - splitter)
        const capped = Math.min(core.clampWidth(preferred), affordable)
        return Math.max(MIN_WIDTH, capped)
      },
      effectiveSide(layout, id, fallback) {
        const stored = layout && layout.sides ? layout.sides[id] : undefined
        if (stored === 'left' || stored === 'right') return stored
        return fallback === 'left' ? 'left' : 'right'
      },
      withSide(layout, id, side) {
        const next = core.cloneLayout(layout)
        if (side === 'left' || side === 'right') next.sides[id] = side
        else delete next.sides[id]
        return next
      },
      otherSide(side) { return side === 'left' ? 'right' : 'left' },
      cloneLayout(layout) {
        return {
          width: core.clampWidth(layout && layout.width),
          collapsed: Object.assign({}, (layout && layout.collapsed) || {}),
          sides: Object.assign({}, (layout && layout.sides) || {}),
          open: Boolean(layout && layout.open),
        }
      },
      toggleCollapsed(layout, id) {
        const next = core.cloneLayout(layout)
        next.collapsed[id] = next.collapsed[id] !== true
        return next
      },
    }

    const KEY = 'panel-dock'
    const VIEW_SLOT = 'panel-dock.view'
    const NS = 'panel-dock'
    const SIDE_STORE = 'dsh.panel-dock.side.v1'
    const MODE_STORE = 'dsh.panel-dock.mode.v1'
    // 'gutter' keeps the shipped conversation layout and puts the panels in the
    // empty band between the transcript handle and the turn navigator; 'takeover'
    // replaces the conversation slot with a real three-part layout.
    const MODES = ['gutter', 'takeover']
    // A panel narrower than this is unreadable, so the strip keeps this width and
    // lets its left edge sit over the transcript's right margin when the gutter is
    // narrower (the margin is empty by construction).
    const MIN_PANEL_WIDTH = 200
    function readMode() {
      try { const raw = window.localStorage.getItem(MODE_STORE); return MODES.includes(raw) ? raw : 'gutter' } catch { return 'gutter' }
    }
    function writeMode(mode) {
      try { window.localStorage.setItem(MODE_STORE, MODES.includes(mode) ? mode : 'gutter') } catch {}
    }
    function isOpen() { return readLayout().open === true }
    function selectOwnSlot(ctx, value) {
      suppressSlotSync = true
      try { ctx.layout.selectPanel(value) } catch {}
      setTimeout(() => { suppressSlotSync = false }, 200)
    }
    function setOpen(value) { const next = core.cloneLayout(readLayout()); next.open = Boolean(value); writeLayout(next); emit() }

    let CTX = null
    // Set while the dock itself selects the conversation slot, so the sidebar-icon
    // watcher does not mistake a programmatic hand-over for a user click.
    let suppressSlotSync = false
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

    function useLayoutState() {
      const [layout, setLayout] = React.useState(readLayout)
      const apply = React.useCallback((next) => { writeLayout(next); setLayout(next); emit() }, [])
      React.useEffect(() => subscribe(() => setLayout(readLayout())), [])
      return [layout, apply]
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
      const allPanels = useRegistry()
      const sessionId = React.useMemo(() => {
        if (!list || !Array.isArray(list.ids) || list.ids.length === 0) return null
        const retained = list.ids.find((id) => ((list.byId[id] || {}).retainedBy || {}).mainView > 0)
        return retained || list.ids[0]
      }, [list])
      const [reference, setReference] = React.useState(null)
      const [failure, setFailure] = React.useState(null)
      const [layout, setLayout] = React.useState(readLayout)
      const registered = allPanels.filter((panel) => core.effectiveSide(layout, panel.id, panel.side) === 'right')
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
          setLayout((current) => { const copy = core.cloneLayout(current); copy.width = next; return copy })
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

    // Geometry of the approved position: right of the transcript drag handle, left
    // of the turn navigator, starting under the conversation tab strip. Both anchors
    // belong to the shipped layout, so they are measured, never assumed; when they
    // are missing the strip falls back to the conversation's right edge.
    function measureAnchors() {
      if (typeof document === 'undefined') return null
      const rect = (el) => el.getBoundingClientRect()
      let left = null
      let right = null
      let top = 6
      try {
        const handle = [...document.querySelectorAll('[class*="widthHandle"]')].find((el) => el.getAttribute('data-side') === 'right')
        if (handle) left = Math.round(rect(handle).right) + 6
        const railXs = [...document.querySelectorAll('button[aria-label]')]
          .filter((el) => /turnNavigation|轮次|跳转/i.test(el.getAttribute('aria-label') || ''))
          .map((el) => Math.round(rect(el).left))
          .filter((x) => x > (left || 0) + 40)
        if (railXs.length) right = Math.round(Math.min(...railXs)) - 6
        const tabs = document.querySelector('[data-conversation-tabs]')
        if (tabs) top = Math.round(rect(tabs.parentElement || tabs).bottom) + 6
      } catch {}
      return { left, right, top }
    }

    function GutterStrip() {
      const [layout, setLayout] = useLayoutState()
      const all = useRegistry()
      const [anchors, setAnchors] = React.useState(() => measureAnchors())
      React.useEffect(() => {
        let raf = 0
        const sync = () => { raf = 0; setAnchors(measureAnchors()) }
        const schedule = () => { if (!raf) raf = requestAnimationFrame(sync) }
        window.addEventListener('resize', schedule)
        const timer = setInterval(schedule, 700)
        return () => { window.removeEventListener('resize', schedule); clearInterval(timer); if (raf) cancelAnimationFrame(raf) }
      }, [])
      if (layout.open !== true) return null
      if (readMode() !== 'gutter') return null
      // The takeover column owns the right side when it is active; never render the
      // gutter strip on top of it.
      if (typeof document !== 'undefined' && document.querySelector('[data-panel-dock-stage]')) return null
      // Without a conversation there are no anchors; the strip then floats at the
      // right edge so the icon still shows something useful on the home screen.
      const anchored = anchors && anchors.left !== null && anchors.right !== null
      const span = anchored ? anchors.right - anchors.left : core.clampWidth(layout.width)
      if (anchored && span < MIN_PANEL_WIDTH) return null
      const sideOf = (panel) => core.effectiveSide(layout, panel.id, panel.side)
      const rightPanels = all.filter((panel) => sideOf(panel) === 'right')
      const style = {
        position: 'fixed',
        top: anchored ? anchors.top : 8,
        bottom: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        minWidth: 0,
        boxSizing: 'border-box',
        pointerEvents: 'auto',
        zIndex: 30,
      }
      if (anchored) {
        style.right = Math.max(6, window.innerWidth - anchors.right)
        style.width = span
      } else {
        style.right = 8
        style.width = core.clampWidth(layout.width)
      }
      return h('div', { 'data-panel-dock-strip': '', 'data-panel-dock-mode': 'gutter', style },
        rightPanels.length === 0
          ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', padding: 8 } }, T('empty'))
          : rightPanels.map((panel) => renderPanel(panel, layout, setLayout)))
    }

    function LeftDock() {
      const registered = useRegistry()
      const [layout, setLayout] = React.useState(readLayout)
      React.useEffect(() => {
        const sync = () => setLayout(readLayout())
        listeners.add(sync)
        return () => { listeners.delete(sync) }
      }, [])
      const leftPanels = registered.filter((panel) => { const side = core.effectiveSide(layout, panel.id, panel.side); return side === 'left' })
      if (leftPanels.length === 0) return null
      return h('div', {
        'data-panel-dock-left': '',
        // The host footer is a nowrap flex row; a default flex item shrinks to zero
        // there. Claim the whole row width and refuse to shrink so the stack keeps
        // the sidebar width instead of collapsing to a sliver.
        style: { display: 'flex', flexDirection: 'column', gap: 6, flex: '0 0 100%', width: '100%', minWidth: 0, boxSizing: 'border-box' },
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

    // Keep the remembered open flag consistent with the panels that are actually on
    // the right: a move to the right opens the column, a move away closes it when
    // nothing is left there.
    function reconcileOpen(ctx, id, resolved) {
      const layout = readLayout()
      const anyRight = panels().some((panel) => core.effectiveSide(layout, panel.id, panel.side) === 'right')
      const shouldOpen = resolved === 'right' || anyRight
      const nextLayout = Object.assign({}, layout, { open: shouldOpen })
      if (layout.open !== shouldOpen) writeLayout(nextLayout)
      // Only the takeover mode owns the conversation slot; gutter mode keeps the
      // shipped conversation and never selects this plugin's main panel.
      if (readMode() !== 'takeover') return
      try {
        const active = ctx.layout.panelInfo.getSnapshot().activePanelId
        if (shouldOpen && active !== KEY) ctx.layout.selectPanel(KEY)
        if (!shouldOpen && active === KEY) ctx.layout.selectPanel(null)
      } catch {}
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
        open: () => {
          setOpen(true)
          if (readMode() === 'takeover') { try { ctx.layout.selectPanel(KEY) } catch {} }
        },
        getMode: () => readMode(),
        setMode: (mode) => {
          writeMode(mode)
          if (mode === 'takeover' && isOpen()) { try { ctx.layout.selectPanel(KEY) } catch {} }
          if (mode === 'gutter') { try { ctx.layout.selectPanel(null) } catch {} }
          emit()
          return readMode()
        },
        close: () => {
          setOpen(false)
          try { ctx.layout.selectPanel(null) } catch {}
        },
        isOpen: () => { try { return ctx.layout.panelInfo.getSnapshot().activePanelId === KEY } catch { return false } },
        getWidth: () => readLayout().width,
        setWidth: (width) => { const next = core.cloneLayout(readLayout()); next.width = core.clampWidth(width); writeLayout(next); emit(); return next.width },
        setCollapsed: (id, value) => { const next = core.cloneLayout(readLayout()); if (value) next.collapsed[id] = true; else delete next.collapsed[id]; writeLayout(next); emit(); return Boolean(next.collapsed[id]) },
        toggle: (id) => { const current = readLayout(); const next = core.toggleCollapsed(current, id); writeLayout(next); emit(); return Boolean(next.collapsed[id]) },
        getLayout: () => readLayout(),
        getSide: (id) => { const layout = readLayout(); const panel = registry.get(id); return core.effectiveSide(layout, id, panel ? panel.side : 'right') },
        setSide: (id, side) => {
          const next = core.withSide(readLayout(), id, side);
          writeLayout(next);
          emit();
          // Moving a panel to the right column only makes sense if the column is
          // visible, so opening it is part of the move rather than a second step.
          reconcileOpen(ctx, id, core.effectiveSide(next, id, 'right'))
          return Boolean(side)
        },
        toggleSide: (id) => {
          const layout = readLayout();
          const panel = registry.get(id);
          const current = core.effectiveSide(layout, id, panel ? panel.side : 'right');
          const next = core.withSide(layout, id, core.otherSide(current));
          writeLayout(next);
          emit();
          const resolved = core.effectiveSide(next, id, panel ? panel.side : 'right');
          reconcileOpen(ctx, id, resolved)
          return resolved
        },
      }
      try { window.__dshPanelDock = api } catch {}
      try { ctx.effect(() => { const previous = window.__dshPanelDock; return () => { if (window.__dshPanelDock === api) window.__dshPanelDock = undefined } }, 'panel-dock: global') } catch {}
      // Register the sidebar entries at the top level: entries contributed from
      // inside another entry's effect are torn down when that entry is not active,
      // which would hide the left stack whenever the right column is closed.
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: KEY, order: 25, label: () => T('panel'), locale: NS }, PanelIcon))
      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: KEY, order: 900, label: () => T('panel'), locale: NS }, LeftDock))
      // Remember whether the user keeps this column open, so a reload restores it.
      ctx.effect(() => {
        const source = ctx.layout && ctx.layout.panelInfo
        if (!source || typeof source.getSnapshot !== 'function') return undefined
        const read = () => { try { return source.getSnapshot().activePanelId === KEY } catch { return false } }
        let previous = read()
        const sync = () => {
          // Only the takeover mode binds the open flag to the conversation slot; in
          // gutter mode the strip is independent of who owns that slot.
          if (readMode() !== 'takeover') return
          const current = read()
          if (current === previous) return
          previous = current
          // Becoming the active panel opens the column; losing that slot does NOT
          // close it, because the host clears the active panel on page unload and a
          // reload must still find the column open. close() writes false explicitly.
          if (!current) return
          const layout = readLayout()
          if (layout.open !== true) writeLayout(Object.assign({}, layout, { open: true }))
        }
        const dispose = typeof source.subscribe === 'function' ? source.subscribe(sync) : null
        sync()
        return () => { if (typeof dispose === 'function') dispose() }
      }, 'panel-dock: remember open state')
      // Re-open the column on startup when the user left it open. Panels register
      // asynchronously and the main entry must exist first, so poll instead of
      // assuming everything is ready one tick after apply().
      ctx.effect(() => {
        let attempts = 0
        let timer = 0
        const tick = () => {
          attempts += 1
          if (attempts > 60) return
          const layout = readLayout()
          const hasRight = panels().some((panel) => core.effectiveSide(layout, panel.id, panel.side) === 'right')
          if (layout.open === true && hasRight && readMode() === 'takeover') {
            try {
              const before = ctx.layout.panelInfo.getSnapshot().activePanelId
              if (before !== KEY) selectOwnSlot(ctx, KEY)
              // selectPanel can be accepted before the keyed entry is registered, so the
              // only trustworthy success signal is the stage actually being in the DOM.
              if (document.querySelector('[data-panel-dock-stage]')) return
            } catch {}
          }
          if (readMode() === 'gutter') return
          timer = setTimeout(tick, 500)
        }
        timer = setTimeout(tick, 500)
        // Panels register at their own pace and the keyed entry appears later still,
        // so also retry whenever the registry changes instead of only on a timer.
        const unsubscribe = subscribe(() => {
          if (timer) clearTimeout(timer)
          attempts = 0
          timer = setTimeout(tick, 120)
        })
        return () => { if (timer) clearTimeout(timer); unsubscribe() }
      }, 'panel-dock: restore open state')
      // A previous takeover leaves this plugin as the active main panel; in gutter
      // mode the shipped conversation must own that slot, so clear it explicitly.
      if (readMode() === 'gutter') {
        setTimeout(() => {
          try {
            const info = ctx.layout.panelInfo.getSnapshot()
            if (info && info.activePanelId === KEY) ctx.layout.selectPanel(null)
          } catch {}
        }, 300)
      }
      // Wide viewports use the approved gutter position; narrow ones cannot hold a
      // readable panel there without covering conversation text, so that viewport
      // falls back to the full-height column and the slot is handed back when the
      // window grows again.
      ctx.effect(() => {
        let timer = 0
        const active = () => { try { return ctx.layout.panelInfo.getSnapshot().activePanelId === KEY } catch { return false } }
        const decide = () => {
          const layout = readLayout()
          const hasRight = panels().some((panel) => core.effectiveSide(layout, panel.id, panel.side) === 'right')
          if (readMode() !== 'gutter' || layout.open !== true || !hasRight) {
            if (active()) { try { ctx.layout.selectPanel(null) } catch {} }
            return
          }
          const anchors = measureAnchors()
          if (!anchors || anchors.left === null || anchors.right === null) return
          const span = anchors.right - anchors.left
          if (span < MIN_PANEL_WIDTH && !active()) selectOwnSlot(ctx, KEY)
          if (span >= MIN_PANEL_WIDTH && active()) { try { ctx.layout.selectPanel(null) } catch {} }
        }
        const onResize = () => {
          // Measuring requires the shipped layout, so hand the slot back before
          // deciding; the flicker lasts one debounce window.
          if (active()) { try { ctx.layout.selectPanel(null) } catch {} }
          clearTimeout(timer)
          timer = setTimeout(decide, 400)
        }
        window.addEventListener('resize', onResize)
        timer = setTimeout(decide, 700)
        return () => { window.removeEventListener('resize', onResize); clearTimeout(timer) }
      }, 'panel-dock: narrow viewport handoff')
      // In gutter mode the sidebar icon belongs to the strip, not to the conversation
      // slot: taking that slot over would hide the shipped layout for no reason.
      ctx.effect(() => {
        const source = ctx.layout && ctx.layout.panelInfo
        if (!source || typeof source.subscribe !== 'function') return undefined
        let previous = null
        const sync = () => {
          let active = null
          try { active = source.getSnapshot().activePanelId } catch (e) { return }
          if (active === previous) return
          previous = active
          if (active !== KEY) return
          if (suppressSlotSync) return
          if (readMode() === 'gutter') {
            setOpen(!isOpen())
            try { ctx.layout.selectPanel(null) } catch {}
            return
          }
          setOpen(true)
        }
        const dispose = source.subscribe(sync)
        return () => { if (typeof dispose === 'function') dispose() }
      }, 'panel-dock: sidebar icon toggles the strip')
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: KEY + '-gutter', order: 40, locale: NS }, GutterStrip))
      // The takeover column only renders when the gutter cannot hold the panels.
      ctx.slots.inject('main', function* () {
        yield ctx.slots.register({ name: 'main', key: KEY, locale: NS, children: { [VIEW_SLOT]: { kind: 'single', scope: 'session' } } }, Stage)
      })
      ctx.slots.inject(VIEW_SLOT, () => ctx.slots.register({ name: VIEW_SLOT, locale: NS }, ConversationSurface))
      try { console.log('panel-dock: apply done') } catch {}
    }

    return { inject: ['slots', 'sessions', 'locale', 'layout'], apply }
  },
})
