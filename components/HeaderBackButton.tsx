import { Pressable, Text, StyleSheet, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function HeaderBackButton() {
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(tabs)');
  }

  return (
    <Pressable
      onPress={goBack}
      hitSlop={12}
      style={({ pressed }) => [styles.btn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Go back"
    >
      <Ionicons
        name={Platform.OS === 'ios' ? 'chevron-back' : 'arrow-back'}
        size={24}
        color="#fff"
      />
      <Text style={styles.label}>Back</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingRight: 8,
    marginLeft: Platform.OS === 'web' ? 8 : 0,
  },
  pressed: {
    opacity: 0.6,
  },
  label: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 2,
  },
});
