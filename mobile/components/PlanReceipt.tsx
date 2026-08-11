import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { radius, spacing, usePalette } from "../lib/theme";
import type { Plan, PlanAction, QueryAnswer } from "../lib/types";

/**
 * The plan receipt — what the app shows between speaking and confirming.
 *
 * It is a receipt, not a chat bubble: every action the server resolved, listed
 * plainly, with deletions marked. The user is agreeing to a specific list of
 * changes, so the list has to be legible at a glance.
 *
 * `needsConfirm` styles the confirm button as destructive, but the server is
 * what actually refuses to run without confirmation. This is presentation.
 */

const VERB: Record<string, string> = {
  create_task: "New task",
  update_task: "Update task",
  complete_task: "Complete",
  delete_task: "Delete",
  create_project: "New project",
  create_event: "New event",
  create_goal: "New goal",
  create_note: "New note",
  complete_habit: "Log habit",
  log_expense: "Log expense",
  query: "Question",
};

function label(action: PlanAction): string {
  return (
    action.taskTitle ??
    action.title ??
    action.name ??
    action.description ??
    action.kind?.replace(/_/g, " ") ??
    action.type
  );
}

function detail(action: PlanAction): string | null {
  const bits: string[] = [];
  if (action.dueAt) {
    bits.push(
      new Date(action.dueAt).toLocaleString(undefined, {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    );
  }
  if (action.priority && action.priority !== "MEDIUM")
    bits.push(action.priority.toLowerCase());
  if (action.subtasks?.length) bits.push(`${action.subtasks.length} subtasks`);
  if (action.milestones?.length)
    bits.push(`${action.milestones.length} milestones`);
  if (action.amount !== undefined)
    bits.push(`${action.currency ?? ""} ${action.amount}`.trim());
  return bits.length ? bits.join(" · ") : null;
}

export function PlanReceipt({
  plan,
  answers,
  busy,
  onConfirm,
  onCancel,
  onRetry,
}: {
  plan: Plan;
  answers?: QueryAnswer[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onRetry?: (refined: string) => void;
}) {
  const palette = usePalette();

  // The server declined to act. Show the question rather than a fake result.
  if (!plan.planId) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <Text style={[styles.eyebrow, { color: palette.textFaint }]}>
          NEEDS CLARIFICATION
        </Text>
        <Text style={[styles.summary, { color: palette.text }]}>
          {plan.clarification ?? "I couldn't turn that into anything."}
        </Text>

        {plan.ambiguities?.map((amb) => (
          <View key={amb.query} style={styles.block}>
            <Text style={[styles.caption, { color: palette.textMuted }]}>
              Which “{amb.query}”?
            </Text>
            {amb.candidates.map((c) => (
              <Pressable
                accessibilityRole="button"
                key={c.id}
                onPress={() =>
                  onRetry?.(`${amb.query} — the one called "${c.label}"`)
                }
                style={[styles.choice, { backgroundColor: palette.surfaceAlt }]}
              >
                <Text style={{ color: palette.text }}>{c.label}</Text>
              </Pressable>
            ))}
          </View>
        ))}

        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={[styles.secondary, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.textMuted, fontWeight: "600" }}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  // Read-only answers, computed by the server from real rows.
  if (answers?.length) {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        {answers.map((answer) => (
          <View key={answer.kind} style={styles.block}>
            <Text style={[styles.eyebrow, { color: palette.textFaint }]}>
              {answer.kind.replace(/_/g, " ").toUpperCase()}
            </Text>
            <Text style={[styles.summary, { color: palette.text }]}>
              {answer.headline}
            </Text>
            {answer.items.slice(0, 8).map((item) => (
              <View
                key={item.id}
                style={[styles.row, { backgroundColor: palette.surfaceAlt }]}
              >
                <Text style={[styles.rowLabel, { color: palette.text }]}>
                  {item.label}
                </Text>
                {item.detail && (
                  <Text style={[styles.caption, { color: palette.textMuted }]}>
                    {item.detail}
                  </Text>
                )}
              </View>
            ))}
          </View>
        ))}
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={[styles.secondary, { borderColor: palette.border }]}
        >
          <Text style={{ color: palette.textMuted, fontWeight: "600" }}>
            Done
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.card,
        { backgroundColor: palette.surface, borderColor: palette.border },
      ]}
    >
      <Text
        style={[
          styles.eyebrow,
          { color: plan.needsConfirm ? palette.danger : palette.textFaint },
        ]}
      >
        {plan.needsConfirm ? "CONFIRM TO CONTINUE" : "PLAN"}
      </Text>
      <Text style={[styles.summary, { color: palette.text }]}>
        {plan.summary}
      </Text>

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ gap: spacing.sm }}
      >
        {plan.actions.map((action, index) => {
          const destructive = action.type === "delete_task";
          const sub = detail(action);
          return (
            <View
              key={`${action.type}-${index}`}
              style={[
                styles.row,
                {
                  backgroundColor: destructive
                    ? palette.dangerSoft
                    : palette.surfaceAlt,
                  borderLeftWidth: destructive ? 3 : 0,
                  borderLeftColor: palette.danger,
                },
              ]}
            >
              <Text
                style={[
                  styles.verb,
                  { color: destructive ? palette.danger : palette.textFaint },
                ]}
              >
                {VERB[action.type] ?? action.type.replace(/_/g, " ")}
              </Text>
              <Text
                style={[
                  styles.rowLabel,
                  { color: destructive ? palette.danger : palette.text },
                ]}
              >
                {label(action)}
              </Text>
              {sub && (
                <Text style={[styles.caption, { color: palette.textMuted }]}>
                  {sub}
                </Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.buttons}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          disabled={busy}
          style={[
            styles.secondary,
            { borderColor: palette.border, opacity: busy ? 0.5 : 1 },
          ]}
        >
          <Text style={{ color: palette.textMuted, fontWeight: "600" }}>
            Cancel
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onConfirm}
          disabled={busy}
          accessibilityLabel={
            plan.needsConfirm ? "Confirm deletion" : "Run this plan"
          }
          style={[
            styles.primary,
            {
              backgroundColor: plan.needsConfirm
                ? palette.danger
                : palette.accent,
              opacity: busy ? 0.6 : 1,
            },
          ]}
        >
          <Text style={styles.primaryText}>
            {busy ? "Working…" : plan.needsConfirm ? "Yes, delete" : "Confirm"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  summary: { fontSize: 16, lineHeight: 22, fontWeight: "500" },
  list: { maxHeight: 260 },
  block: { gap: spacing.xs, marginBottom: spacing.sm },
  row: { padding: spacing.sm + 2, borderRadius: radius.md, gap: 2 },
  verb: { fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6 },
  rowLabel: { fontSize: 15, fontWeight: "500" },
  caption: { fontSize: 12.5 },
  choice: {
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    marginTop: spacing.xs,
  },
  buttons: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
  secondary: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: "center",
  },
  primary: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: radius.md,
    alignItems: "center",
  },
  primaryText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
});
