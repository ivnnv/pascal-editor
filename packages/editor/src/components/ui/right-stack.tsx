'use client'

import { createContext, type ReactNode, useContext, useEffect, useRef } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'

const RightStackContext = createContext(false)

/** Whether a panel renders inside the shared right column (in flow) rather than on its own. */
export function useInRightStack() {
  return useContext(RightStackContext)
}

/** The inspector never shrinks below this (or its own height, if shorter) for the card, px. */
const INSPECTOR_MIN_HEIGHT = 180

/** Gap between the inspector and the card, px (`gap-2`). */
const GAP = 8

/**
 * The heights neither panel shrinks below. The inspector keeps 180 px (or its
 * own height, if shorter) while the full card fits under it, and never less
 * than its header row. The card shows in full whenever the column allows; on a
 * very short window it gives way and scrolls on itself — both stay usable.
 */
export function rightStackFloors(args: {
  naturalHeight: number
  headerHeight: number
  cardHeight: number
  stackHeight: number
}): { inspector: number; card: number } {
  const { naturalHeight, headerHeight, cardHeight, stackHeight } = args
  const gap = naturalHeight > 0 && cardHeight > 0 ? GAP : 0
  const header = Math.min(headerHeight, naturalHeight)
  const inspector = Math.max(
    header,
    Math.min(INSPECTOR_MIN_HEIGHT, naturalHeight, stackHeight - cardHeight - gap),
  )
  const card = Math.max(0, Math.min(cardHeight, stackHeight - gap - inspector))
  return { inspector, card }
}

// What the card holds, not `scrollHeight`: that counts the min-height set here,
// so a card that closed or floated away would keep its old room.
function cardContentHeight(card: HTMLElement): number {
  let height = 0
  for (const child of card.children) height += (child as HTMLElement).offsetHeight
  return height
}

/** The inspector's full height: its header plus everything its scroller holds. */
function inspectorHeights(slot: HTMLElement): { natural: number; header: number } {
  const panel = slot.querySelector<HTMLElement>('[data-panel-wrapper]')
  if (!panel) return { natural: 0, header: 0 }
  const header = panel.querySelector<HTMLElement>('[data-panel-header]')?.offsetHeight ?? 0
  const scroller = panel.querySelector<HTMLElement>('[data-panel-scroll]')
  if (!scroller) return { natural: panel.offsetHeight, header }
  return { natural: panel.offsetHeight - scroller.clientHeight + scroller.scrollHeight, header }
}

// Read by the shortcuts card (`contextual-helper-panel.tsx`).
const INSPECTOR_WIDTH_VAR = '--right-stack-inspector-width'

/**
 * The right-hand column: the shortcuts card shows in full at the bottom, and
 * the node inspector takes the space above it, growing down from the top and
 * scrolling on itself. On a very short window the inspector keeps its header
 * and the card scrolls instead. Neither hides the other. On a phone the two
 * keep their own layouts (sheet / no card).
 */
export function RightStack({ inspector, helper }: { inspector: ReactNode; helper: ReactNode }) {
  const isMobile = useIsMobile()
  const stackRef = useRef<HTMLDivElement>(null)
  const inspectorRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // `min(180px, its own height)` has no CSS form for a flex item that scrolls,
  // so both floors are measured (`rightStackFloors`).
  useEffect(() => {
    if (isMobile) return
    const stack = stackRef.current
    const slot = inspectorRef.current
    const card = cardRef.current
    if (!(stack && slot && card)) return
    let frame = 0
    const fit = () => {
      frame = 0
      const { natural, header } = inspectorHeights(slot)
      const cardHeight = cardContentHeight(card)
      const floors = rightStackFloors({
        naturalHeight: natural,
        headerHeight: header,
        cardHeight,
        stackHeight: stack.clientHeight,
      })
      const inspectorMin = `${floors.inspector}px`
      const cardMin = `${floors.card}px`
      if (slot.style.minHeight !== inspectorMin) slot.style.minHeight = inspectorMin
      if (card.style.minHeight !== cardMin) card.style.minHeight = cardMin
      // AIKAZA: with no inspector open (nothing selected, a tool in hand) the
      // card moves up to the top, where it can't collide with anything.
      const cardTop = natural === 0 ? '0px' : ''
      if (card.style.marginTop !== cardTop) card.style.marginTop = cardTop
      // The card is click-through; it takes the pointer only when it has to scroll.
      const pointer = floors.card < cardHeight ? 'auto' : ''
      if (card.style.pointerEvents !== pointer) card.style.pointerEvents = pointer
      // The shortcuts card takes the inspector's width, so the two line up.
      const width = slot.offsetWidth > 0 ? `${slot.offsetWidth}px` : ''
      if (stack.style.getPropertyValue(INSPECTOR_WIDTH_VAR) !== width) {
        if (width) stack.style.setProperty(INSPECTOR_WIDTH_VAR, width)
        else stack.style.removeProperty(INSPECTOR_WIDTH_VAR)
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit)
    }
    const resize = new ResizeObserver(schedule)
    resize.observe(stack)
    resize.observe(slot)
    resize.observe(card)
    // Content growing inside the scroller changes no outer size, hence the mutation watch.
    // The same for the card: a new tool swaps its rows without resizing the slot.
    const mutation = new MutationObserver(schedule)
    for (const target of [slot, card])
      mutation.observe(target, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['class', 'hidden', 'aria-expanded'],
        characterData: true,
      })
    fit()
    return () => {
      if (frame) cancelAnimationFrame(frame)
      resize.disconnect()
      mutation.disconnect()
    }
  }, [isMobile])

  if (isMobile) {
    return (
      <>
        <div className="pointer-events-auto">{inspector}</div>
        <div className="pointer-events-auto">{helper}</div>
      </>
    )
  }

  return (
    <RightStackContext.Provider value={true}>
      <div
        className="pointer-events-none fixed top-20 right-4 bottom-[74px] z-40 flex flex-col items-end gap-2"
        data-right-stack
        ref={stackRef}
      >
        <div className="flex min-h-0 flex-[0_1_auto] flex-col items-end" ref={inspectorRef}>
          {inspector}
        </div>
        <div
          className="no-scrollbar mt-auto flex min-h-0 flex-[0_1_auto] flex-col overflow-y-auto rounded-xl"
          data-right-stack-card
          ref={cardRef}
        >
          {helper}
        </div>
      </div>
    </RightStackContext.Provider>
  )
}
