import { Pressable, StyleSheet, Text, View } from "react-native";
import { radius, spacing, usePalette } from "../lib/theme";

/**
 * What to do with a captured sentence.
 *
 * Shown as soon as there is text, BEFORE anything is sent anywhere. Filing it
 * as a task or a note is free, instant, and works when the AI is out of quota —
 * which is the common case and the one that must never fail. Interpreting it is
 * the special case, so it sits last and is clearly marked as the AI path.
 */

export type CaptureKind = "task" | "goal" | "note" | "project" | "expense";

const OPTIONS: { kind: CaptureKind; label: string; glyph: string }[] = [
  { kind: "task", label: "Task", glyph: "\u2713" },
  { kind: "goal", label: "Goal", glyph: "\u25CE" },
  { kind: "note", label: "Note", glyph: "\u270E" },
  { kind: "project", label: "Project", glyph: "\u25A6" },
  { kind: "expense", label: "Expense", glyph: "\u00A4" },
];

export function CaptureChooser({
  text,
  busy,
  onPick,
  onInterpret,
  onCancel,
}: {
  text: string;
  busy: boolean;
  onPick: (kind: CaptureKind) => void;
  onInterpret: () => void;
  onCancel: () => void;
}) {
  const palette = usePalette();

  return (
    <View
      style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}
    >
      <Text style={[styles.eyebrow, { color: palette.textFaint }]}>CAPTURED</Text>
      <Text style={[styles.text, { color: palette.text }]}>&ldquo;{text}&rdquo;</Text>

      <Text style={[styles.prompt, { color: palette.textMuted }]}>Save it as</Text>

      <View style={styles.grid}>
        {OPTIONS.map((o) => (
          <Pressable
            key={o.kind}
            accessibilityRole="button"
            accessibilityLabel={`Save as ${o.label}`}
            disabled={busy}
            onPress={() => onPick(o.kind)}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: palette.surfaceAlt,
                borderColor: palette.border,
                opacity: busy ? 0.5 : pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={[styles.glyph, { color: palette.accent }]}>{o.glyph}</Text>
            <Text style={[styles.chipLabel, { color: palette.text }]}>{o.label}</Text>
          </Pressable>
        ))}
      </View>

      {/* The AI path is opt-in: it costs money and quota, and is only worth it
          for things a button cannot express, like breaking work into steps. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Interpret with AI"
        disabled={busy}
        onPress={onInterpret}
        style={({ pressed }) => [
          styles.ai,
          { borderColor: palette.accent, opacity: busy ? 0.5 : pressed ? 0.75 : 1 },
        ]}
      >
        <Text style={[styles.aiText, { color: palette.accent }]}>
          {busy ? "Working\u2026" : "\u2728  Let the AI work it out"}
        </Text>
      </Pressable>

      <Pressable accessibilityRole="button" onPress={onCancel} disabled={busy}>
        <Text style={[styles.discard, { color: palette.textFaint }]}>Discard</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  text: { fontSize: 18, lineHeight: 25, fontWeight: "500" },
  prompt: { fontSize: 13, marginTop: spacing.xs },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 96,
    justifyContent: "center",
  },
  glyph: { fontSize: 15, fontWeight: "700" },
  chipLabel: { fontSize: 14.5, fontWeight: "600" },
  ai: {
    marginTop: spacing.xs,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
  },
  aiText: { fontSize: 14, fontWeight: "600" },
  discard: { fontSize: 13, textAlign: "center", paddingVertical: spacing.xs },
});
