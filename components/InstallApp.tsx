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

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
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

  if (isIos()) {
    return (
      <View style={styles.hint}>
        <Text style={styles.hintText}>
          On iPhone: tap Share, then Add to Home Screen. That installs Watch'd It as an app without the browser bar.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.hint}>
      <Text style={styles.hintText}>
        In Chrome, open the menu and tap Install app. Use the Vercel HTTPS site, not a bookmark.
      </Text>
    </View>
  );
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
  hint: {
    marginTop: 16,
    paddingHorizontal: 8,
  },
  hintText: {
    color: theme.muted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
