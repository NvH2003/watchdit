import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '@/constants/theme';

export function InstantConnecting() {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={theme.accent} size="large" />
      <Text style={styles.muted}>Connecting…</Text>
    </View>
  );
}

export function InstantUnreachable({
  title = "Can't reach Instant",
  body = "The app couldn't open a live connection. Check your network, VPN, and that EXPO_PUBLIC_INSTANT_APP_ID matches the App ID in the Instant dashboard.",
  detail,
  onRetry,
}: {
  title?: string;
  body?: string;
  detail?: string;
  onRetry: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={onRetry}>
        <Text style={styles.buttonText}>Try again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    color: theme.muted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 16,
  },
  muted: {
    color: theme.muted,
    marginTop: 16,
    fontSize: 15,
  },
  detail: {
    color: theme.accent,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 20,
  },
  button: {
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingHorizontal: 24,
    height: 48,
    justifyContent: 'center',
  },
  buttonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
