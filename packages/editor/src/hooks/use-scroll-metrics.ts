'use client'

import { type RefObject, useEffect, useState } from 'react'

// Height (px) of the fade drawn over the bottom edge while more content sits below.
const FADE_PX = 40

export type ScrollMetrics = { top: number; height: number; client: number }

/** Live scroll position and sizes of a scroll container, as its content changes. */
export function useScrollMetrics(ref: RefObject<HTMLElement | null>, active = true) {
  const [metrics, setMetrics] = useState<ScrollMetrics>({ top: 0, height: 0, client: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el || !active) return
    const update = () => {
      const next = { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }
      setMetrics((prev) =>
        prev.top === next.top && prev.height === next.height && prev.client === next.client
          ? prev
          : next,
      )
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    // The content grows and shrinks as sections expand or the selection changes.
    const resize = new ResizeObserver(update)
    resize.observe(el)
    for (const child of el.children) resize.observe(child)
    const mutations = new MutationObserver(() => {
      for (const child of el.children) resize.observe(child)
      update()
    })
    mutations.observe(el, { childList: true })
    return () => {
      el.removeEventListener('scroll', update)
      resize.disconnect()
      mutations.disconnect()
    }
  }, [ref, active])

  return metrics
}

/** The style that fades a scroll container's bottom while it can scroll further down. */
export function scrollFadeStyle({ top, height, client }: ScrollMetrics) {
  if (height - top - client <= 1) return undefined
  const mask = `linear-gradient(to bottom, black calc(100% - ${FADE_PX}px), transparent)`
  return { maskImage: mask, WebkitMaskImage: mask }
}
