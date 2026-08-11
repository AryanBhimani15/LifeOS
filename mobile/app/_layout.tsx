import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { getRefreshToken } from "../lib/auth";
import { usePalette } from "../lib/theme";

/**
 * Root layout and auth gate.
 *
 * The gate only checks that a refresh token EXISTS — it does not validate it.
 * Validation happens on the first API call, which is the only place that can
 * tell the difference between a valid and a revoked token anyway. Blocking
 * launch on a network round-trip would defeat the point of a capture app.
 */
export default function RootLayout() {
  const palette = usePalette();
  const router = useRouter();
  const segments = useSegments();
  const [checked, setChecked] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    getRefreshToken()
      .then((token) => setHasSession(Boolean(token)))
      .catch(() => setHasSession(false))
      .finally(() => setChecked(true));
  }, []);

  useEffect(() => {
    if (!checked) return;
    const onLogin = segments[0] === "login";
    if (!hasSession && !onLogin) router.replace("/login");
    if (hasSession && onLogin) router.replace("/");
  }, [checked, hasSession, segments, router]);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg, alignItems: "center", justifyContent: "center" }}>
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
