'use client'

import { Icon } from '@iconify/react'
import {
  type AnyNode,
  type AnyNodeId,
  getInspectorExtensions,
  type IconRef,
  type InspectorExtension,
  useRegistryVersion,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { ChevronDown, ChevronLeft, GripHorizontal, RotateCcw, X } from 'lucide-react'
import Image from 'next/image'
import {
  type ComponentType,
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useIsMobile } from '../../../hooks/use-mobile'
import { clamp, DRAG_MARGIN, getDragBounds, usePanelDrag } from '../../../hooks/use-panel-drag'
import { IconRefImage } from '../icon-ref'
import {
  resolveActiveExtension,
  toggleCard,
  toggleExtension,
} from '../../../lib/inspector-card-mode'
import { cn } from '../../../lib/utils'
import { useInspectorExpanded, useInspectorHeight } from '../../../lib/inspector-expanded'
import { PanelSection } from '../controls/panel-section'
import { ErrorBoundary } from '../primitives/error-boundary'
import { useInRightStack } from '../right-stack'

// Body height (px) a resized inspector keeps under its header.
const MIN_BODY_HEIGHT = 80

/**
 * Host-supplied inspector footer (e.g. community's "Save as preset"). The
 * `PanelManager` provides it so every panel — including kind-owned
 * `customPanel`s that render their own `<PanelWrapper>` without threading a
 * `footer` prop — picks it up without per-kind wiring. An explicit `footer`
 * prop still wins over the context.
 */
export const InspectorFooterContext = createContext<React.ReactNode>(null)

interface PanelWrapperProps {
  title: string
  /** A short line above the title ("Room · Ground floor"). */
  kicker?: string
  /** Replaces the plain title, e.g. with the name edited in place. */
  titleContent?: React.ReactNode
  /** Either a URL path (legacy panels pass `/icons/floor.webp` etc.,
   *  rendered via next/image) OR a React node (registry-driven
   *  inspector renders `<Icon icon="lucide:fence" />` from
   *  `def.presentation.icon`). */
  icon?: string | React.ReactNode
  onClose?: () => void
  onReset?: () => void
  onBack?: () => void
  children: React.ReactNode
  /** Pinned below the scrollable body, inside the panel card. */
  footer?: React.ReactNode
  className?: string
  width?: number | string
}

export function PanelWrapper({
  title,
  kicker,
  titleContent,
  icon,
  onClose,
  onReset,
  onBack,
  children,
  footer,
  className,
  width = 320, // default width
}: PanelWrapperProps) {
  const isMobile = useIsMobile()
  const inStack = useInRightStack()
  const contextFooter = useContext(InspectorFooterContext)
  const resolvedFooter = footer ?? contextFooter

  const panelRef = useRef<HTMLDivElement>(null)

  // ── Plugin inspector extensions ────────────────────────────────────
  // The wrapper self-resolves the selected node instead of taking a prop:
  // kind-owned `customPanel`s (wall, slab, …) render their own
  // <PanelWrapper>, so this is the one spot every inspector card flows
  // through. Extensions only apply to a single-node selection.
  const registryVersion = useRegistryVersion()
  const selectedId = useViewer((s) =>
    s.selection.selectedIds.length === 1 ? s.selection.selectedIds[0] : undefined,
  ) as AnyNodeId | undefined
  // Subscribe to the selected node's *type* only — a string primitive that
  // doesn't change as fields are edited (same trick as ParametricInspector).
  const selectedType = useScene((s) => (selectedId ? (s.nodes[selectedId]?.type ?? null) : null))
  const installedPlugins = useScene((s) => s.installedPlugins)
  const extensions = useMemo(() => {
    // re-derive when plugin extensions register after mount (async plugin load)
    void registryVersion
    if (!selectedType) return []
    return getInspectorExtensions(selectedType).filter(
      (extension) => !extension.pluginId || installedPlugins.includes(extension.pluginId),
    )
  }, [selectedType, installedPlugins, registryVersion])

  // Which extension's content fills the card body (extension mode). The two
  // expanded modes are EITHER/OR: extension mode replaces the regular
  // controls; null shows the regular controls with no extension sections.
  // See `lib/inspector-card-mode.ts` for the transition table.
  const [activeExtensionId, setActiveExtensionId] = useState<string | null>(null)
  // Stale ids (kind changed, plugin gated off) fall back to regular mode.
  const activeExtension = resolveActiveExtension(activeExtensionId, extensions)

  // The panel is collapsed to just its header until the user expands it. The
  // choice is one editor preference for every inspector (room, wall, item…),
  // persisted, so every panel opens the way the user last left one.
  const collapsed = !useInspectorExpanded((state) => state.expanded)
  const setCollapsed = useCallback((next: boolean) => {
    useInspectorExpanded.getState().setExpanded(!next)
  }, [])

  const applyMode = useCallback(
    (next: { collapsed: boolean; activeExtensionId: string | null }) => {
      setCollapsed(next.collapsed)
      setActiveExtensionId(next.activeExtensionId)
    },
    [setCollapsed],
  )

  // Chevron / header press — collapsed → regular, regular → collapsed,
  // extension mode → regular (exit the extension first, stay expanded).
  const handleCardToggle = useCallback(() => {
    applyMode(toggleCard({ collapsed, activeExtensionId }))
  }, [applyMode, collapsed, activeExtensionId])

  // Folding the card forgets the active extension — extension mode is a
  // one-shot affordance of the header icon, not sticky panel state.
  useEffect(() => {
    if (collapsed) setActiveExtensionId(null)
  }, [collapsed])


  // Drag-to-reposition from the header. `offset` is a translation applied on
  // top of the default `top-20 right-4` anchor; null until first dragged.
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null)
  const { drag, isDragging, onPointerDown: handleHeaderPointerDown } = usePanelDrag(panelRef, {
    // A press that never turned into a drag is a click: the chevron's toggle.
    onClick: handleCardToggle,
    onEnd: (end) => setOffset((prev) => ({ x: (prev?.x ?? 0) + end.dx, y: (prev?.y ?? 0) + end.dy })),
  })
  const shown = drag
    ? { x: (offset?.x ?? 0) + drag.dx, y: (offset?.y ?? 0) + drag.dy }
    : offset

  // Height dragged from the bottom edge, one for every inspector like the
  // expanded choice. The CSS max height still caps it to the room it has.
  const height = useInspectorHeight((state) => state.height)
  const [isResizing, setIsResizing] = useState(false)
  const handleResizeDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current
    if (e.button !== 0 || !panel) return
    e.preventDefault()
    const rect = panel.getBoundingClientRect()
    const header = panel.querySelector<HTMLElement>('[data-panel-header]')?.offsetHeight ?? 0
    // The column's bottom in the right stack, else the viewer's.
    const floor =
      panel.closest('[data-right-stack]')?.getBoundingClientRect().bottom ??
      getDragBounds(panel).bottom - DRAG_MARGIN
    const startY = e.clientY
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    setIsResizing(true)
    const onMove = (move: PointerEvent) => {
      const next = clamp(rect.height + move.clientY - startY, header + MIN_BODY_HEIGHT, floor - rect.top)
      useInspectorHeight.getState().setHeight(next)
    }
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
      handle.removeEventListener('pointercancel', onUp)
      setIsResizing(false)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
    handle.addEventListener('pointercancel', onUp)
  }, [])

  // Expanding can grow the panel past an edge if it was dragged there while
  // collapsed — nudge it back inside the viewer bounds.
  useLayoutEffect(() => {
    if (isMobile || collapsed) return
    const el = panelRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bounds = getDragBounds(el)
    const left = clamp(rect.left, bounds.left + DRAG_MARGIN, bounds.right - rect.width - DRAG_MARGIN)
    const top = clamp(rect.top, bounds.top + DRAG_MARGIN, bounds.bottom - rect.height - DRAG_MARGIN)
    const dx = left - rect.left
    const dy = top - rect.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setOffset((prev) => ({ x: (prev?.x ?? 0) + dx, y: (prev?.y ?? 0) + dy }))
    }
  }, [collapsed, isMobile])

  return (
    <div
      className={cn(
        isMobile
          ? 'flex h-full w-full flex-col overflow-hidden bg-transparent dark:text-foreground'
          : inStack
            ? // In the shared right column: it grows down and scrolls on itself,
              // leaving the shortcuts card below it its room (`right-stack.tsx`).
              'pointer-events-auto relative flex max-h-full min-h-0 flex-[0_1_auto] flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-2xl backdrop-blur-xl dark:text-foreground'
          // Cap height at `100dvh - 154px` so a tall panel's bottom edge
          // aligns flush with the top of the floating bottom action bar.
          // Combined with `top-20` (80px), the panel's bottom sits at
          // `100dvh - 74px` — just clearing the bar without leaving a
          // visible gap. The inner `flex-1 overflow-y-auto` content area
          // (below) handles vertical scrolling when content exceeds the
          // cap.
          : 'pointer-events-auto fixed top-20 right-4 z-50 flex max-h-[calc(100dvh-154px)] flex-col overflow-hidden rounded-xl border border-border/50 bg-sidebar/95 shadow-2xl backdrop-blur-xl dark:text-foreground',
        className,
      )}
      data-panel-wrapper
      ref={panelRef}
      style={
        isMobile
          ? undefined
          : {
              width,
              height: !collapsed && height ? height : undefined,
              transform: shown ? `translate(${shown.x}px, ${shown.y}px)` : undefined,
            }
      }
    >
      {/* Header — desktop only; mobile sheet provides its own header. Doubles
          as the drag handle (grip in the middle) for repositioning the panel. */}
      {!isMobile && (
        <div
          className={cn(
            'relative flex select-none items-center justify-between px-3 py-3',
            !collapsed && 'border-border/50 border-b',
            isDragging ? 'cursor-grabbing' : 'cursor-grab',
          )}
          data-panel-header
          onPointerDown={handleHeaderPointerDown}
        >
          <div className={cn('flex min-w-0 items-center gap-2', titleContent && 'flex-1 pr-2')}>
            {onBack && (
              <button
                className="mr-1 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onBack}
                type="button"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            {icon &&
              (typeof icon === 'string' ? (
                <Image
                  alt=""
                  className="shrink-0 object-contain"
                  height={16}
                  src={icon}
                  width={16}
                />
              ) : (
                <span className="flex shrink-0 items-center justify-center">{icon}</span>
              ))}
            {kicker || titleContent ? (
              <div className="flex min-w-0 flex-1 flex-col">
                {kicker && (
                  <span className="truncate text-[11px] text-muted-foreground leading-tight" data-panel-kicker>
                    {kicker}
                  </span>
                )}
                {titleContent ?? (
                  <h2 className="truncate font-semibold text-foreground text-sm tracking-tight">
                    {title}
                  </h2>
                )}
              </div>
            ) : (
              <h2 className="truncate font-semibold text-foreground text-sm tracking-tight">
                {title}
              </h2>
            )}
          </div>

          {/* Centered grip — purely a visual drag affordance (a title edited in place takes its room). */}
          {!titleContent && (
            <GripHorizontal className="-translate-x-1/2 pointer-events-none absolute left-1/2 h-4 w-4 text-muted-foreground/40" />
          )}

          <div className="flex items-center gap-1">
            {onReset && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onReset}
                type="button"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            )}
            {/* Extension mode buttons — one icon per registered inspector
                extension, left of the chevron. Click swaps the card body to
                ONLY that extension's content (either/or with the regular
                controls); the active icon (highlighted) or the chevron
                returns to the regular controls. */}
            {extensions.map((extension) => {
              const isActive = !collapsed && activeExtensionId === extension.id
              return (
                <button
                  aria-label={isActive ? `Close ${extension.title}` : `Open ${extension.title}`}
                  aria-pressed={isActive}
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-md transition-colors',
                    isActive
                      ? 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30'
                      : 'bg-[#2C2C2E] text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground',
                  )}
                  key={extension.id}
                  onClick={() =>
                    applyMode(toggleExtension({ collapsed, activeExtensionId }, extension.id))
                  }
                  title={extension.title}
                  type="button"
                >
                  {renderExtensionIcon(extension.icon)}
                </button>
              )
            })}
            <button
              aria-expanded={!collapsed}
              aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
              onClick={handleCardToggle}
              type="button"
            >
              <ChevronDown
                className={cn('h-4 w-4 transition-transform', collapsed ? '' : 'rotate-180')}
              />
            </button>
            {onClose && (
              <button
                className="flex h-7 w-7 items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={onClose}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Content — hidden while the panel is collapsed (desktop). The two
          expanded modes are EITHER/OR: extension mode renders ONLY that
          extension's content; regular mode renders ONLY the kind's own
          controls (`children`). A stale extension id falls back to regular
          via `resolveActiveExtension`. */}
      {!(collapsed && !isMobile) && (
        <div className="no-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto" data-panel-scroll>
          {!isMobile && selectedId && activeExtension ? (
            <InspectorExtensionSection
              extension={activeExtension}
              key={activeExtension.id}
              nodeId={selectedId}
            />
          ) : (
            <>
              {/* The mobile sheet has its own header: a title edited in place moves into the body. */}
              {isMobile && titleContent && (
                <div className="flex flex-col px-4 pt-3">
                  {kicker && <span className="text-[11px] text-muted-foreground">{kicker}</span>}
                  {titleContent}
                </div>
              )}
              {children}
              {/* Mobile sheet has no header icons to swap modes — keep the
                  plugin sections appended after the kind's controls there. */}
              {isMobile &&
                selectedId &&
                extensions.map((extension) => (
                  <InspectorExtensionSection
                    defaultExpanded={false}
                    extension={extension}
                    key={extension.id}
                    nodeId={selectedId}
                  />
                ))}
            </>
          )}
        </div>
      )}

      {resolvedFooter && !(collapsed && !isMobile) && (
        <div className="shrink-0 border-border/50 border-t p-3">{resolvedFooter}</div>
      )}

      {/* Resize handle, as the sidebar's but along the bottom; double-click fits the content again. */}
      {!isMobile && !collapsed && (
        <div
          aria-label="Resize panel"
          className="group absolute inset-x-0 bottom-0 z-10 flex h-3 cursor-row-resize touch-none items-center justify-center"
          onDoubleClick={() => useInspectorHeight.getState().setHeight(null)}
          onPointerDown={handleResizeDown}
          role="separator"
        >
          <div
            className={cn(
              'h-1 w-8 rounded-full bg-neutral-500 transition-opacity',
              isResizing ? 'opacity-100' : 'opacity-60 group-hover:opacity-100',
            )}
          />
        </div>
      )}
    </div>
  )
}

