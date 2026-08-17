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
} from 'react-native';
import db from '@/lib/db';

type Step = 'email' | 'code';

export default function AuthScreen() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function sendCode() {
    const trimmed = email.trim();
    if (!trimmed) return;
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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <Text style={styles.logo}>📺</Text>
        <Text style={styles.title}>TV Time</Text>
        <Text style={styles.subtitle}>
          {step === 'email'
            ? 'Track every show you watch'
            : `Check your inbox — we sent a code to ${email}`}
        </Text>

        {step === 'email' ? (
          <>
            <TextInput
              style={styles.input}
              placeholder="your@email.com"
              placeholderTextColor="#444"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
              onSubmitEditing={sendCode}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={sendCode}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Continue with email</Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor="#444"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              onSubmitEditing={verifyCode}
              returnKeyType="done"
            />
            <TouchableOpacity
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
              style={styles.backBtn}
              onPress={() => { setStep('email'); setCode(''); setError(''); }}
            >
              <Text style={styles.backText}>← Use a different email</Text>
            </TouchableOpacity>
          </>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0f14',
  },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  logo: {
    fontSize: 72,
    marginBottom: 16,
  },
  title: {
    fontSize: 34,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 15,
    color: '#8892a4',
    marginBottom: 40,
    textAlign: 'center',
    lineHeight: 22,
  },
  input: {
    width: '100%',
    height: 52,
    backgroundColor: '#1c1f2e',
    borderRadius: 12,
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#252840',
  },
  button: {
    width: '100%',
    height: 52,
    backgroundColor: '#e94560',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  backBtn: {
    marginTop: 4,
    padding: 8,
  },
  backText: {
    color: '#8892a4',
    fontSize: 14,
  },
  error: {
    color: '#e94560',
    fontSize: 14,
    marginTop: 12,
    textAlign: 'center',
  },
});
