import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Application from "expo-application";
import { ApiError, API_BASE_URL, login } from "../lib/api";
import { radius, spacing, usePalette } from "../lib/theme";

/**
 * Sign in.
 *
 * The same credentials as the web app — there is one account system, not two.
 * The server returns an identical message for an unknown email and a wrong
 * password, and this screen shows it verbatim rather than trying to be more
 * helpful, because guessing which one was wrong is exactly the leak the server
 * is avoiding.
 */
export default function LoginScreen() {
  const palette = usePalette();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const deviceName = Application.nativeApplicationVersion
        ? `${Platform.OS} ${Platform.Version}`
        : "iPhone";
      await login(email.trim(), password, deviceName);
      router.replace("/");
    } catch (e) {
      setError(
        e instanceof ApiError
          ? e.message
          : `Could not reach LifeOS at ${API_BASE_URL}. Check the address and that the server is running.`,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <Text style={[styles.brand, { color: palette.text }]}>✦ LifeOS</Text>
          <Text style={[styles.sub, { color: palette.textMuted }]}>
            Sign in to capture by voice.
          </Text>

          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="Email"
              placeholderTextColor={palette.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              style={[
                styles.input,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
            />
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor={palette.textFaint}
              secureTextEntry
              textContentType="password"
              onSubmitEditing={submit}
              returnKeyType="go"
              style={[
                styles.input,
                {
                  backgroundColor: palette.surface,
                  borderColor: palette.border,
                  color: palette.text,
                },
              ]}
            />

            {error && (
              <Text
                style={[
                  styles.error,
                  {
                    color: palette.danger,
                    backgroundColor: palette.dangerSoft,
                  },
                ]}
              >
                {error}
              </Text>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={submit}
              disabled={busy}
              style={[
                styles.button,
                { backgroundColor: palette.accent, opacity: busy ? 0.6 : 1 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>Sign in</Text>
              )}
            </Pressable>
          </View>

          <Text style={[styles.hint, { color: palette.textFaint }]}>
            Connecting to {API_BASE_URL}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  brand: { fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  sub: { fontSize: 15, marginBottom: spacing.lg },
  form: { gap: spacing.sm },
  input: {
    height: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  button: {
    height: 50,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.xs,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  error: {
    fontSize: 13.5,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  hint: { fontSize: 11.5, textAlign: "center", marginTop: spacing.xl },
});
