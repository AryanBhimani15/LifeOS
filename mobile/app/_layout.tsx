import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { loadSession, useSession } from "../lib/session-store";
import { usePalette } from "../lib/theme";

/**
 * Root layout and auth gate.
 *
 * Session state is subscribed to, not snapshotted. Reading storage once in a
 * mount effect meant a successful sign-in never reached the gate: it kept its
 * original "signed out" answer and redirected straight back to /login.
 *
 * The gate only checks that a refresh token EXISTS — it does not validate it.
 * Validation happens on the first API call, which is the only place that can
 * tell a valid token from a revoked one. Blocking launch on a network
 * round-trip would defeat the point of a capture app.
 */
export default function RootLayout() {
  const palette = usePalette();
  const router = useRouter();
  const segments = useSegments();
  const hasSession = useSession();

  useEffect(() => {
    loadSession();
  }, []);

  useEffect(() => {
    // null means storage has not been read yet — wait rather than redirecting
    // during the first frame of a cold launch.
    if (hasSession === null) return;

    const onLogin = segments[0] === "login";
    if (!hasSession && !onLogin) router.replace("/login");
    if (hasSession && onLogin) router.replace("/");
  }, [hasSession, segments, router]);

  if (hasSession === null) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: palette.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color={palette.accent} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.bg },
          animation: "fade",
        }}
      />
    </SafeAreaProvider>
  );
}
