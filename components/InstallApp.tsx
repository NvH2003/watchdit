import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '@/constants/theme';

type BeforeInstallPrompt = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia?.('(display-mode: standalone)').matches;
  const ios = 'standalone' in window.navigator && Boolean((window.navigator as { standalone?: boolean }).standalone);
  return Boolean(media || ios);
}

export default function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPrompt | null>(null);
  const [installed, setInstalled] = useState(isStandalone());

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as unknown as BeforeInstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (Platform.OS !== 'web' || installed) return null;

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }

  if (deferred) {
    return (
      <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={install}>
        <Text style={styles.buttonText}>Install app</Text>
      </TouchableOpacity>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  button: {
    width: '100%',
    height: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
});
