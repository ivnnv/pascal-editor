import { create } from 'zustand'

/** Shift held down: snapping is off until it is let go, for fine placement. */
export const useSnappingHold = create<{ held: boolean; setHeld: (held: boolean) => void }>(
  (set) => ({
    held: false,
    setHeld: (held) => set({ held }),
  }),
)
