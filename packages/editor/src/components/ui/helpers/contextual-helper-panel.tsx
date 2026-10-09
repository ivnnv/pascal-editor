import { Icon } from '@iconify/react'
import { useSnappingHold } from '../../../lib/snapping-hold'
import type { ToolHint } from '@pascal-app/core'
import {
  Fragment,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import {
  CONTINUATION_PROFILES,
  type ContinuationContext,
} from '../../../lib/continuation'
import type { ContextualShortcutHint } from '../../../lib/contextual-help'
import {
  clamp,
  DRAG_MARGIN,
  getDragBounds,
  type PanelDrag,
  usePanelDrag,
} from '../../../hooks/use-panel-drag'
import type { HudTitle } from '../../../lib/hud-title'
import { hasActivePaintMaterial } from '../../../lib/material-paint'
import { usePaintRegionMode } from '../../../lib/paint-region-mode'
import { paintScopeLabel, type PaintScope } from '../../../lib/paint-scope'
import { sfxEmitter } from '../../../lib/sfx-bus'
import {
  cycleSnappingModeIn,
  resolveSnapFlags,
  type SnapContext,
  type SnappingMode,
} from '../../../lib/snapping-mode'
import { cn } from '../../../lib/utils'
import useEditor, { type GridSnapStep } from '../../../store/use-editor'
import useFenceCurveDraft from '../../../store/use-fence-curve-draft'
import useMeasureSnapSettings from '../../../store/use-measure-snap-settings'
import useHudPreferences, { type HudPosition } from '../../../store/use-hud-preferences'
import { IconRefGlyph } from '../icon-ref'
import { Checkbox } from '../primitives/checkbox'
import { ShortcutToken } from '../primitives/shortcut-token'
import { Switch } from '../primitives/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { useInRightStack } from '../right-stack'

// One muted container holds every row — passive key hints and interactive chips
// alike — so the HUD reads as a single panel, not a stack of floating pills. It
// opens with the tool in hand (icon, name, arming key), then the gesture rows,
// then — past a hairline — the mode chips (snapping, continuation, …) and Esc.
// A 2-track grid: column 1 sizes to `max-content` (the widest key across ALL
// rows), column 2 (`1fr`) is the label. Every row is a subgrid sharing those
// tracks, so labels align even when keys differ in width (⌘ vs Shift) or wrap to
// two lines. Near-opaque bg + single backdrop blur keeps active rows readable.
const CARD_CLASS =
  'pointer-events-none grid grid-cols-[max-content_1fr] gap-x-2.5 gap-y-1.5 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-md'
// On its own (no shared right column) it floats centred on the right edge.
const FLOATING_CLASS = 'fixed top-1/2 right-4 z-40 -translate-y-1/2'

const TOKEN_CLASS = 'h-5 px-1.5 text-[10px]'

// Each row spans both columns as its own subgrid, inheriting the container's
// tracks so its key/label cells land on the shared column lines.
const ROW_CLASS = 'col-span-2 grid grid-cols-subgrid'

// The key cell (column 1). `items-center` centres the token; the row's
// `items-start` keeps it on the label's first line when the label wraps.
const KEY_CELL_CLASS = 'flex items-center gap-1'

// Keys pressed together join with "+"; an entry that is itself an array is a
// group of alternatives and joins with "/" — so [['Cmd/Ctrl', 'Shift'],
// 'Left click'] reads "⌘ / ⇧ + click".
function ShortcutSequence({
  active = false,
  keys,
}: {
  active?: boolean
  keys: Array<string | string[]>
}) {
  return (
    <div className={KEY_CELL_CLASS}>
      {keys.map((entry, index) => (
        <Fragment key={`${String(entry)}-${index}`}>
          {index > 0 ? (
            <span className="font-medium text-[12px] text-muted-foreground/80 leading-none">
              +
            </span>
          ) : null}
          {Array.isArray(entry) ? (
            entry.map((alternative, altIndex) => (
              <Fragment key={`${alternative}-${altIndex}`}>
                {altIndex > 0 ? (
                  <span className="text-[9px] text-muted-foreground/70">/</span>
                ) : null}
                <ShortcutToken
                  className={cn(TOKEN_CLASS, active && 'border-white bg-white text-black shadow-sm')}
                  value={alternative}
                />
              </Fragment>
            ))
          ) : (
            <ShortcutToken
              className={cn(TOKEN_CLASS, active && 'border-white bg-white text-black shadow-sm')}
              value={entry}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}

// Shared single-line chip row (key cell + icon/label cell). Rendered either as a
// passive row (no `onClick`) or a clickable button. The outer container is
// `pointer-events-none`, so clickable chips opt back in.
function ChipRow({
  ariaLabel,
  disabled = false,
  guideTarget,
  icon,
  label,
  onClick,
  shortcut,
  tooltip,
}: {
  ariaLabel?: string
  disabled?: boolean
  /**
   * A static hook for a host app's first-run tour to point at, written to
   * `data-guide-target`. Nothing here reads it.
   */
  guideTarget?: string
  icon?: string
  label: string
  onClick?: () => void
  shortcut?: string
  tooltip?: string
}) {
  const body = (
    <>
      <span className={KEY_CELL_CLASS}>
        {shortcut ? <ShortcutToken className={TOKEN_CLASS} value={shortcut} /> : null}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
        {icon ? <Icon className="shrink-0" height={13} icon={icon} width={13} /> : null}
        <span className="truncate">{label}</span>
      </span>
    </>
  )

  if (!onClick) {
    return (
      <div className={cn(ROW_CLASS, 'items-center', disabled && 'opacity-45 saturate-0')}>{body}</div>
    )
  }

  const button = (
    <button
      aria-label={ariaLabel ?? label}
      className={cn(
        ROW_CLASS,
        'pointer-events-auto cursor-pointer items-center rounded-md text-left transition-colors hover:bg-muted/60',
        disabled && 'opacity-45 saturate-0',
      )}
      data-guide-target={guideTarget}
      onClick={onClick}
      type="button"
    >
      {body}
    </button>
  )

  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="left">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

const SNAPPING_MODE_ICONS = {
  grid: 'lucide:grid-2x2',
  lines: 'lucide:magnet',
  angles: 'lucide:triangle',
  off: 'lucide:ban',
} as const

const SNAPPING_MODE_LABELS = {
  grid: 'Grid',
  lines: 'Lines',
  angles: 'Angles',
  off: 'Off',
} as const

const GRID_SNAP_STEPS: GridSnapStep[] = [0.5, 0.25, 0.1, 0.05]

const snappingLabel = (mode: SnappingMode, held: boolean) =>
  held ? 'Snapping: Off (holding Shift)' : `Snapping: ${SNAPPING_MODE_LABELS[mode]}`

function nextGridSnapStep(step: GridSnapStep): GridSnapStep {
  const index = GRID_SNAP_STEPS.indexOf(step)
  return GRID_SNAP_STEPS[(index + 1) % GRID_SNAP_STEPS.length] ?? GRID_SNAP_STEPS[0]!
}

/**
 * The snapping mode on its own, at the bottom of the viewer, while the hints
 * panel that normally shows it is closed or folded: the mode decides where
 * things land, so it should never be invisible.
 */
function SnappingPill({ context }: { context: SnapContext }) {
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
  const held = useSnappingHold((s) => s.held)
  return (
    <button
      aria-label={snappingLabel(snappingMode, held)}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-background/95 px-3 py-1 text-muted-foreground text-xs shadow-lg backdrop-blur-md hover:text-foreground"
      onClick={() => {
        setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))
        sfxEmitter.emit('sfx:grid-snap')
      }}
      title="Snapping mode — click to cycle, hold Shift to place freely"
      type="button"
    >
      <Icon height={13} icon={SNAPPING_MODE_ICONS[held ? 'off' : snappingMode]} width={13} />
      {snappingLabel(snappingMode, held)}
    </button>
  )
}

// The active interaction's snapping controls, scoped to its context (wall / item
// / polygon) so each action shows only the modes that make sense for it.
function SnappingChips({ context }: { context: SnapContext }) {
  const snappingMode = useEditor((s) => s.snappingModeByContext[context])
  const held = useSnappingHold((s) => s.held)
  const setSnappingMode = useEditor((s) => s.setSnappingMode)
  const gridSnapStep = useEditor((s) => s.gridSnapStep)
  const setGridSnapStep = useEditor((s) => s.setGridSnapStep)

  const gridActive = resolveSnapFlags(snappingMode).grid

  return (
    <>
      <ChipRow
        ariaLabel={snappingLabel(snappingMode, held)}
        guideTarget="snap-mode"
        icon={SNAPPING_MODE_ICONS[held ? 'off' : snappingMode]}
        label={snappingLabel(snappingMode, held)}
        onClick={() => {
          setSnappingMode(context, cycleSnappingModeIn(context, snappingMode))
          sfxEmitter.emit('sfx:grid-snap')
        }}
        shortcut="Shift"
        tooltip="Snapping mode — click to cycle, hold Shift to place freely"
      />
      {gridActive ? (
        <ChipRow
          ariaLabel={`Grid step: ${gridSnapStep.toFixed(2)} m`}
          guideTarget="snap-grid-step"
          label={`Grid: ${gridSnapStep.toFixed(2)} m`}
          onClick={() => {
            setGridSnapStep(nextGridSnapStep(gridSnapStep))
            sfxEmitter.emit('sfx:grid-snap')
          }}
          shortcut="Ctrl"
          tooltip="Grid step — click or tap Ctrl to cycle"
        />
      ) : null}
    </>
  )
}

// AIKAZA: what the measure tool snaps to, switched live while measuring.
const MEASURE_SNAP_TOGGLES = [
  { key: 'corners', label: 'Corners', tooltip: 'Snap to wall corners' },
  { key: 'faces', label: 'Wall faces', tooltip: 'Snap to wall faces' },
  { key: 'squareUp', label: 'Square up', tooltip: 'Land level or plumb with the previous point' },
  { key: 'diagonals', label: '45°', tooltip: 'Also offer 45° lines from the previous point' },
  { key: 'align', label: 'Align', tooltip: 'Line up with the measure’s own points' },
] as const

const STRENGTH_OPTIONS = [
  { value: 'gentle', label: 'Gentle' },
  { value: 'normal', label: 'Normal' },
  { value: 'strong', label: 'Strong' },
] as const

function MeasureSnapChips() {
  const settings = useMeasureSnapSettings()
  return (
    <div className="pointer-events-auto col-span-2 mt-0.5 flex flex-col gap-1.5">
      <div className="font-semibold text-[10px] text-muted-foreground uppercase tracking-wider">
        Snapping
      </div>
      {MEASURE_SNAP_TOGGLES.map(({ key, label, tooltip }) => (
        <label
          className="flex cursor-pointer items-center justify-between gap-3 text-foreground/90 text-xs"
          key={key}
          title={tooltip}
        >
          <span>{label}</span>
          <Switch
            aria-label={label}
            checked={settings[key]}
            className="scale-90"
            onCheckedChange={() => settings.toggle(key)}
          />
        </label>
      ))}
      <div className="flex items-center justify-between gap-3 text-foreground/90 text-xs">
        <span title="How far snaps reach">Strength</span>
        <div className="flex rounded-md bg-white/5 p-0.5">
          {STRENGTH_OPTIONS.map(({ value, label }) => (
            <button
              aria-pressed={settings.strength === value}
              className={cn(
                'rounded px-1.5 py-0.5 text-[11px] transition-colors',
                settings.strength === value
                  ? 'bg-[var(--toggle-on,var(--primary))] text-white'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              key={value}
              onClick={() => settings.setStrength(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// A kind-owned live mode chip declared on a `ToolHint` (`hint.chip`) — the
// registry counterpart of the snapping / continuation chips above: shows the
// current value's label, and clicking the row (or the hint's key, handled by
// the tool itself) cycles it.
function ToolHintChipRow({ hint }: { hint: ToolHint & { chip: NonNullable<ToolHint['chip']> } }) {
  const { chip } = hint
  const value = useSyncExternalStore(chip.subscribe, chip.value, chip.value)
  const label = chip.labels[value] ?? hint.label
  return (
    <ChipRow
      ariaLabel={label}
      icon={chip.icons?.[value]}
      label={label}
      onClick={chip.cycle}
      shortcut={hint.key}
      tooltip={chip.tooltip}
    />
  )
}

function ContinuationChip({ context }: { context: ContinuationContext }) {
  const mode = useEditor((s) => s.getContinuation(context))
  const cycleContinuation = useEditor((s) => s.cycleContinuation)
  const profile = CONTINUATION_PROFILES[context]
  const label = profile.labels[mode] ?? mode
  const icon = profile.icons[mode] ?? 'lucide:repeat'

  return (
    <ChipRow
      ariaLabel={`Continuation: ${label}`}
      icon={icon}
      label={label}
      onClick={() => cycleContinuation(context)}
      shortcut="C"
      tooltip="Continuation — click or press C to cycle"
    />
  )
}

function FenceContinuationChips() {
  const mode = useEditor((s) => s.getContinuation('fence'))
  const setContinuation = useEditor((s) => s.setContinuation)
  const curveStarted = useFenceCurveDraft((s) => s.pointCount > 0)

  const isCurved = mode === 'curved'
  const isFreehand = mode === 'freehand'
  const straightMode = isCurved ? 'continuous' : mode
  const typeLabel = isFreehand ? 'Type: Freehand' : isCurved ? 'Type: Curved' : 'Type: Straight'
  const typeIcon = isFreehand ? 'lucide:scribble' : isCurved ? 'lucide:spline' : 'lucide:minus'
  const nextType =
    mode === 'continuous' || mode === 'single'
      ? 'curved'
      : mode === 'curved'
        ? 'freehand'
        : 'continuous'

  return (
    <>
      <ChipRow
        ariaLabel={`Fence type: ${typeLabel.replace('Type: ', '')}`}
        icon={typeIcon}
        label={typeLabel}
        onClick={() => setContinuation('fence', nextType)}
        shortcut="T"
        tooltip="Fence type — click or press T to switch between straight, curved and freehand"
      />
      <ChipRow
        ariaLabel={`Fence continuation: ${straightMode === 'single' ? 'Single' : 'Continuous'}`}
        disabled={isCurved || isFreehand}
        icon={straightMode === 'single' ? 'lucide:minus' : 'lucide:waypoints'}
        label={straightMode === 'single' ? 'Straight: Single' : 'Straight: Continuous'}
        onClick={
          isCurved || isFreehand
            ? undefined
            : () => setContinuation('fence', straightMode === 'single' ? 'continuous' : 'single')
        }
        shortcut="C"
        tooltip={
          isCurved || isFreehand
            ? 'Straight continuation is unavailable for curved or freehand fences'
            : 'Straight fence continuation — click or press C to toggle'
        }
      />
      {/* Curved fences are committed by a closing gesture rather than per-click,
          so the finish keys aren't discoverable on their own — surface them, but
          only once the user has placed a point and a curve is actually in flight. */}
      {(isCurved || isFreehand) && curveStarted ? (
        <ChipRow
          icon="lucide:circle-check"
          label={isFreehand ? 'Drag to draw fence' : 'Finish curve (or double-click)'}
          shortcut={isFreehand ? 'Release' : 'Enter'}
        />
      ) : null}
    </>
  )
}

const PAINT_SCOPE_ICONS: Record<PaintScope, string> = {
  single: 'lucide:square',
  object: 'lucide:box',
  matching: 'lucide:copy',
  room: 'lucide:scan',
}

// Why the last paint click did nothing (a surface that has no finish of its
// own to paint), in the same "!" row the region gestures use for a refusal.
function PaintNotice() {
  const notice = usePaintRegionMode((s) => s.notice)
  // Leaving the painter forgets it.
  useEffect(() => () => usePaintRegionMode.getState().setNotice(null), [])
  return notice ? <HintRow hint={{ keys: ['!'], label: notice, active: true }} /> : null
}

// The painter's application-scope chip. Driven entirely by the hovered node's
// derived `paintHover` (scopes + labels), so it works for any kind without a
// per-target table.
function PaintScopeChip() {
  // What the cursor is over (that's what the next click paints). `null` when not
  // over a paintable surface — including an item with no slots.
  const paintHover = useEditor((s) => s.paintHover)
  const paintScope = useEditor((s) => s.paintScope)
  const cyclePaintScope = useEditor((s) => s.cyclePaintScope)
  const activePaintMaterial = useEditor((s) => s.activePaintMaterial)
  const paintMode = usePaintRegionMode((s) => s.mode)
  const paintEraser = paintMode === 'erase'
  const picking = paintMode === 'pick'
  const verb = picking ? 'Pick' : paintEraser ? 'Erase' : 'Paint'

  // Nothing to paint with yet (no material picked, not erasing) → the first step
  // is choosing a material, so say that before anything about scope or hovering.
  if (!(paintEraser || picking || hasActivePaintMaterial(activePaintMaterial))) {
    return <ChipRow icon="lucide:palette" label="Select a material to paint" />
  }

  // Not over anything paintable → guide the user to hover, still teaching Shift.
  if (!paintHover) {
    return (
      <ChipRow
        icon="lucide:mouse-pointer-click"
        label={
          picking
            ? 'Hover a surface to pick its material'
            : paintEraser
              ? 'Hover a painted surface to erase'
              : 'Hover a surface to paint'
        }
        shortcut={picking ? undefined : 'Shift'}
      />
    )
  }

  const { scopes } = paintHover
  // A scope carried over from another node (the mode is global) falls back to
  // the narrowest for both display and — via the apply-time resolver — behaviour.
  const effective: PaintScope = scopes.includes(paintScope) ? paintScope : 'single'

  // Paintable but with no scope choice (roof, a one-slot node, …) → a passive
  // row that still names the surface, so the user always sees what they'll paint.
  if (scopes.length <= 1 || picking) {
    return (
      <ChipRow
        icon={picking ? 'lucide:pipette' : PAINT_SCOPE_ICONS[effective]}
        label={`${verb}: ${paintScopeLabel(picking ? 'single' : effective, paintHover)}`}
      />
    )
  }

  return (
    <ChipRow
      ariaLabel={`${verb} scope: ${paintScopeLabel(effective, paintHover)}`}
      icon={PAINT_SCOPE_ICONS[effective]}
      label={`${verb}: ${paintScopeLabel(effective, paintHover)}`}
      onClick={() => cyclePaintScope()}
      shortcut="Shift"
      tooltip={`${verb} scope — click or press Shift to cycle`}
    />
  )
}

// The tool in hand: its icon, name and arming key, over a hairline.
function HudHeader({
  title,
  collapsed,
  onClose,
  onPointerDown,
}: {
  title: HudTitle
  collapsed: boolean
  onClose: () => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  return (
    <div
      className={cn(
        'pointer-events-auto relative col-span-2 flex cursor-grab touch-none select-none items-center gap-2.5 active:cursor-grabbing',
        !collapsed && 'mb-0.5 border-border border-b pb-2.5',
      )}
      onPointerDown={onPointerDown}
      data-hud-title={title.label}
    >
      {title.icon ? (
        <span className="flex size-7 shrink-0 items-center justify-center">
          <IconRefGlyph icon={title.icon} size={26} />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate font-medium text-[13px] text-foreground leading-tight">
        {title.label}
      </span>
      {title.shortcut ? <ShortcutToken className={TOKEN_CLASS} value={title.shortcut} /> : null}
      <Icon
        className="-translate-x-1/2 pointer-events-none absolute left-1/2 text-muted-foreground/40"
        height={16}
        icon="lucide:grip-horizontal"
        width={16}
      />
      <HudButtons collapsed={collapsed} onClose={onClose} />
    </div>
  )
}

const HUD_BUTTON_CLASS =
  'flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md bg-[#2C2C2E] text-muted-foreground transition-colors hover:bg-[#3e3e3e] hover:text-foreground'

function HudButtons({
  collapsed,
  onClose,
  className,
}: {
  collapsed: boolean
  onClose: () => void
  className?: string
}) {
  return (
    <div className={cn('pointer-events-auto -mr-1 flex shrink-0 items-center gap-1', className)}>
      <button
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand shortcut hints' : 'Collapse shortcut hints'}
        className={HUD_BUTTON_CLASS}
        onClick={() => useHudPreferences.getState().setCollapsed(!collapsed)}
        type="button"
      >
        <Icon
          className={cn('transition-transform', !collapsed && 'rotate-180')}
          height={14}
          icon="lucide:chevron-down"
          width={14}
        />
      </button>
      <button
        aria-label="Close shortcut hints"
        className={HUD_BUTTON_CLASS}
        onClick={onClose}
        type="button"
      >
        <Icon height={14} icon="lucide:x" width={14} />
      </button>
    </div>
  )
}

const UNTITLED_HUD: HudTitle = { label: 'Shortcuts' }

// Drag the card by its header, with the inspector's drag. Once moved it floats
// on its own over the viewer, out of the right column that would clip it.
function useHudDrag(
  card: React.RefObject<HTMLDivElement | null>,
  // The mounted card, as state: hiding and showing it again swaps the element.
  cardEl: HTMLDivElement | null,
  collapsed: boolean,
) {
  const saved = useHudPreferences((state) => state.position)
  // The saved spot pulled back inside the viewer when the window or the card
  // no longer fit it. Shown only: the saved spot stays as the user left it.
  const [fitted, setFitted] = useState<HudPosition | null>(null)
  const { drag, onPointerDown } = usePanelDrag(card, {
    onClick: () => useHudPreferences.getState().setCollapsed(!collapsed),
    onEnd: (end) => useHudPreferences.getState().setPosition(dragged(end)),
  })
  const position = drag ? dragged(drag) : (fitted ?? saved)

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-fit when the card changes size
  useLayoutEffect(() => {
    const el = cardEl
    if (!el || !saved) {
      setFitted(null)
      return
    }
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      const next = clampToViewer(saved.left, saved.top, width, height)
      const moved = Math.abs(next.left - saved.left) > 0.5 || Math.abs(next.top - saved.top) > 0.5
      setFitted(moved ? { ...next, width: saved.width } : null)
    }
    fit()
    // Rows come and go with the selection or gesture, as well as on collapse.
    const resize = new ResizeObserver(fit)
    resize.observe(el)
    window.addEventListener('resize', fit)
    return () => {
      resize.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [cardEl, collapsed, saved])

  return { position, onPointerDown }
}

const dragged = ({ rect, dx, dy }: PanelDrag): HudPosition => ({
  left: rect.left + dx,
  top: rect.top + dy,
  width: rect.width,
})

function clampToViewer(left: number, top: number, width: number, height: number) {
  const bounds = getDragBounds(null)
  return {
    left: clamp(left, bounds.left + DRAG_MARGIN, bounds.right - width - DRAG_MARGIN),
    top: clamp(top, bounds.top + DRAG_MARGIN, bounds.bottom - height - DRAG_MARGIN),
  }
}

const isEscHint = (hint: ContextualShortcutHint) =>
  hint.keys.length === 1 && hint.keys[0] === 'Esc'

function HintRow({ hint }: { hint: ContextualShortcutHint }) {
  return (
    <div className={cn(ROW_CLASS, 'items-start')}>
      <ShortcutSequence active={hint.active} keys={hint.keys} />
      <div className="min-w-0">
        <div
          className={cn(
            'text-xs leading-5',
            hint.active ? 'font-medium text-white' : 'text-muted-foreground',
          )}
        >
          {hint.label}
        </div>
        {hint.subtitle ? (
          <div className="text-[10px] text-muted-foreground/70 leading-snug">{hint.subtitle}</div>
        ) : null}
      </div>
    </div>
  )
}

const hintKey = (hint: ContextualShortcutHint) => `${hint.keys.join('+')}:${hint.label}`

export function ContextualHelperPanel({
  hints,
  chipHints = [],
  snapContext: snapContextProp = null,
  showPaintScope = false,
  continuationContext = null,
  title = null,
  notice = null,
}: {
  hints: ContextualShortcutHint[]
  // Kind-owned live mode chips (`ToolHint.chip`), rendered alongside the
  // snapping / continuation chips.
  chipHints?: ToolHint[]
  // The active snapping context drives the snapping chips (which mode set). Null
  // → no snapping chips for this interaction.
  snapContext?: SnapContext | null
  showPaintScope?: boolean
  continuationContext?: ContinuationContext | null
  // The tool or gesture in hand, shown as the panel's header.
  title?: HudTitle | null
  // A warning about what is in hand (a floor item in a door's way), in the "!" row.
  notice?: string | null
}) {
  const inStack = useInRightStack()
  const showHints = useHudPreferences((state) => state.showHints)
  const closedFor = useHudPreferences((state) => state.closedFor)
  const collapsed = useHudPreferences((state) => state.collapsed)
  const [dontShowAgain, setDontShowAgain] = useState(false)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null)
  const { position, onPointerDown } = useHudDrag(cardRef, cardEl, collapsed)
  const modeChips = chipHints.filter((hint) => hint.chip)
  const measuring = useEditor(
    (state) =>
      state.mode === 'build' &&
      state.tool === 'measurement' &&
      state.toolDefaults.measurement?.kind !== 'smart' &&
      // The options steer the floor plan's measure tool, not the 3D one.
      state.viewMode !== '3d',
  )
  // The measure tool snaps by its own chips; the drawing snap mode doesn't apply to it.
  const snapContext = measuring ? null : snapContextProp
  const hasChips =
    !!snapContext || !!continuationContext || modeChips.length > 0 || showPaintScope || measuring
  const panelKey = title?.label ?? hints.map(hintKey).join('|')
  // A plain close lasts while this tool or gesture is in hand.
  useEffect(() => {
    if (closedFor && closedFor !== panelKey) useHudPreferences.getState().closeFor(null)
  }, [closedFor, panelKey])
  const fenceFeature = useEditor((state) =>
    state.mode === 'build' && state.tool === 'fence' ? state.toolDefaults.fence?.featurePlacement : null,
  )
  const close = () => {
    if (dontShowAgain) useHudPreferences.getState().setShowHints(false)
    else useHudPreferences.getState().closeFor(panelKey)
  }
  if (fenceFeature === 'gate' || fenceFeature === 'opening') {
    if (!showHints || closedFor === panelKey) return null
    return (
      <div className={cn(CARD_CLASS, !inStack && FLOATING_CLASS)} data-hud-card>
        <HudHeader
          collapsed={false}
          onClose={close}
          onPointerDown={() => {}}
          title={title ?? UNTITLED_HUD}
        />
        <ChipRow
          label={fenceFeature === 'gate' ? 'Place gate on a fence' : 'Place passage on a fence'}
          shortcut="Left click"
        />
        <ChipRow label="Cancel placement" shortcut="Esc" />
      </div>
    )
  }
  if (hints.length === 0 && !hasChips && !notice) return null
  const pill = snapContext ? <SnappingPill context={snapContext} /> : null
  if (!showHints || closedFor === panelKey) return pill


  const actionHints = hints.filter((hint) => !isEscHint(hint))
  const escHints = hints.filter(isEscHint)

  const card = (
    <div
      className={cn(
        CARD_CLASS,
        // In the right column it matches the inspector above it.
        !position && (inStack ? 'w-(--right-stack-inspector-width,252px)' : 'w-[252px]'),
        position ? 'fixed top-0 left-0 z-40 will-change-transform' : !inStack && FLOATING_CLASS,
      )}
      data-hud-card
      ref={(el) => {
        cardRef.current = el
        setCardEl(el)
      }}
      style={
        position
          ? {
              transform: `translate3d(${position.left}px, ${position.top}px, 0)`,
              width: position.width,
            }
          : undefined
      }
    >
      <HudHeader
        collapsed={collapsed}
        onPointerDown={onPointerDown}
        onClose={close}
        title={title ?? UNTITLED_HUD}
      />
      {collapsed ? null : (
        <>
      {actionHints.map((hint) => (
        <HintRow hint={hint} key={hintKey(hint)} />
      ))}
      {notice ? <HintRow hint={{ keys: ['!'], label: notice, active: true }} /> : null}
      {actionHints.length > 0 && (hasChips || escHints.length > 0) ? (
        <div className="col-span-2 my-0.5 h-px bg-border" />
      ) : null}
      {snapContext ? <SnappingChips context={snapContext} /> : null}
      {measuring ? <MeasureSnapChips /> : null}
      {continuationContext === 'fence' ? <FenceContinuationChips /> : null}
      {continuationContext && continuationContext !== 'fence' ? (
        <ContinuationChip context={continuationContext} />
      ) : null}
      {modeChips.map((hint) => (
        <ToolHintChipRow
          hint={hint as ToolHint & { chip: NonNullable<ToolHint['chip']> }}
          key={`${hint.key}:${hint.label}`}
        />
      ))}
      {showPaintScope ? <PaintNotice /> : null}
      {showPaintScope ? <PaintScopeChip /> : null}
      {escHints.map((hint) => (
        <HintRow hint={hint} key={hintKey(hint)} />
      ))}
      <label className="pointer-events-auto col-span-2 mt-0.5 flex cursor-pointer items-center gap-1.5 text-[10px] text-muted-foreground">
        <Checkbox checked={dontShowAgain} onCheckedChange={setDontShowAgain} />
        Don't show again when closed
      </label>
        </>
      )}
    </div>
  )
  const placed = position ? createPortal(card, document.body) : card
  return collapsed && pill ? (
    <>
      {placed}
      {pill}
    </>
  ) : (
    placed
  )
}
