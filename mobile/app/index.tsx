import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Application from "expo-application";
import {
  ApiError,
  SessionExpiredError,
  executePlan,
  fetchMe,
  logout,
  newIdempotencyKey,
  planCommand,
  registerDevice,
  captureDirect,
} from "../lib/api";
import { UNAVAILABLE_MESSAGE, speechAvailable, useSpeech } from "../lib/speech";
import { MicButton } from "../components/MicButton";
import { PlanReceipt } from "../components/PlanReceipt";
import { CaptureChooser, type CaptureKind } from "../components/CaptureChooser";
import { radius, spacing, usePalette } from "../lib/theme";
import type { MeResponse, Plan, QueryAnswer } from "../lib/types";

/**
 * The capture screen — the entire app.
 *
 * launch → tap → speak → see the plan → confirm. Anything that does not serve
 * that path stays off this screen. There is no task list, no calendar and no
 * dashboard here on purpose: the web app already does that better on a bigger
 * screen, and a miniature copy would be worse at both.
 */

type Phase = "idle" | "captured" | "thinking" | "plan" | "executing" | "done";

const EXAMPLES = [
  "Remind me to submit my Azure assignment tomorrow at 6 PM",
  "What's on my schedule today?",
  "Create a task to call Mom tonight",
  "Show me my overdue tasks",
];

