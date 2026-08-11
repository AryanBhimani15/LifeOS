import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, spacing, usePalette } from "../lib/theme";
import type { QueryAnswer } from "../lib/types";

/**
 * A answer to a known question, computed from the database.
 *
 * Every number here came from SQL, so nothing on this card can be a
 * hallucinated deadline. That is the whole reason questions are answered
 * server-side rather than by a model summarising rows.
 */
export function AnswerCard({
  answer,
  onDismiss,
}: {
  answer: QueryAnswer;
  onDismiss: () => void;
}) {
  const palette = usePalette();

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text style={[styles.eyebrow, { color: palette.textFaint }]}>
        {answer.kind.replace(/_/g, " ").toUpperCase()}
      </Text>
      <Text style={[styles.headline, { color: palette.text }]}>
        {answer.headline}
      </Text>

      {answer.items.length === 0 ? (
        <Text style={[styles.empty, { color: palette.textMuted }]}>
          Nothing to show.
        </Text>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ gap: spacing.sm }}>
          {answer.items.slice(0, 12).map((item) => (
            <View
              key={item.id}
              style={[styles.row, { backgroundColor: palette.surfaceAlt }]}
            >
              <Text style={[styles.label, { color: palette.text }]}>
                {item.label}
              </Text>
              {item.detail && (
                <Text style={[styles.detail, { color: palette.textMuted }]}>
                  {item.detail}
                </Text>
              )}
            </View>
          ))}
        </ScrollView>
      )}

      <Pressable
        accessibilityRole="button"
        onPress={onDismiss}
        style={[styles.done, { borderColor: palette.border }]}
      >
        <Text style={{ color: palette.textMuted, fontWeight: "600" }}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  headline: { fontSize: 17, lineHeight: 24, fontWeight: "600" },
  list: { maxHeight: 320 },
  row: { padding: spacing.sm + 2, borderRadius: radius.md, gap: 2 },
  label: { fontSize: 15, fontWeight: "500" },
  detail: { fontSize: 12.5 },
  empty: { fontSize: 14, paddingVertical: spacing.sm },
  done: {
    marginTop: spacing.xs,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
  },
});
