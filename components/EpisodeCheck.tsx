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

const SMOOTH = Easing.bezier(0.45, 0, 0.55, 1);

/**
 * Red = still to mark.
 * Pending = green with a soft breathe + ring while the next episode is loading.
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
  const breathe = useSharedValue(0);
  const spin = useSharedValue(0);
  const ringOpacity = useSharedValue(0);
  const mounted = useRef(false);
  const wasActive = useRef(watched || pending);
  const ringSize = size + 10;

  useEffect(() => {
    const active = watched || pending;
    if (!mounted.current) {
      mounted.current = true;
      progress.value = active ? 1 : 0;
      wasActive.current = active;
      return;
    }
    if (active && !wasActive.current) {
      const snap = pending;
      progress.value = withTiming(1, {
        duration: snap ? 85 : 340,
        easing: snap ? Easing.out(Easing.cubic) : SMOOTH,
      });
      scale.value = snap
        ? withSequence(
            withTiming(0.88, { duration: 45, easing: Easing.out(Easing.cubic) }),
            withSpring(1.08, { damping: 18, stiffness: 520, mass: 0.35 }),
            withSpring(1, { damping: 20, stiffness: 360, mass: 0.4 })
          )
        : withSequence(
            withTiming(0.82, { duration: 90, easing: Easing.out(Easing.cubic) }),
            withSpring(1.1, { damping: 16, stiffness: 300, mass: 0.55 }),
            withSpring(1, { damping: 18, stiffness: 220, mass: 0.5 })
          );
    } else if (!active && wasActive.current) {
      progress.value = withTiming(0, { duration: 280, easing: SMOOTH });
      scale.value = withTiming(1, { duration: 220, easing: SMOOTH });
    }
    wasActive.current = active;
  }, [watched, pending, progress, scale]);

  useEffect(() => {
    done.value = withTiming(finished ? 1 : 0, { duration: 420, easing: SMOOTH });
    if (finished) {
      scale.value = withSequence(
        withSpring(1.28, { damping: 14, stiffness: 300, mass: 0.5 }),
        withSpring(1, { damping: 16, stiffness: 220, mass: 0.5 })
      );
    }
  }, [finished, done, scale]);

  useEffect(() => {
    if (pending && !finished) {
      ringOpacity.value = withTiming(1, { duration: 140, easing: Easing.out(Easing.cubic) });
      breathe.value = withRepeat(
        withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.quad) }),
        -1,
        true
      );
      spin.value = withRepeat(
        withTiming(1, { duration: 1600, easing: Easing.linear }),
        -1,
        false
      );
      return () => {
        cancelAnimation(breathe);
        cancelAnimation(spin);
        breathe.value = 0;
        spin.value = 0;
      };
    }
    cancelAnimation(breathe);
    cancelAnimation(spin);
    ringOpacity.value = withTiming(0, { duration: 400, easing: SMOOTH });
    breathe.value = withTiming(0, { duration: 280, easing: SMOOTH });
    spin.value = withTiming(0, { duration: 280, easing: SMOOTH });
  }, [pending, finished, breathe, spin, ringOpacity]);

  const animatedStyle = useAnimatedStyle(() => {
    const breatheScale = interpolate(breathe.value, [0, 1], [1, 1.055]);
    const pendingMul = ringOpacity.value > 0.02 ? breatheScale : 1;
    return {
      transform: [{ scale: scale.value * pendingMul }],
      backgroundColor: interpolateColor(
        done.value,
        [0, 1],
        [interpolateColor(progress.value, [0, 1], [RED, GREEN]), PURPLE]
      ),
    };
  });

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value * 0.92,
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
            borderWidth: Math.max(2, Math.round(size * 0.07)),
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
    borderColor: 'rgba(61, 206, 122, 0.12)',
    borderTopColor: 'rgba(61, 206, 122, 0.95)',
    borderRightColor: 'rgba(61, 206, 122, 0.45)',
    borderBottomColor: 'rgba(61, 206, 122, 0.08)',
    borderLeftColor: 'rgba(61, 206, 122, 0.2)',
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