import { theme } from './theme';

const Colors = {
  light: {
    text: theme.bg,
    background: '#f4f1ec',
    tint: theme.accent,
    tabIconDefault: '#aaa',
    tabIconSelected: theme.accent,
  },
  dark: {
    text: theme.text,
    background: theme.bg,
    tint: theme.accent,
    tabIconDefault: theme.faint,
    tabIconSelected: theme.accent,
  },
};

export default Colors;