// ─── Plugin inspector extensions ──────────────────────────────────────

/** 16px icon for an extension's header button — mirrors the parametric
 *  inspector's `renderIcon` (plain <img> so no next/image server deps). */
function renderExtensionIcon(ref: IconRef): React.ReactNode {
  if (ref.kind === 'url') {
    return <IconRefImage className="h-4 w-4 shrink-0" src={ref.src} />
  }
  if (ref.kind === 'iconify') {
    return <Icon height={16} icon={ref.name} width={16} />
  }
  if (ref.kind === 'svg') {
    return (
      <svg height={16} viewBox={ref.viewBox} width={16}>
        <path d={ref.path} fill="currentColor" />
      </svg>
    )
  }
  const LazyIcon = lazy(ref.module)
  return (
    <Suspense fallback={null}>
      <LazyIcon />
    </Suspense>
  )
}

// `React.lazy` once per loader so the resolved component keeps a stable
// identity across renders — same WeakMap pattern as `resolveCustomPanel`
// in parametric-inspector.tsx.
const extensionComponentCache = new WeakMap<
  InspectorExtension['component'],
  ComponentType<{ node: AnyNode }>
>()

function resolveExtensionComponent(
  extension: InspectorExtension,
): ComponentType<{ node: AnyNode }> {
  const cached = extensionComponentCache.get(extension.component)
  if (cached) return cached
  // `LazyComponent` is prop-agnostic; the inspector-extension contract is
  // that the default export accepts `{ node }` (see the type's docs).
  const Comp = lazy(extension.component) as unknown as ComponentType<{ node: AnyNode }>
  extensionComponentCache.set(extension.component, Comp)
  return Comp
}

/**
 * One plugin-contributed inspector section. Subscribes to the full node —
 * the section body reflects any edit — and hands it to the extension's
 * lazy component inside its own error boundary so a crashing plugin
 * section can't take down the inspector card. On desktop this is the
 * card's SOLE body while its extension is active (either/or with the
 * regular controls); the mobile sheet appends it after them instead.
 */
function InspectorExtensionSection({
  defaultExpanded = true,
  extension,
  nodeId,
}: {
  defaultExpanded?: boolean
  extension: InspectorExtension
  nodeId: AnyNodeId
}) {
  const node = useScene((s) => s.nodes[nodeId])
  if (!node) return null
  const Extension = resolveExtensionComponent(extension)
  return (
    <PanelSection defaultExpanded={defaultExpanded} title={extension.title}>
      <ErrorBoundary
        fallback={
          <p className="p-1 text-muted-foreground text-xs">
            “{extension.title}” hit an error and was unloaded for this session.
          </p>
        }
      >
        <Suspense fallback={null}>
          <Extension node={node} />
        </Suspense>
      </ErrorBoundary>
    </PanelSection>
  )
}
