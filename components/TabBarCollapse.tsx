import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ScrollViewProps,
} from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BottomTabBar, type BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs';
import { theme } from '@/constants/theme';

const EXPANDED_H = 64;
const COLLAPSED_H = 52;
const EXPANDED_INSET = 16;
const COLLAPSED_WIDTH = 300;
const LIFT = 14;
const TIMING = { duration: 260, easing: Easing.out(Easing.cubic) };

const CollapseContext = createContext<SharedValue<number> | null>(null);

export function TabBarCollapseProvider({ children }: { children: ReactNode }) {
  const collapsed = useSharedValue(0);
  return <CollapseContext.Provider value={collapsed}>{children}</CollapseContext.Provider>;
}

function useCollapseProgress() {
  const collapsed = useContext(CollapseContext);
  if (!collapsed) {
    throw new Error('TabBarCollapseProvider is missing');
  }
  return collapsed;
}

export function useExpandTabBar() {
  const collapsed = useCollapseProgress();
  return useCallback(() => {
    collapsed.value = withTiming(0, TIMING);
  }, [collapsed]);
}

export function CollapsibleScrollView({ onScroll, ...props }: ScrollViewProps) {
  const collapsed = useCollapseProgress();
  const lastY = useRef(0);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = event.nativeEvent.contentOffset.y;
      const dy = y - lastY.current;
      lastY.current = y;
      if (y < 20) {
        collapsed.value = withTiming(0, TIMING);
      } else if (dy > 8) {
        collapsed.value = withTiming(1, TIMING);
      } else if (dy < -8) {
        collapsed.value = withTiming(0, TIMING);
      }
      onScroll?.(event);
    },
    [collapsed, onScroll]
  );

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      {...props}
      onScroll={handleScroll}
      scrollEventThrottle={16}
    />
  );
}

export function CollapsingTabLabel({
  children,
  color,
}: {
  children: string;
  color: string;
}) {
  const collapsed = useCollapseProgress();
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(collapsed.value, [0, 0.45, 1], [1, 0, 0]),
    height: interpolate(collapsed.value, [0, 1], [14, 0]),
    marginTop: interpolate(collapsed.value, [0, 1], [2, 0]),
  }));

  return (
    <Animated.View style={[{ overflow: 'hidden' }, style]}>
      <Text
        numberOfLines={1}
        style={{
          color,
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.2,
          textAlign: 'center',
        }}
      >
        {children}
      </Text>
    </Animated.View>
  );
}

export function CollapsingTabBar(props: BottomTabBarProps) {
  const collapsed = useCollapseProgress();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const restBottom = Math.max(insets.bottom, 12);
  const collapsedBarWidth = Math.min(COLLAPSED_WIDTH, Math.max(width - 32, 200));
  const collapsedInset = Math.max(16, (width - collapsedBarWidth) / 2);

  const wrapStyle = useAnimatedStyle(() => ({
    height: interpolate(collapsed.value, [0, 1], [EXPANDED_H, COLLAPSED_H]),
    left: interpolate(collapsed.value, [0, 1], [EXPANDED_INSET, collapsedInset]),
    right: interpolate(collapsed.value, [0, 1], [EXPANDED_INSET, collapsedInset]),
    bottom: interpolate(collapsed.value, [0, 1], [restBottom, restBottom + LIFT]),
    borderRadius: interpolate(collapsed.value, [0, 1], [24, 28]),
  }));

  return (
    <Animated.View style={[styles.wrap, wrapStyle]}>
      <BlurView
        intensity={90}
        tint="systemUltraThinMaterialDark"
        style={[
          StyleSheet.absoluteFill,
          Platform.OS === 'android' && styles.androidFill,
        ]}
      />
      <BottomTabBar
        {...props}
        insets={{ ...props.insets, bottom: 0 }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.highlight,
    ...Platform.select({
      web: {
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.32,
        shadowRadius: 18,
        elevation: 18,
      },
    }),
  },
  androidFill: {
    backgroundColor: 'rgba(18, 17, 16, 0.92)',
  },
});
