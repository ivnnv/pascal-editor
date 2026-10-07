'use client'
import {
  type AnyNodeId,
  planWallMerge,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import {
  captureElementActionOrigin,
  cn,
  completeElementAction,
  triggerSFX,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { FoldHorizontal, Scissors } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { openWallSplit } from './split-session'

const BUTTON =
  'tooltip-trigger rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50'

/** The wall's action-menu contributions: Split (one wall) and Merge (several). */
export default function WallActions() {
  return (
    <>
      <SplitWallAction />
      <MergeWallsAction />
    </>
  )
}

function SplitWallAction() {
  const selected = useViewer((s) => s.selection.selectedIds)
  const wall = useScene((s) =>
    selected.length === 1 ? s.nodes[selected[0] as AnyNodeId] : undefined,
  )
  const readOnly = useScene((s) => s.readOnly)
  if (wall?.type !== 'wall') return null
  return (
    <button
      type="button"
      aria-label="Split wall"
      title="Split wall"
      disabled={readOnly}
      className={BUTTON}
      onClick={(event) => {
        event.stopPropagation()
        openWallSplit(wall)
      }}
    >
      <Scissors className="size-4" />
    </button>
  )
}

/**
 * Joins selected walls that continue each other into one — the inverse of
 * Split. When it cannot, a click says why right in the menu; when it has to
 * settle something (a thickness), the first click says what, the second merges.
 */
function MergeWallsAction() {
  const selected = useViewer((s) => s.selection.selectedIds) as AnyNodeId[]
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const [message, setMessage] = useState<string | null>(null)
  // null: not a wall selection (render nothing).
  const merge = useMemo(() => {
    if (selected.length < 2 || selected.some((id) => nodes[id]?.type !== 'wall')) return null
    try {
      return { reason: null, notes: planWallMerge(nodes, selected).notes }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'These walls cannot be merged.'
      return { reason, notes: [] as string[] }
    }
  }, [nodes, selected])
  // A new selection starts over.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on selection change
  useEffect(() => setMessage(null), [selected])
  if (!merge) return null
  const { reason, notes } = merge
  const doMerge = () => {
    const plan = planWallMerge(useScene.getState().nodes, selected)
    // Walls drilled from one room go back to it; otherwise the merged wall stays selected.
    const origin = captureElementActionOrigin(selected)
    runAsSingleSceneHistoryStep(useScene, () => useScene.getState().applyNodeChanges(plan.changes))
    triggerSFX('sfx:structure-build')
    setMessage(null)
    if (origin) completeElementAction(origin)
    else useViewer.getState().setSelection({ selectedIds: [plan.wallId] })
  }
  return (
    <>
      <button
        type="button"
        aria-label="Merge walls"
        title={reason ?? notes[0] ?? 'Merge walls'}
        disabled={readOnly}
        className={cn(BUTTON, reason && 'opacity-50')}
        onClick={(event) => {
          event.stopPropagation()
          if (reason) return setMessage(reason)
          // A note is shown once before merging, so the change is not a surprise.
          if (notes.length > 0 && message !== notes.join(' ')) return setMessage(notes.join(' '))
          doMerge()
        }}
      >
        <FoldHorizontal className="size-4" />
      </button>
      {message ? (
        <span
          className={cn(
            'max-w-56 self-center px-1.5 text-[11px] leading-tight',
            reason ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          )}
          role="status"
        >
          {reason ? message : `${message} Click again to merge.`}
        </span>
      ) : null}
    </>
  )
}
