import { ScrollView, TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { theme } from '@/constants/theme';

export type SegmentOption<K extends string> = { key: K; label: string };

export default function SegmentTabs<K extends string>({
  options,
  value,
  onChange,
}: {
  options: SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={styles.wrap}
      keyboardShouldPersistTaps="handled"
      accessibilityRole="tablist"
    >
      {options.map(option => {
        const active = option.key === value;
        return (
          <TouchableOpacity
            key={option.key}
            style={styles.tab}
            onPress={() => onChange(option.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
              {option.label}
            </Text>
            <View style={[styles.indicator, active && styles.indicatorOn]} />
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingRight: 4,
  },
  tab: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 6,
    minHeight: 44,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  label: {
    color: theme.muted,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  labelActive: {
    color: theme.text,
    fontWeight: '700',
  },
  indicator: {
    marginTop: 7,
    height: 2,
    width: 18,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  indicatorOn: {
    backgroundColor: theme.accent,
  },
});
