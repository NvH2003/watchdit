import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import db from '@/lib/db';
import InstallApp from '@/components/InstallApp';
import { signInWithPassword, signUpWithPassword } from '@/lib/passwordAuth';
import { theme } from '@/constants/theme';

type Step = 'password' | 'code';

export default function AuthScreen() {
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function signIn() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await signInWithPassword(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function createAccount() {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError('');
    try {
      await signUpWithPassword(email, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function sendCode() {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await db.auth.sendMagicCode({ email: trimmed });
      setStep('code');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    try {
      await db.auth.signInWithMagicCode({ email: email.trim(), code: trimmed });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom', 'left', 'right']}>
      <KeyboardAvoidingView
        style={styles.keyboard}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.inner}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              accessibilityLabel="Watch'd It"
            />
            <Text style={styles.title}>Watch'd It</Text>
            <Text style={styles.subtitle}>
              {step === 'password'
                ? 'Track every show you watch'
                : `Check your inbox — we sent a code to ${email}`}
            </Text>

            {step === 'password' ? (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="your@email.com"
                  placeholderTextColor={theme.faint}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="next"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Password"
                  placeholderTextColor={theme.faint}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  textContentType="password"
                  onSubmitEditing={signIn}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={signIn}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Sign in</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.secondaryButton, loading && styles.buttonDisabled]}
                  onPress={createAccount}
                  disabled={loading}
                >
                  <Text style={styles.secondaryButtonText}>Create account</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.backBtn}
                  onPress={sendCode}
                  disabled={loading}
                >
                  <Text style={styles.backText}>Email me a code instead</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="6-digit code"
                  placeholderTextColor={theme.faint}
                  value={code}
                  onChangeText={setCode}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                  onSubmitEditing={verifyCode}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={verifyCode}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Sign in</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.backBtn}
                  onPress={() => { setStep('password'); setCode(''); setError(''); }}
                >
                  <Text style={styles.backText}>← Use email and password</Text>
                </TouchableOpacity>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <InstallApp />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  keyboard: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 32,
  },
  logo: {
    width: 112,
    height: 112,
    marginBottom: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: theme.text,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: theme.muted,
    marginBottom: 32,
    textAlign: 'center',
    lineHeight: 22,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: theme.elevated,
    borderRadius: 12,
    paddingHorizontal: 16,
    color: theme.text,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: theme.accent,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  secondaryButton: {
    width: '100%',
    height: 52,
    backgroundColor: 'transparent',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  secondaryButtonText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  backBtn: {
    marginTop: 4,
    padding: 8,
  },
  backText: {
    color: theme.muted,
    fontSize: 14,
  },
  error: {
    color: theme.accent,
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
});
