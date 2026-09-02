import { useEffect, useRef } from 'react';
import { Text, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '@/constants/theme';

const RED = theme.accent;
const GREEN = theme.check;

/** Red = still to mark. Animation turns it green when watched. */
export default function EpisodeCheck({
  watched,
  size = 26,
}: {
  watched: boolean;
  size?: number;
}) {
  const scale = useSharedValue(1);
  const progress = useSharedValue(watched ? 1 : 0);
  const mounted = useRef(false);

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      progress.value = watched ? 1 : 0;
      return;
    }
    if (watched) {
      progress.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) });
      scale.value = withSequence(
        withTiming(0.72, { duration: 70, easing: Easing.out(Easing.quad) }),
        withSpring(1.22, { damping: 9, stiffness: 420, mass: 0.4 }),
        withSpring(1, { damping: 12, stiffness: 280 })
      );
    } else {
      progress.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 120 });
    }
  }, [watched, progress, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: interpolateColor(progress.value, [0, 1], [RED, GREEN]),
  }));

  return (
    <Animated.View
      style={[
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
        animatedStyle,
      ]}
    >
      <Text style={[styles.mark, { fontSize: Math.round(size * 0.48), lineHeight: Math.round(size * 0.55) }]}>✓</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: {
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  mark: {
    color: '#fff',
    fontWeight: '800',
  },
});
