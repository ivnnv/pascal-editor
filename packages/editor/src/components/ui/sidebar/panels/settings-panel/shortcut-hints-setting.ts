'use client'

import useHudPreferences from './../../../../../store/use-hud-preferences'

/** The "Show shortcut hints" switch: on unless the hints were closed for good. */
export function useShortcutHintsSetting() {
  const checked = useHudPreferences((state) => state.showHints)
  return {
    checked,
    onCheckedChange: (value: boolean) => useHudPreferences.getState().setShowHints(value),
  }
}
