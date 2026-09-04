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
import {
  signInWithPassword,
  signUpWithPassword,
  resetPasswordWithCode,
} from '@/lib/passwordAuth';
import { theme } from '@/constants/theme';

type Step = 'password' | 'code' | 'forgot' | 'reset';

export default function AuthScreen() {
  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

  async function sendCode(nextStep: 'code' | 'reset') {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email first');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await db.auth.sendMagicCode({ email: trimmed });
      setCode('');
      setStep(nextStep);
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

  async function resetPassword() {
    if (!email.trim() || !code.trim() || !password) return;
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await resetPasswordWithCode(email, code, password);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  function goPassword() {
    setStep('password');
    setCode('');
    setConfirmPassword('');
    setError('');
  }

  const subtitle =
    step === 'password'
      ? 'Track every show you watch'
      : step === 'forgot'
        ? 'Enter your email and we’ll send a reset code'
        : step === 'reset'
          ? `Enter the code we sent to ${email} and choose a new password`
          : `Check your inbox — we sent a code to ${email}`;

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
            <Text style={styles.subtitle}>{subtitle}</Text>

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
                  style={styles.linkBtn}
                  onPress={() => {
                    setError('');
                    setPassword('');
                    setConfirmPassword('');
                    setStep('forgot');
                  }}
                  disabled={loading}
                >
                  <Text style={styles.linkText}>Forgot password?</Text>
                </TouchableOpacity>
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
                  onPress={() => sendCode('code')}
                  disabled={loading}
                >
                  <Text style={styles.backText}>Email me a code instead</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {step === 'forgot' ? (
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
                  returnKeyType="send"
                  onSubmitEditing={() => sendCode('reset')}
                  autoFocus
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={() => sendCode('reset')}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Send reset code</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.backBtn}
                  onPress={goPassword}
                  disabled={loading}
                >
                  <Text style={styles.backText}>← Back to sign in</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {step === 'reset' ? (
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
                  returnKeyType="next"
                />
                <TextInput
                  style={styles.input}
                  placeholder="New password"
                  placeholderTextColor={theme.faint}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Confirm new password"
                  placeholderTextColor={theme.faint}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="new-password"
                  textContentType="newPassword"
                  onSubmitEditing={resetPassword}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={resetPassword}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.buttonText}>Reset password</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.backBtn}
                  onPress={() => sendCode('reset')}
                  disabled={loading}
                >
                  <Text style={styles.backText}>Resend code</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.backBtn}
                  onPress={goPassword}
                  disabled={loading}
                >
                  <Text style={styles.backText}>← Back to sign in</Text>
                </TouchableOpacity>
              </>
            ) : null}

            {step === 'code' ? (
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
                  onPress={goPassword}
                >
                  <Text style={styles.backText}>← Use email and password</Text>
                </TouchableOpacity>
              </>
            ) : null}

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
  linkBtn: {
    alignSelf: 'flex-end',
    marginTop: -4,
    marginBottom: 12,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  linkText: {
    color: theme.accent,
    fontSize: 14,
    fontWeight: '600',
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
