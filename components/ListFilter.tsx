import { View, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SearchableDropdown from '@/components/SearchableDropdown';
import Glass from '@/components/Glass';
import { theme } from '@/constants/theme';

export type FilterMenuOption = { key: string; label: string };

export type FilterMenu = {
  value: string;
  onChange: (key: string) => void;
  options: FilterMenuOption[];
  placeholder?: string;
  searchPlaceholder?: string;
};

export function FilterToggle({
  open,
  active,
  onPress,
}: {
  open: boolean;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.toggle, (open || active) && styles.toggleActive]}
      accessibilityRole="button"
      accessibilityLabel={open ? 'Hide filters' : 'Show filters'}
      accessibilityState={{ expanded: open, selected: active }}
    >
      <Ionicons
        name={open ? 'close' : 'funnel-outline'}
        size={18}
        color={active || open ? '#fff' : theme.muted}
      />
    </TouchableOpacity>
  );
}

export default function FilterToolbar({
  query = '',
  onQueryChange,
  placeholder = 'Search',
  menus = [],
  searchPlacement = 'secondary',
}: {
  query?: string;
  onQueryChange?: (value: string) => void;
  placeholder?: string;
  menus?: FilterMenu[];
  searchPlacement?: 'primary' | 'secondary';
}) {
  const searchPrimary = searchPlacement === 'primary';
  const showSearch = onQueryChange != null;
  const dropdowns = menus.map(menu => (
    <SearchableDropdown
      key={menu.options.map(option => option.key).join('-')}
      options={menu.options}
      value={menu.value}
      onChange={menu.onChange}
      placeholder={menu.placeholder ?? 'All collections'}
      searchPlaceholder={menu.searchPlaceholder ?? 'Search collections'}
    />
  ));

  const search = showSearch ? (
    searchPrimary ? (
      <Glass style={styles.searchPrimary} radius={14} intensity={40}>
        <View style={styles.searchPrimaryRow}>
          <Ionicons name="search-outline" size={16} color={theme.muted} />
          <TextInput
            style={styles.searchPrimaryInput}
            placeholder={placeholder}
            placeholderTextColor={theme.faint}
            value={query}
            onChangeText={onQueryChange}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            autoComplete="off"
          />
          {query ? (
            <TouchableOpacity onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={16} color={theme.muted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </Glass>
    ) : (
      <View style={styles.searchSecondary}>
        <Ionicons name="search-outline" size={14} color={theme.faint} />
        <TextInput
          style={styles.searchSecondaryInput}
          placeholder={placeholder}
          placeholderTextColor={theme.faint}
          value={query}
          onChangeText={onQueryChange}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
        />
        {query ? (
          <TouchableOpacity onPress={() => onQueryChange('')} hitSlop={8} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={14} color={theme.faint} />
          </TouchableOpacity>
        ) : null}
      </View>
    )
  ) : null;

  if (!showSearch && dropdowns.length === 0) return null;

  return (
    <View>
      {searchPrimary ? (
        <>
          {search}
          {dropdowns}
        </>
      ) : (
        <>
          {dropdowns}
          {search}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.elevated,
    borderWidth: 1,
    borderColor: theme.border,
    flexShrink: 0,
  },
  toggleActive: {
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  searchPrimary: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 8,
  },
  searchPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  searchPrimaryInput: {
    flex: 1,
    minWidth: 0,
    color: theme.text,
    fontSize: 16,
    paddingVertical: 2,
  },
  searchSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  searchSecondaryInput: {
    flex: 1,
    minWidth: 0,
    color: theme.muted,
    fontSize: 16,
    paddingVertical: 2,
  },
});
