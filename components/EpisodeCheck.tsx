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
const PURPLE = theme.finished;

/** Red = still to mark. Animation turns it green when watched, purple when the series is finished. */
export default function EpisodeCheck({
  watched,
  finished = false,
  size = 26,
}: {
  watched: boolean;
  finished?: boolean;
  size?: number;
}) {
  const scale = useSharedValue(1);
  const progress = useSharedValue(watched ? 1 : 0);
  const done = useSharedValue(finished ? 1 : 0);
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

  useEffect(() => {
    done.value = withTiming(finished ? 1 : 0, { duration: 360 });
    if (finished) {
      scale.value = withSequence(
        withSpring(1.35, { damping: 8, stiffness: 380, mass: 0.4 }),
        withSpring(1, { damping: 12, stiffness: 260 })
      );
    }
  }, [finished, done, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    backgroundColor: interpolateColor(
      done.value,
      [0, 1],
      [interpolateColor(progress.value, [0, 1], [RED, GREEN]), PURPLE]
    ),
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
