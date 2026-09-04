import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import db, { instantAppId } from '@/lib/db';
import AuthScreen from '@/components/AuthScreen';
import HeaderBackButton from '@/components/HeaderBackButton';
import { InstantConnecting, InstantUnreachable } from '@/components/InstantGate';
import { theme } from '@/constants/theme';
import { useDedupeUserShows, usePromoteAiredUpToDate } from '@/lib/userShows';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) SplashScreen.hideAsync();
  }, [loaded]);

  if (!loaded) return null;

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  if (!instantAppId) {
    return (
      <InstantUnreachable
        title="Missing Instant App ID"
        body="Add EXPO_PUBLIC_INSTANT_APP_ID in Vercel → Settings → Environment Variables (Production), then Redeploy. Expo bakes this in at build time."
        onRetry={() => {
          if (Platform.OS === 'web' && typeof window !== 'undefined') {
            window.location.reload();
          }
        }}
      />
    );
  }

  return <InstantSession colorScheme={colorScheme} />;
}

function InstantSession({ colorScheme }: { colorScheme: ReturnType<typeof useColorScheme> }) {
  const { isLoading, user, error } = db.useAuth();
  const status = db.useConnectionStatus();
  const [timedOut, setTimedOut] = useState(false);
  const hydrated = useClientOnlyValue(false, true);
  useDedupeUserShows();
  usePromoteAiredUpToDate();

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), 5000);
    return () => clearTimeout(timer);
  }, []);

  const reload = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.location.reload();
    } else {
      setTimedOut(false);
    }
  };

  if (error && !user) {
    return (
      <InstantUnreachable
        detail={error.message}
        onRetry={reload}
      />
    );
  }

  if (status === 'errored' && !user) {
    return (
      <InstantUnreachable
        detail="WebSocket connection failed"
        onRetry={reload}
      />
    );
  }

  // Instant's SSR snapshot is always "loading". Don't spin forever if the live
  // socket never opens, and don't wait for hydration to finish on the server.
  if ((!hydrated || isLoading) && !timedOut) return <InstantConnecting />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {user ? (
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: theme.bg },
              headerTintColor: theme.text,
              headerShadowVisible: false,
              headerTitleStyle: { fontWeight: '600' },
              headerLeft: () => <HeaderBackButton />,
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="show/[id]" options={{ title: '' }} />
            <Stack.Screen name="movie/[id]" options={{ title: '' }} />
            <Stack.Screen name="import" options={{ title: 'Import from TV Time' }} />
          </Stack>
        ) : (
          <AuthScreen />
        )}
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
