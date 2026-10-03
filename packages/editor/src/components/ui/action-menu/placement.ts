import { createContext, useContext } from 'react'

/** Viewport edge the action menu docks to. */
export type ActionMenuPlacement = 'bottom' | 'top' | 'left'

const ActionMenuPlacementContext = createContext<ActionMenuPlacement>('bottom')

export const ActionMenuPlacementProvider = ActionMenuPlacementContext.Provider

export function useActionMenuPlacement(): ActionMenuPlacement {
  return useContext(ActionMenuPlacementContext)
}

/** Side tooltips and popovers open toward, away from the docked edge. */
export function useActionMenuPopupSide(): 'top' | 'bottom' | 'right' {
  const placement = useActionMenuPlacement()
  if (placement === 'left') return 'right'
  return placement === 'top' ? 'bottom' : 'top'
}

/** True when the menu is a vertical rail and its groups stack top to bottom. */
export function useActionMenuVertical(): boolean {
  return useActionMenuPlacement() === 'left'
}
