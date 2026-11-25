import { useEffect, useRef } from 'react';
import { Text, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  interpolate,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '@/constants/theme';

const RED = theme.accent;
const GREEN = theme.check;
const PURPLE = theme.finished;

/**
 * Red = still to mark.
 * Pending = green with pulse + spin while the next episode is loading.
 * Watched = solid green. Finished = purple.
 */
export default function EpisodeCheck({
  watched,
  finished = false,
  pending = false,
  size = 26,
}: {
  watched: boolean;
  finished?: boolean;
  pending?: boolean;
  size?: number;
}) {
  const scale = useSharedValue(1);
  const progress = useSharedValue(watched || pending ? 1 : 0);
  const done = useSharedValue(finished ? 1 : 0);
  const pulse = useSharedValue(1);
  const spin = useSharedValue(0);
  const mounted = useRef(false);
  const ringSize = size + 8;

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      progress.value = watched || pending ? 1 : 0;
      return;
    }
    if (watched || pending) {
      progress.value = withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) });
      scale.value = withSequence(
        withTiming(0.72, { duration: 70, easing: Easing.out(Easing.quad) }),
        withSpring(1.22, { damping: 9, stiffness: 420, mass: 0.4 }),
        withSpring(1, { damping: 12, stiffness: 280 })
      );
    } else {
      progress.value = withTiming(0, { duration: 180 });
      scale.value = withTiming(1, { duration: 120 });
    }
  }, [watched, pending, progress, scale]);

  useEffect(() => {
    done.value = withTiming(finished ? 1 : 0, { duration: 360 });
    if (finished) {
      scale.value = withSequence(
        withSpring(1.35, { damping: 8, stiffness: 380, mass: 0.4 }),
        withSpring(1, { damping: 12, stiffness: 260 })
      );
    }
  }, [finished, done, scale]);

  useEffect(() => {
    if (pending && !finished) {
      pulse.value = withRepeat(
        withSequence(
          withTiming(1.1, { duration: 480, easing: Easing.inOut(Easing.quad) }),
          withTiming(1, { duration: 480, easing: Easing.inOut(Easing.quad) })
        ),
        -1,
        false
      );
      spin.value = 0;
      spin.value = withRepeat(
        withTiming(1, { duration: 900, easing: Easing.linear }),
        -1,
        false
      );
      return () => {
        cancelAnimation(pulse);
        cancelAnimation(spin);
        pulse.value = 1;
        spin.value = 0;
      };
    }
    cancelAnimation(pulse);
    cancelAnimation(spin);
    pulse.value = withTiming(1, { duration: 160 });
    spin.value = withTiming(0, { duration: 160 });
  }, [pending, finished, pulse, spin]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value * (pending && !finished ? pulse.value : 1) }],
    backgroundColor: interpolateColor(
      done.value,
      [0, 1],
      [interpolateColor(progress.value, [0, 1], [RED, GREEN]), PURPLE]
    ),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: pending && !finished ? 1 : 0,
    transform: [{ rotate: `${interpolate(spin.value, [0, 1], [0, 360])}deg` }],
  }));

  return (
    <View style={[styles.wrap, { width: ringSize, height: ringSize }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: Math.max(2, Math.round(size * 0.08)),
          },
          ringStyle,
        ]}
      />
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
        <Text
          style={[
            styles.mark,
            { fontSize: Math.round(size * 0.48), lineHeight: Math.round(size * 0.55) },
          ]}
        >
          ✓
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  ring: {
    position: 'absolute',
    borderColor: 'transparent',
    borderTopColor: GREEN,
    borderRightColor: 'rgba(61, 206, 122, 0.35)',
  },
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
