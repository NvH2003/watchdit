/** Warm charcoal — no purple or indigo. */
export const theme = {
  bg: '#121110',
  surface: '#1c1b19',
  elevated: '#262422',
  border: '#3a3632',
  text: '#f3efe8',
  muted: '#9a938a',
  faint: '#6e6860',
  accent: '#e85d4c',
  check: '#3dce7a',
  gold: '#d4a056',
  sky: '#4aa3c7',
  danger: '#e85d4c',
  glass: {
    fill: 'rgba(18, 17, 16, 0.52)',
    border: 'rgba(243, 239, 232, 0.14)',
    highlight: 'rgba(243, 239, 232, 0.18)',
  },
  /** Space so lists clear the floating glass tab bar. */
  tabBarClearance: 128,
} as const;

export type Theme = typeof theme;
