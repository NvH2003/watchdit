import { ScrollView, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { theme } from '@/constants/theme';

export type FilterOption<K extends string> = { key: K; label: string };

export default function FilterChips<K extends string>({
  options,
  value,
  onChange,
}: {
  options: FilterOption<K>[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      keyboardShouldPersistTaps="handled"
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      {options.map(option => {
        const active = option.key === value;
        return (
          <TouchableOpacity
            key={option.key}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.chipText, active && styles.chipTextActive]}>
              {option.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 16,
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    alignSelf: 'center',
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  chipText: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#fff',
  },
});
