'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type HudPosition = { left: number; top: number; width: number }

interface HudPreferencesState {
  showHints: boolean
  // Only the header row shows, for every tool, until expanded again.
  collapsed: boolean
  // Where the panel was dragged to, in viewport pixels, and the width it had
  // there; null keeps its usual spot.
  position: HudPosition | null
  // The panel closed with its X, until the tool or gesture in hand changes.
  closedFor: string | null
  setShowHints: (value: boolean) => void
  setCollapsed: (value: boolean) => void
  setPosition: (position: HudPosition | null) => void
  closeFor: (key: string | null) => void
}

const useHudPreferences = create<HudPreferencesState>()(
  persist(
    (set) => ({
      showHints: true,
      collapsed: false,
      position: null,
      closedFor: null,
      setShowHints: (value) => set({ showHints: value, closedFor: null }),
      setCollapsed: (value) => set({ collapsed: value }),
      setPosition: (position) => set({ position }),
      closeFor: (key) => set({ closedFor: key }),
    }),
    {
      name: 'pascal-hud-preferences',
      partialize: (state) => ({
        showHints: state.showHints,
        collapsed: state.collapsed,
        position: state.position,
      }),
    },
  ),
)

export default useHudPreferences
