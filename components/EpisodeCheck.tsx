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
const GOLD = theme.gold;

const SMOOTH = Easing.bezier(0.45, 0, 0.55, 1);
const SPARKLE_ANGLES = [0, 55, 110, 165, 235, 290];

function Sparkle({
  angle,
  celebrate,
  radius,
}: {
  angle: number;
  celebrate: Animated.SharedValue<number>;
  radius: number;
}) {
  const style = useAnimatedStyle(() => {
    const dist = interpolate(celebrate.value, [0, 0.35, 1], [0, radius * 0.5, radius * 0.82]);
    const opacity = interpolate(celebrate.value, [0, 0.15, 0.55, 1], [0, 1, 0.85, 0]);
    const scale = interpolate(celebrate.value, [0, 0.4, 1], [0.25, 1.15, 0.5]);
    const rad = (angle * Math.PI) / 180;
    return {
      opacity,
      transform: [
        { translateX: Math.cos(rad) * dist },
        { translateY: Math.sin(rad) * dist },
        { scale },
      ],
    };
  });

  return <Animated.View style={[styles.sparkle, style]} />;
}

/**
 * Red = still to mark.
 * Pending = green with a soft breathe + ring while the next episode is loading.
 * Finished = gold spark burst then purple (ended series complete).
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
  const finishTone = useSharedValue(finished ? 2 : watched || pending ? 1 : 0);
  const celebrate = useSharedValue(0);
  const burst = useSharedValue(0);
  const wiggle = useSharedValue(0);
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
      finishTone.value = finished ? 2 : active ? 1 : 0;
      wasActive.current = active;
      return;
    }
    if (finished) return;
    if (active && !wasActive.current) {
      const snap = pending;
      progress.value = withTiming(1, {
        duration: snap ? 85 : 340,
        easing: snap ? Easing.out(Easing.cubic) : SMOOTH,
      });
      finishTone.value = withTiming(1, { duration: snap ? 85 : 340, easing: SMOOTH });
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
      finishTone.value = withTiming(0, { duration: 280, easing: SMOOTH });
      scale.value = withTiming(1, { duration: 220, easing: SMOOTH });
    }
    wasActive.current = active;
  }, [watched, pending, finished, progress, scale, finishTone]);

  useEffect(() => {
    if (!finished) {
      finishTone.value = withTiming(watched || pending ? 1 : 0, { duration: 280, easing: SMOOTH });
      celebrate.value = withTiming(0, { duration: 200 });
      burst.value = withTiming(0, { duration: 200 });
      wiggle.value = withTiming(0, { duration: 200 });
      return;
    }

    cancelAnimation(breathe);
    cancelAnimation(spin);
    ringOpacity.value = 0;
    progress.value = 1;
    celebrate.value = 0;
    burst.value = 0;

    finishTone.value = withSequence(
      withTiming(1.4, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withTiming(2, { duration: 680, easing: SMOOTH })
    );
    celebrate.value = withTiming(1, { duration: 1050, easing: Easing.out(Easing.cubic) });
    burst.value = withSequence(
      withTiming(1, { duration: 750, easing: Easing.out(Easing.cubic) }),
      withTiming(0, { duration: 450, easing: SMOOTH })
    );
    scale.value = withSequence(
      withSpring(1.38, { damping: 11, stiffness: 380, mass: 0.45 }),
      withSpring(1.12, { damping: 14, stiffness: 260, mass: 0.5 }),
      withSpring(1, { damping: 16, stiffness: 220, mass: 0.5 })
    );
    wiggle.value = withSequence(
      withTiming(1, { duration: 90, easing: Easing.out(Easing.quad) }),
      withTiming(-0.85, { duration: 130, easing: Easing.inOut(Easing.quad) }),
      withTiming(0.55, { duration: 110, easing: Easing.inOut(Easing.quad) }),
      withTiming(0, { duration: 160, easing: SMOOTH })
    );
  }, [finished, watched, pending, finishTone, celebrate, burst, scale, wiggle, progress, breathe, spin, ringOpacity]);

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
    if (!finished) {
      ringOpacity.value = withTiming(0, { duration: 400, easing: SMOOTH });
    }
    breathe.value = withTiming(0, { duration: 280, easing: SMOOTH });
    spin.value = withTiming(0, { duration: 280, easing: SMOOTH });
  }, [pending, finished, breathe, spin, ringOpacity]);

  const animatedStyle = useAnimatedStyle(() => {
    const breatheScale = interpolate(breathe.value, [0, 1], [1, 1.055]);
    const pendingMul = ringOpacity.value > 0.02 ? breatheScale : 1;
    const wiggleDeg = interpolate(wiggle.value, [-1, 0, 1], [-14, 0, 14]);
    const bg =
      finishTone.value > 1.05
        ? interpolateColor(finishTone.value, [1.05, 1.4, 2], [GREEN, GOLD, PURPLE])
        : interpolateColor(finishTone.value, [0, 1], [RED, GREEN]);
    return {
      transform: [
        { scale: scale.value * pendingMul },
        { rotate: `${wiggleDeg}deg` },
      ],
      backgroundColor: bg,
    };
  });

  const ringStyle = useAnimatedStyle(() => ({
    opacity: ringOpacity.value * 0.92,
    transform: [{ rotate: `${interpolate(spin.value, [0, 1], [0, 360])}deg` }],
  }));

  const burstStyle = useAnimatedStyle(() => ({
    opacity: interpolate(burst.value, [0, 0.25, 1], [0, 0.85, 0]) * (finished ? 1 : 0),
    transform: [{ scale: interpolate(burst.value, [0, 1], [0.75, 1.65]) }],
  }));

  const markStyle = useAnimatedStyle(() => ({
    opacity: interpolate(celebrate.value, [0, 0.2, 1], [1, 1, 1]),
    transform: [{ scale: interpolate(celebrate.value, [0, 0.35, 1], [1, 1.15, 1]) }],
  }));

  return (
    <View style={[styles.wrap, { width: ringSize, height: ringSize }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.burstRing,
          {
            width: ringSize,
            height: ringSize,
            borderRadius: ringSize / 2,
            borderWidth: Math.max(2, Math.round(size * 0.09)),
          },
          burstStyle,
        ]}
      />
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
      {SPARKLE_ANGLES.map(angle => (
        <Sparkle key={angle} angle={angle} celebrate={celebrate} radius={ringSize * 0.5} />
      ))}
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
        <Animated.Text
          style={[
            styles.mark,
            { fontSize: Math.round(size * 0.48), lineHeight: Math.round(size * 0.55) },
            markStyle,
          ]}
        >
          {finished ? '★' : '✓'}
        </Animated.Text>
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
  burstRing: {
    position: 'absolute',
    borderColor: 'rgba(212, 160, 86, 0.5)',
    borderTopColor: GOLD,
    borderRightColor: PURPLE,
  },
  ring: {
    position: 'absolute',
    borderColor: 'rgba(61, 206, 122, 0.12)',
    borderTopColor: 'rgba(61, 206, 122, 0.95)',
    borderRightColor: 'rgba(61, 206, 122, 0.45)',
    borderBottomColor: 'rgba(61, 206, 122, 0.08)',
    borderLeftColor: 'rgba(61, 206, 122, 0.2)',
  },
  sparkle: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: GOLD,
    shadowColor: PURPLE,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
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