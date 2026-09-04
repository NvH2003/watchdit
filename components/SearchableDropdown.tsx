import { useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  Pressable,
  FlatList,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '@/constants/theme';

export type SearchableDropdownOption = { key: string; label: string };

export default function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
}: {
  value: string;
  onChange: (key: string) => void;
  options: SearchableDropdownOption[];
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const selected = options.find(o => o.key === value);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => o.label.toLowerCase().includes(q));
  }, [options, search]);

  function close() {
    setOpen(false);
    setSearch('');
  }

  function pick(key: string) {
    onChange(key);
    close();
  }

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={selected?.label ?? placeholder}
        accessibilityState={{ expanded: open }}
      >
        <Text style={styles.triggerLabel} numberOfLines={1}>
          {selected?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={theme.muted} />
      </TouchableOpacity>

      <Modal transparent animationType="fade" visible={open} onRequestClose={close}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Collection</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={16} color={theme.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder={searchPlaceholder}
                placeholderTextColor={theme.faint}
                value={search}
                onChangeText={setSearch}
                autoFocus
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="off"
              />
              {search ? (
                <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={theme.muted} />
                </TouchableOpacity>
              ) : null}
            </View>
            <FlatList
              data={filtered}
              keyExtractor={item => item.key}
              keyboardShouldPersistTaps="handled"
              style={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>No collections match.</Text>
              }
              renderItem={({ item }) => {
                const active = item.key === value;
                return (
                  <TouchableOpacity
                    style={[styles.option, active && styles.optionActive]}
                    onPress={() => pick(item.key)}
                  >
                    <Text
                      style={[styles.optionLabel, active && styles.optionLabelActive]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                    {active ? (
                      <Ionicons name="checkmark" size={18} color={theme.accent} />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  triggerLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    maxHeight: '70%',
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingTop: 14,
    paddingBottom: 8,
    zIndex: 1,
  },
  sheetTitle: {
    color: theme.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: theme.text,
    fontSize: 15,
    paddingVertical: 0,
  },
  list: {
    flexGrow: 0,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  optionActive: {
    backgroundColor: theme.elevated,
  },
  optionLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.text,
    fontSize: 15,
  },
  optionLabelActive: {
    color: theme.accent,
    fontWeight: '600',
  },
  empty: {
    color: theme.muted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
  },
});
