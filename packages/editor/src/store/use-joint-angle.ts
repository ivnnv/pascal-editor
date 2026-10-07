import { create } from 'zustand'

/** An angle a drawn or dragged wall makes at a corner, while it sits on a 45° step. */
export type JointAngle = {
  x: number
  z: number
  deg: number
  // Unit vector into the angle, where its badge sits.
  bisector: { x: number; z: number }
  // Distance (m) along the bisector to where the walls' inner faces meet.
  clearance: number
}

const useJointAngle = create<{ angles: JointAngle[]; set: (angles: JointAngle[]) => void }>(
  (set) => ({
    angles: [],
    set: (angles) => set({ angles }),
  }),
)

export default useJointAngle
