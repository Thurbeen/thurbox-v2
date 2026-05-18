/**
 * Theme palettes — eight presets matching v1 (four dark + four light).
 *
 * Each theme provides a small set of semantic colors. Ink resolves names
 * (`'cyan'`, `'magenta'`, …) through its own theme so they paint correctly
 * on any terminal; hex (`'#abcdef'`) bypasses that for finer control.
 */

export interface Theme {
  /** Display name in the picker. */
  label: string;
  /** Selected/focused accents (active session row, panel borders). */
  accent: string;
  /** Default foreground for chrome text (labels, hints). */
  text: string;
  /** Muted text for secondary info (dim hints, separators). */
  muted: string;
  /** Branch labels (worktree mode). */
  branch: string;
  /** Status pill colors. */
  statusRunning: string;
  statusIdle: string;
  statusError: string;
  /** Border color when a panel is focused. */
  borderFocused: string;
  /** Border color when a panel is unfocused. */
  borderUnfocused: string;
}

export const THEMES: Record<string, Theme> = {
  default: {
    label: 'Default',
    accent: 'cyan',
    text: 'white',
    muted: 'gray',
    branch: 'green',
    statusRunning: 'yellow',
    statusIdle: 'gray',
    statusError: 'red',
    borderFocused: 'cyan',
    borderUnfocused: 'gray',
  },
  catppuccinMocha: {
    label: 'Catppuccin Mocha',
    accent: '#89b4fa',
    text: '#cdd6f4',
    muted: '#6c7086',
    branch: '#a6e3a1',
    statusRunning: '#f9e2af',
    statusIdle: '#6c7086',
    statusError: '#f38ba8',
    borderFocused: '#89b4fa',
    borderUnfocused: '#45475a',
  },
  tokyoNight: {
    label: 'Tokyo Night',
    accent: '#7aa2f7',
    text: '#c0caf5',
    muted: '#565f89',
    branch: '#9ece6a',
    statusRunning: '#e0af68',
    statusIdle: '#565f89',
    statusError: '#f7768e',
    borderFocused: '#7aa2f7',
    borderUnfocused: '#414868',
  },
  gruvboxDark: {
    label: 'Gruvbox Dark',
    accent: '#83a598',
    text: '#ebdbb2',
    muted: '#928374',
    branch: '#b8bb26',
    statusRunning: '#fabd2f',
    statusIdle: '#928374',
    statusError: '#fb4934',
    borderFocused: '#83a598',
    borderUnfocused: '#504945',
  },
  catppuccinLatte: {
    label: 'Catppuccin Latte',
    accent: '#1e66f5',
    text: '#4c4f69',
    muted: '#9ca0b0',
    branch: '#40a02b',
    statusRunning: '#df8e1d',
    statusIdle: '#9ca0b0',
    statusError: '#d20f39',
    borderFocused: '#1e66f5',
    borderUnfocused: '#bcc0cc',
  },
  tokyoNightDay: {
    label: 'Tokyo Night Day',
    accent: '#2e7de9',
    text: '#3760bf',
    muted: '#8990b3',
    branch: '#587539',
    statusRunning: '#8c6c3e',
    statusIdle: '#8990b3',
    statusError: '#f52a65',
    borderFocused: '#2e7de9',
    borderUnfocused: '#a8aecb',
  },
  gruvboxLight: {
    label: 'Gruvbox Light',
    accent: '#076678',
    text: '#3c3836',
    muted: '#7c6f64',
    branch: '#79740e',
    statusRunning: '#b57614',
    statusIdle: '#7c6f64',
    statusError: '#9d0006',
    borderFocused: '#076678',
    borderUnfocused: '#bdae93',
  },
  solarizedLight: {
    label: 'Solarized Light',
    accent: '#268bd2',
    text: '#586e75',
    muted: '#93a1a1',
    branch: '#859900',
    statusRunning: '#b58900',
    statusIdle: '#93a1a1',
    statusError: '#dc322f',
    borderFocused: '#268bd2',
    borderUnfocused: '#93a1a1',
  },
};

// `themes.default` is declared above and cannot be removed; the type system
// can't see that, so we assert via the well-known constant rather than `!`.
const DEFAULT_THEME: Theme = THEMES.default as Theme;

export function themeFor(key: string): Theme {
  return THEMES[key] ?? DEFAULT_THEME;
}