export default function CaptureScreen() {
  const palette = usePalette();
  const router = useRouter();

  const [me, setMe] = useState<MeResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [answers, setAnswers] = useState<QueryAnswer[]>([]);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  // Without the native speech module there is nothing to tap, so the text field
  // is the primary control rather than a fallback tucked behind a link.
  const [showTyping, setShowTyping] = useState(!speechAvailable);
  /** Text waiting for the user to say what it is. Nothing has been sent yet. */
  const [pending, setPending] = useState<string | null>(null);

  /**
   * The last thing the user actually said.
   *
   * Kept so an expired plan can be re-planned from the original words instead of
   * asking them to repeat themselves. Plans expire after ten minutes by design —
   * the ids they resolved may be stale — so re-planning is the correct recovery,
   * not forcing execution of a stale plan.
   */
  const lastTranscript = useRef<string>("");

  /** One key per confirmation, so a network retry replays rather than re-runs. */
  const idempotencyKey = useRef<string>(newIdempotencyKey());

  const signOut = useCallback(async () => {
    await logout();
    router.replace("/login");
  }, [router]);

  const handleError = useCallback(
    (e: unknown) => {
      if (e instanceof SessionExpiredError) {
        signOut();
        return;
      }
      setError(e instanceof ApiError ? e.message : "Could not reach LifeOS.");
      setPhase("idle");
    },
    [signOut],
  );

  /**
   * Receives captured text and STOPS.
   *
   * It deliberately does not call the AI. Filing a sentence as a task is free
   * and instant; interpreting it costs quota and can fail. Since the user knows
   * what they just said, asking them is faster and more reliable than guessing —
   * and it means capture still works when the AI is rate limited.
   */
  const submit = useCallback((text: string) => {
    const input = text.trim();
    if (!input) return;

    lastTranscript.current = input;
    Keyboard.dismiss();
    setShowTyping(false);
    setTyped("");
    setError(null);
    setAnswers([]);
    setOutcome(null);
    setPending(input);
    setPhase("captured");
    Haptics.selectionAsync().catch(() => undefined);
  }, []);

  /** Files the pending text as a chosen type. No AI, no confirmation needed. */
  const fileAs = useCallback(
    async (kind: CaptureKind) => {
      if (!pending) return;
      setPhase("executing");
      setError(null);
      try {
        const result = await captureDirect(pending, kind);
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
        setOutcome(
          `Saved as ${kind}: ${result.label}${result.detail ? ` (${result.detail})` : ""}`,
        );
        setPending(null);
        setPhase("done");
        fetchMe()
          .then(setMe)
          .catch(() => undefined);
      } catch (e) {
        handleError(e);
        setPhase("captured");
      }
    },
    [pending, handleError],
  );

  /** The opt-in AI path, for things a button cannot express. */
  const interpret = useCallback(async () => {
    if (!pending) return;
    idempotencyKey.current = newIdempotencyKey();
    setError(null);
    setPhase("thinking");
    try {
      const result = await planCommand(pending);
      setPending(null);
      setPlan(result);
      setPhase("plan");
    } catch (e) {
      // The AI being unavailable must not lose the capture — keep the text so
      // it can still be filed with a button.
      handleError(e);
      setPhase("captured");
    }
  }, [pending, handleError]);

  const speech = useSpeech(submit);

  // Register for push on every cold launch. iOS silently reissues push tokens
  // after an OS update or a restore, so a server holding the old one fails to
  // deliver with no error anywhere.
  useEffect(() => {
    fetchMe()
      .then(setMe)
      .catch((e) => {
        if (e instanceof SessionExpiredError) signOut();
      });

    registerDevice(
      null,
      Application.nativeApplicationVersion ?? undefined,
    ).catch(() => undefined);
  }, [signOut]);

  async function confirm() {
    if (!plan?.planId) return;
    setPhase("executing");
    setError(null);

    try {
      const result = await executePlan(
        plan.planId,
        plan.needsConfirm,
        idempotencyKey.current,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );

      if (result.answers?.length) {
        setAnswers(result.answers);
        setPhase("plan");
        return;
      }

      setOutcome(
        result.executed === 1
          ? "Done — 1 change applied."
          : `Done — ${result.executed} changes applied.`,
      );
      setPlan(null);
      setPhase("done");
      // The web app reads the same database, so it is already in step; refresh
      // the counts shown under the mic.
      fetchMe()
        .then(setMe)
        .catch(() => undefined);
    } catch (e) {
      // A plan that timed out while the phone was in a lift. Re-plan from the
      // original words rather than executing something whose targets may have moved.
      if (
        e instanceof ApiError &&
        /expired/i.test(e.message) &&
        lastTranscript.current
      ) {
        setError("That took too long to confirm — re-checking your request…");
        setPlan(null);
        submit(lastTranscript.current);
        return;
      }
      handleError(e);
    }
  }

  function cancel() {
    setPlan(null);
    setPending(null);
    setAnswers([]);
    setError(null);
    setPhase("idle");
    speech.reset();
  }

  const busy = phase === "thinking" || phase === "executing";
  const listening = speech.state === "listening" || speech.state === "starting";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* header */}
        <View style={styles.header}>
          <View>
            <Text style={[styles.brand, { color: palette.text }]}>
              ✦ LifeOS
            </Text>
            {me && (
              <Text style={[styles.status, { color: palette.textMuted }]}>
                {me.counts.overdue > 0
                  ? `${me.counts.overdue} overdue · ${me.counts.dueNext24h} due soon`
                  : me.counts.dueNext24h > 0
                    ? `${me.counts.dueNext24h} due in the next day`
                    : "Nothing overdue"}
              </Text>
            )}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                "Sign out?",
                "You'll need to sign in again on this device.",
                [
                  { text: "Cancel", style: "cancel" },
                  { text: "Sign out", style: "destructive", onPress: signOut },
                ],
              )
            }
            hitSlop={12}
          >
            <Text style={[styles.signOut, { color: palette.textFaint }]}>
              Sign out
            </Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* the plan receipt replaces the mic once there is something to confirm */}
          {plan ? (
            <PlanReceipt
              plan={plan}
              answers={answers}
              busy={phase === "executing"}
              onConfirm={confirm}
              onCancel={cancel}
              onRetry={submit}
            />
          ) : pending ? (
            /* Text captured, nothing sent yet — the user says what it is. */
            <CaptureChooser
              text={pending}
              busy={phase === "executing" || phase === "thinking"}
              onPick={fileAs}
              onInterpret={interpret}
              onCancel={cancel}
            />
          ) : (
            <>
              <MicButton
                state={speech.state}
                disabled={busy}
                onPress={() => (listening ? speech.stop() : speech.start())}
              />

              <View style={styles.readout}>
                {phase === "thinking" ? (
                  <View style={styles.thinking}>
                    <ActivityIndicator color={palette.accent} />
                    <Text
                      style={[styles.transcript, { color: palette.textMuted }]}
                    >
                      Working out what that means…
                    </Text>
                  </View>
                ) : speech.transcript ? (
                  <Text style={[styles.transcript, { color: palette.text }]}>
                    “{speech.transcript}”
                  </Text>
                ) : outcome ? (
                  <Text style={[styles.transcript, { color: palette.success }]}>
                    {outcome}
                  </Text>
                ) : listening ? (
                  <Text
                    style={[styles.transcript, { color: palette.textMuted }]}
                  >
                    Listening…
                  </Text>
                ) : speechAvailable ? (
                  <Text
                    style={[styles.transcript, { color: palette.textFaint }]}
                  >
                    Say what you need. It becomes a plan you approve.
                  </Text>
                ) : (
                  <Text
                    style={[styles.transcript, { color: palette.textFaint }]}
                  >
                    Type what you need. It becomes a plan you approve.
                  </Text>
                )}
              </View>

              {!speechAvailable && !error && (
                <Text
                  style={[
                    styles.notice,
                    {
                      color: palette.textMuted,
                      backgroundColor: palette.surfaceAlt,
                    },
                  ]}
                >
                  {UNAVAILABLE_MESSAGE}
                </Text>
              )}

              {(error || (speech.error && speechAvailable)) && (
                <Text
                  style={[
                    styles.error,
                    {
                      color: palette.danger,
                      backgroundColor: palette.dangerSoft,
                    },
                  ]}
                >
                  {error ?? speech.error}
                </Text>
              )}

              {/* Typing is always available — speech is unavailable offline
                  without downloaded dictation assets, and a capture app that
                  cannot capture is useless. */}
              {showTyping ? (
                <View style={styles.typeRow}>
                  <TextInput
                    value={typed}
                    onChangeText={setTyped}
                    placeholder="Type a command…"
                    placeholderTextColor={palette.textFaint}
                    autoFocus
                    returnKeyType="send"
                    onSubmitEditing={() => submit(typed)}
                    style={[
                      styles.input,
                      {
                        backgroundColor: palette.surface,
                        borderColor: palette.border,
                        color: palette.text,
                      },
                    ]}
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => submit(typed)}
                    style={[styles.send, { backgroundColor: palette.accent }]}
                  >
                    <Text style={styles.sendText}>Go</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowTyping(true)}
                  hitSlop={10}
                >
                  <Text style={[styles.typeLink, { color: palette.accent }]}>
                    Type instead
                  </Text>
                </Pressable>
              )}

              {phase === "idle" && !speech.transcript && !outcome && (
                <View style={styles.examples}>
                  {EXAMPLES.map((example) => (
                    <Pressable
                      accessibilityRole="button"
                      key={example}
                      onPress={() => submit(example)}
                      style={[
                        styles.example,
                        { backgroundColor: palette.surfaceAlt },
                      ]}
                    >
                      <Text
                        style={[
                          styles.exampleText,
                          { color: palette.textMuted },
                        ]}
                      >
                        {example}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  brand: { fontSize: 18, fontWeight: "700", letterSpacing: -0.3 },
  status: { fontSize: 12.5, marginTop: 2 },
  signOut: { fontSize: 13, fontWeight: "600" },
  body: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  readout: { minHeight: 56, justifyContent: "center" },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    justifyContent: "center",
  },
  transcript: { fontSize: 17, lineHeight: 24, textAlign: "center" },
  error: {
    fontSize: 13.5,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    textAlign: "center",
    overflow: "hidden",
  },
  notice: {
    fontSize: 12.5,
    lineHeight: 18,
    padding: spacing.sm + 2,
    borderRadius: radius.sm,
    textAlign: "center",
    overflow: "hidden",
  },
  typeRow: { flexDirection: "row", gap: spacing.sm },
  input: {
    flex: 1,
    height: 46,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    fontSize: 16,
  },
  send: {
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  sendText: { color: "#FFFFFF", fontWeight: "700" },
  typeLink: { fontSize: 14, fontWeight: "600", textAlign: "center" },
  examples: { gap: spacing.sm, marginTop: spacing.md },
  example: {
    paddingVertical: 11,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  exampleText: { fontSize: 13.5 },
});
