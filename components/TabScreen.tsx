import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import ScreenBackdrop from '@/components/ScreenBackdrop';
import { theme } from '@/constants/theme';

export default function TabScreen({ children }: { children: ReactNode }) {
  return (
    <View style={styles.root}>
      <ScreenBackdrop />
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>{children}</SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  safe: {
    flex: 1,
    backgroundColor: 'transparent',
  },
});
