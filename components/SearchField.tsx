import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/theme';

export function matchesQuery(name: string | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (name ?? '').toLowerCase().includes(q);
}

export default function SearchField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.wrap}>
      <Ionicons name="search-outline" size={16} color={theme.muted} style={styles.icon} />
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={theme.faint}
        value={value}
        onChangeText={onChange}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        autoComplete="off"
      />
      {value ? (
        <TouchableOpacity onPress={() => onChange('')} hitSlop={8} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={16} color={theme.muted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: theme.glass.fill,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.glass.border,
  },
  icon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: theme.text,
    fontSize: 16,
    paddingVertical: 2,
  },
});
