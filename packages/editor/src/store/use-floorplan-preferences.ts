'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface FloorplanPreferencesState {
  startNorthUp: boolean
  setStartNorthUp: (value: boolean) => void
}

const useFloorplanPreferences = create<FloorplanPreferencesState>()(
  persist(
    (set) => ({
      startNorthUp: true,
      setStartNorthUp: (value) => set({ startNorthUp: value }),
    }),
    { name: 'pascal-floorplan-preferences' },
  ),
)

export default useFloorplanPreferences
