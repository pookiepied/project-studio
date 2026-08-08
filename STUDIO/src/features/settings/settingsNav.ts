/**
 * Settings categories. `ready: false` entries render disabled so the
 * organizational pattern is visible before those sections exist.
 */
export const SETTINGS_SECTIONS = [
  { id: 'appearance', label: 'Appearance', ready: true },
  { id: 'account', label: 'Account', ready: false },
  { id: 'providers', label: 'Providers', ready: false },
  { id: 'models', label: 'Models', ready: false },
] as const

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']
