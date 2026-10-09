'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// AIKAZA: what the measure tool snaps to, toggled live from its helper card.

export type MeasureSnapStrength = 'gentle' | 'normal' | 'strong'

export const MEASURE_SNAP_STRENGTH_SCALE: Record<MeasureSnapStrength, number> = {
  gentle: 0.6,
  normal: 1,
  strong: 1.6,
}

const NEXT_STRENGTH: Record<MeasureSnapStrength, MeasureSnapStrength> = {
  gentle: 'normal',
  normal: 'strong',
  strong: 'gentle',
}

export type MeasureSnapSettings = {
  corners: boolean
  faces: boolean
  // Land where a face crosses the horizontal or vertical through the previous point.
  squareUp: boolean
  // Also offer 45° directions from the previous point.
  diagonals: boolean
  // Line up with the measure's own previous points.
  align: boolean
  strength: MeasureSnapStrength
}

export const DEFAULT_MEASURE_SNAP_SETTINGS: MeasureSnapSettings = {
  corners: true,
  faces: true,
  squareUp: true,
  diagonals: false,
  align: true,
  strength: 'normal',
}

type MeasureSnapToggle = Exclude<keyof MeasureSnapSettings, 'strength'>

type MeasureSnapSettingsState = MeasureSnapSettings & {
  toggle: (key: MeasureSnapToggle) => void
  cycleStrength: () => void
  setStrength: (strength: MeasureSnapStrength) => void
}

const useMeasureSnapSettings = create<MeasureSnapSettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_MEASURE_SNAP_SETTINGS,
      toggle: (key) => set((state) => ({ [key]: !state[key] }) as Partial<MeasureSnapSettings>),
      cycleStrength: () => set((state) => ({ strength: NEXT_STRENGTH[state.strength] })),
      setStrength: (strength) => set({ strength }),
    }),
    {
      name: 'pascal-measure-snap-settings',
      partialize: ({ corners, faces, squareUp, diagonals, align, strength }) => ({
        corners,
        faces,
        squareUp,
        diagonals,
        align,
        strength,
      }),
    },
  ),
)

export default useMeasureSnapSettings
