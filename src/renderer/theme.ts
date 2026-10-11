import type {ThemeMode} from '../theme.js'

export {nextThemeMode, type ThemeMode} from '../theme.js'

/** Colors live in styles.css; this just switches which set applies. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.dataset.theme = mode
}