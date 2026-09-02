import { BlurView } from 'expo-blur';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';
import { theme } from '@/constants/theme';

export default function Glass({
  children,
  style,
  intensity = 70,
  radius = 16,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  radius?: number;
}) {
  return (
    <BlurView
      intensity={intensity}
      tint="systemUltraThinMaterialDark"
      style={[
        {
          overflow: 'hidden',
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.glass.border,
          ...(Platform.OS === 'android'
            ? { backgroundColor: 'rgba(18, 17, 16, 0.88)' }
            : {}),
        },
        style,
      ]}
    >
      {children}
    </BlurView>
  );
}
