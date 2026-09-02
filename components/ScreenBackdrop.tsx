import { Platform, StyleSheet, View } from 'react-native';
import { theme } from '@/constants/theme';

/** Soft warm glows so frosted glass has something to catch. */
export default function ScreenBackdrop() {
  return (
    <View pointerEvents="none" style={styles.wrap}>
      <View style={[styles.orb, styles.orbAccent]} />
      <View style={[styles.orb, styles.orbGold]} />
      <View style={[styles.orb, styles.orbWarm]} />
    </View>
  );
}

const webBlur = Platform.OS === 'web' ? ({ filter: 'blur(70px)' } as const) : null;

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
    backgroundColor: theme.bg,
  },
  orb: {
    position: 'absolute',
    borderRadius: 9999,
    ...webBlur,
  },
  orbAccent: {
    width: 440,
    height: 440,
    backgroundColor: 'rgba(232, 93, 76, 0.42)',
    top: -180,
    right: -140,
  },
  orbGold: {
    width: 420,
    height: 420,
    backgroundColor: 'rgba(212, 160, 86, 0.32)',
    bottom: -80,
    left: '18%',
  },
  orbWarm: {
    width: 300,
    height: 300,
    backgroundColor: 'rgba(243, 239, 232, 0.08)',
    top: '42%',
    right: -90,
  },
});
