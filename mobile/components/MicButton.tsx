import { useEffect, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { radius, spacing, usePalette } from "../lib/theme";
import type { SpeechState } from "../lib/speech";

/**
 * The primary control. Everything else on the screen is secondary to this.
 *
 * Sized at 168pt because the app is used one-handed, often without looking
 * directly at the screen — the target should be findable by thumb.
 *
 * The pulse is the only animation in the app. It is not decoration: it is the
 * sole indication that the microphone is live, which matters when the app is
 * listening to someone's room.
 */
export function MicButton({
  state,
  disabled,
  onPress,
}: {
  state: SpeechState;
  disabled?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  // Lazy useState rather than useRef: an Animated.Value is read during render
  // (interpolate), and reading a ref there is exactly what the React Compiler
  // rules forbid. The initialiser runs once, so the value is still stable.
  const [pulse] = useState(() => new Animated.Value(0));
  const listening = state === "listening" || state === "starting";
  // Voice missing is a normal state on this build, not a failure. It reads as
  // muted and says so, rather than looking like a button that ignores taps.
  const unavailable = state === "unavailable";

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [listening, pulse]);

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] });

  return (
    <View style={styles.wrap}>
      {listening && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.ring,
            {
              backgroundColor: palette.accent,
              opacity: ringOpacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        />
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          unavailable
            ? "Voice unavailable on this build — type your command instead"
            : listening
              ? "Stop listening"
              : "Start speaking a command"
        }
        accessibilityState={{ disabled: disabled || unavailable, busy: listening }}
        disabled={disabled || unavailable}
        onPress={() => {
          // A short tap confirms the mic toggled without needing to look.
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
          onPress();
        }}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: unavailable
              ? palette.surfaceAlt
              : listening
                ? palette.danger
                : palette.accent,
            borderWidth: unavailable ? 1 : 0,
            borderColor: palette.border,
            opacity: disabled ? 0.45 : pressed ? 0.9 : 1,
            transform: [{ scale: pressed ? 0.97 : 1 }],
          },
        ]}
      >
        <Text style={[styles.glyph, unavailable && { color: palette.textFaint }]}>
          {unavailable ? "⌨" : listening ? "■" : "●"}
        </Text>
        <Text style={[styles.caption, unavailable && { color: palette.textMuted }]}>
          {unavailable ? "Type below" : listening ? "Tap to stop" : "Tap to speak"}
        </Text>
      </Pressable>
    </View>
  );
}

const SIZE = 168;

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center", height: SIZE + spacing.lg },
  ring: { position: "absolute", width: SIZE, height: SIZE, borderRadius: radius.pill },
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  glyph: { fontSize: 44, color: "#FFFFFF", lineHeight: 50 },
  caption: { fontSize: 14, fontWeight: "600", color: "#FFFFFF", opacity: 0.92 },
});
