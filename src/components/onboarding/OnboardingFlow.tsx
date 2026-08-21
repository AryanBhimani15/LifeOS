"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Check,
  Compass,
  Dumbbell,
  GraduationCap,
  Layers,
  Leaf,
  Loader2,
  Sparkles,
  Target,
  HeartPulse,
  Scale,
  type LucideIcon,
} from "lucide-react";
import {
  ACTIVITY_LEVELS,
  LIFE_CONTEXTS,
  PRIMARY_GOALS,
  SEXES,
  cmToMm,
  feetInchesToMm,
  formatHeight,
  formatWeight,
  gramsToKg,
  gramsToLb,
  kgToGrams,
  lbToGrams,
  mmToCm,
  mmToFeetInches,
} from "@/lib/fitness";
import { fitnessProfileSchema } from "@/lib/validation/fitness";
import * as api from "@/lib/fitness-api";
import type { ActivityLevel, LifeContext, PrimaryGoal, Sex } from "@/generated/prisma/enums";
import {
  ActivityGlyph,
  CalendarArt,
  CompletionArt,
  FigureGlyph,
  HeightArt,
  TargetArt,
  WaveArt,
  WeekArt,
  WeightArt,
} from "./OnboardingArt";

/**
 * The guided setup, asking one question at a time.
 *
 * Three decisions worth knowing about:
 *
 * 1. Each field is held as the text the user typed, not as a parsed number.
 *    Parsing on every keystroke means clearing a field to retype it snaps back
 *    to 0, which is the single most irritating thing a form can do.
 *
 * 2. Validation runs the *server's* zod schema against one field at a time. The
 *    inline message someone sees is therefore the same rule the API enforces —
 *    there is no second, drifting copy of "how tall is too tall".
 *
 * 3. Steps animate out before the next animates in, which needs the outgoing
 *    step to stay mounted for a moment. That is the `phase` state; everything
 *    else is a plain controlled form.
 */

type StepId =
  | "name"
  | "context"
  | "goal"
  | "age"
  | "sex"
  | "height"
  | "weight"
  | "activity"
  | "done";

/**
 * Order matters. Who they are and what they want come before any measurement,
 * because those two answers are what the rest of setup is *for* — asking a
 * stranger their weight before asking what they are trying to do is how a form
 * earns its reputation.
 */
const QUESTIONS: StepId[] = [
  "name",
  "context",
  "goal",
  "age",
  "sex",
  "height",
  "weight",
  "activity",
];

/** Long enough to read as motion, short enough that holding Enter still works. */
const EXIT_MS = 150;

interface Draft {
  firstName: string;
  lifeContext: LifeContext | null;
  primaryGoal: PrimaryGoal | null;
  age: string;
  sex: Sex | null;
  heightUnit: "cm" | "ftin";
  cm: string;
  feet: string;
  inches: string;
  weightUnit: "kg" | "lb";
  weight: string;
  activityLevel: ActivityLevel | null;
}

const INITIAL: Draft = {
  firstName: "",
  lifeContext: null,
  primaryGoal: null,
  age: "",
  sex: null,
  heightUnit: "cm",
  cm: "170",
  feet: "5",
  inches: "7",
  weightUnit: "kg",
  weight: "70",
  activityLevel: null,
};

/** What a saved profile looks like coming back in, for the edit case. */
export interface ExistingProfile {
  age: number;
  sex: Sex;
  heightMm: number;
  heightUnit: string;
  weightGrams: number;
  weightUnit: string;
  activityLevel: ActivityLevel;
  lifeContext: LifeContext;
  primaryGoal: PrimaryGoal;
}

/**
 * Seeds the form from a saved profile.
 *
 * Both unit systems are filled in, not just the stored one, so switching units
 * mid-edit shows their real height in the other system rather than the default.
 */
function initialDraft(suggestedName: string, existing: ExistingProfile | null): Draft {
  if (!existing) return { ...INITIAL, firstName: suggestedName };

  const { feet, inches } = mmToFeetInches(existing.heightMm);
  const weightUnit = existing.weightUnit === "lb" ? "lb" : "kg";

  return {
    firstName: suggestedName,
    lifeContext: existing.lifeContext,
    primaryGoal: existing.primaryGoal,
    age: String(existing.age),
    sex: existing.sex,
    heightUnit: existing.heightUnit === "ftin" ? "ftin" : "cm",
    cm: String(mmToCm(existing.heightMm)),
    feet: String(feet),
    inches: String(inches),
    weightUnit,
    weight: whole(
      weightUnit === "lb" ? gramsToLb(existing.weightGrams) : gramsToKg(existing.weightGrams),
    ),
    activityLevel: existing.activityLevel,
  };
}

/** Blank means "not answered yet", which must not read as 0. */
function num(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Blank inches is a real answer — "5 foot" — so it counts as zero. */
function optionalNum(text: string): number {
  return text.trim() === "" ? 0 : Number(text);
}

/**
 * Whole units.
 *
 * The slider used to move in half kilos, which put "78.5" on screen and made
 * the number look unstable while dragging. Whole numbers round-trip through a
 * kg/lb toggle without drifting, because the conversion error is far under half
 * a unit in both directions.
 */
function whole(value: number): string {
  return String(Math.round(value));
}

/** Whether two heights read as the same feet-and-inches value. */
function sameFeetInches(a: number, b: number): boolean {
  const left = mmToFeetInches(a);
  const right = mmToFeetInches(b);
  return left.feet === right.feet && left.inches === right.inches;
}

export function OnboardingFlow({
  suggestedName,
  existing = null,
}: {
  suggestedName: string;
  existing?: ExistingProfile | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => initialDraft(suggestedName, existing));
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"in" | "out">("in");
  const [direction, setDirection] = useState<1 | -1>(1);
  const [saving, setSaving] = useState(false);
  // What the server actually built, shown on the last screen so the answers
  // visibly turned into something.
  const [summary, setSummary] = useState<api.SetupSummary | null>(null);
  const timer = useRef<number | null>(null);

  const step: StepId = done ? "done" : QUESTIONS[index];
  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError(null);
  }, []);

  // ---- Derived canonical values, which the drawings read ----

  const heightMm = useMemo(() => {
    if (draft.heightUnit === "cm") {
      const cm = num(draft.cm);
      return Number.isNaN(cm) ? 0 : cmToMm(cm);
    }
    const feet = num(draft.feet);
    return Number.isNaN(feet) ? 0 : feetInchesToMm(feet, optionalNum(draft.inches));
  }, [draft.heightUnit, draft.cm, draft.feet, draft.inches]);

  const weightGrams = useMemo(() => {
    const value = num(draft.weight);
    if (Number.isNaN(value)) return 0;
    return draft.weightUnit === "kg" ? kgToGrams(value) : lbToGrams(value);
  }, [draft.weight, draft.weightUnit]);

  // ---- Sliders write back through the text fields, so both stay in step ----

  const setHeightFromMm = useCallback((mm: number) => {
    setError(null);
    setDraft((prev) => {
      if (prev.heightUnit === "cm") return { ...prev, cm: String(mmToCm(mm)) };
      const { feet, inches } = mmToFeetInches(mm);
      return { ...prev, feet: String(feet), inches: String(inches) };
    });
  }, []);

  const setWeightFromGrams = useCallback((grams: number) => {
    setError(null);
    setDraft((prev) => ({
      ...prev,
      weight: whole(prev.weightUnit === "kg" ? gramsToKg(grams) : gramsToLb(grams)),
    }));
  }, []);

  /**
   * Switching units converts what is already there rather than discarding it.
   *
   * Toggling to the other unit and back must give the answer back unchanged.
   * Feet and inches are coarser than centimetres, so a naive round trip turns
   * 184 cm into 6′0″ into 183 cm — the number moved while the user only looked
   * at it. Their centimetre answer is kept whenever it still reads as the same
   * feet-and-inches value.
   */
  const switchHeightUnit = useCallback(
    (unit: Draft["heightUnit"]) => {
      if (unit === draft.heightUnit) return;
      setError(null);
      const current = heightMm || cmToMm(170);

      setDraft((prev) => {
        if (unit === "cm") {
          const stored = num(prev.cm);
          const unchanged = !Number.isNaN(stored) && sameFeetInches(cmToMm(stored), current);
          return { ...prev, heightUnit: unit, cm: unchanged ? prev.cm : String(mmToCm(current)) };
        }
        const { feet, inches } = mmToFeetInches(current);
        return { ...prev, heightUnit: unit, feet: String(feet), inches: String(inches) };
      });
    },
    [draft.heightUnit, heightMm],
  );

  const switchWeightUnit = useCallback(
    (unit: Draft["weightUnit"]) => {
      if (unit === draft.weightUnit) return;
      setError(null);
      const grams = weightGrams || kgToGrams(70);
      setDraft((prev) => ({
        ...prev,
        weightUnit: unit,
        weight: whole(unit === "kg" ? gramsToKg(grams) : gramsToLb(grams)),
      }));
    },
    [draft.weightUnit, weightGrams],
  );

  // ---- Validation, one field at a time, against the server's own schema ----

  const validate = useCallback(
    (which: StepId): string | null => {
      const shape = fitnessProfileSchema.shape;
      const first = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
        result.success ? null : (result.error?.issues[0]?.message ?? "Please check this.");

      switch (which) {
        case "name":
          return first(shape.firstName.safeParse(draft.firstName));
        case "context":
          return first(shape.lifeContext.safeParse(draft.lifeContext));
        case "goal":
          return first(shape.primaryGoal.safeParse(draft.primaryGoal));
        case "age":
          return first(shape.age.safeParse(num(draft.age)));
        case "sex":
          return first(shape.sex.safeParse(draft.sex));
        case "height":
          return first(
            shape.height.safeParse(
              draft.heightUnit === "cm"
                ? { unit: "cm", cm: num(draft.cm) }
                : { unit: "ftin", feet: num(draft.feet), inches: optionalNum(draft.inches) },
            ),
          );
        case "weight":
          return first(
            shape.weight.safeParse({ unit: draft.weightUnit, value: num(draft.weight) }),
          );
        case "activity":
          return first(shape.activityLevel.safeParse(draft.activityLevel));
        default:
          return null;
      }
    },
    [draft],
  );

  // ---- Navigation ----

  const transition = useCallback((to: () => void, dir: 1 | -1) => {
    setDirection(dir);
    setPhase("out");
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      to();
      setPhase("in");
    }, EXIT_MS);
  }, []);

  const submit = useCallback(async () => {
    const payload = {
      firstName: draft.firstName.trim(),
      lifeContext: draft.lifeContext,
      primaryGoal: draft.primaryGoal,
      age: num(draft.age),
      sex: draft.sex,
      height:
        draft.heightUnit === "cm"
          ? { unit: "cm", cm: num(draft.cm) }
          : { unit: "ftin", feet: num(draft.feet), inches: optionalNum(draft.inches) },
      weight: { unit: draft.weightUnit, value: num(draft.weight) },
      activityLevel: draft.activityLevel,
    };

    setSaving(true);
    try {
      setSummary(await api.saveProfile(payload));
      // Nothing that re-renders this route may run here. Both a Server Action
      // and router.refresh() re-execute the page's server component, which
      // redirects away the moment the profile is complete — and the completion
      // screen would never be seen. Navigation happens on the button instead.
      transition(() => setDone(true), 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Couldn't save your details.");
    } finally {
      setSaving(false);
    }
  }, [draft, transition]);

  const advance = useCallback(() => {
    const message = validate(step);
    if (message) {
      setError(message);
      return;
    }
    if (index === QUESTIONS.length - 1) submit();
    else transition(() => setIndex((i) => i + 1), 1);
  }, [validate, step, index, submit, transition]);

  const goBack = useCallback(() => {
    if (index === 0) return;
    setError(null);
    transition(() => setIndex((i) => i - 1), -1);
  }, [index, transition]);

  /**
   * Choosing an option answers the question, so it also moves on — but only
   * after a beat, so the selected state is visible before the screen changes.
   */
  const choose = useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) => {
      set(key, value);
      window.setTimeout(() => {
        if (key === "activityLevel") return; // Last question: needs the explicit finish.
        transition(() => setIndex((i) => i + 1), 1);
      }, 260);
    },
    [set, transition],
  );

  const stageClass = `ob-stage ob-${phase} ${direction === 1 ? "ob-dir-fwd" : "ob-dir-back"}`;

  return (
    // Setup wears the default palette throughout, including after the sex
    // question. It used to retint live on that answer, which made a health input
    // read as a theme picker mid-flow; the tint it implies is applied once, on
    // finish, and is a setting from then on.
    <div className="ob-shell" data-palette="rose">
      <div className="ob-frame">
        {!done && (
          <div className="ob-progress" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={QUESTIONS.length} aria-label="Setup progress">
            {QUESTIONS.map((id, i) => (
              <span
                key={id}
                className={`ob-pip ${i < index ? "is-done" : ""} ${i === index ? "is-current" : ""}`}
              />
            ))}
          </div>
        )}

        <form
          className={stageClass}
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) advance();
          }}
        >
          {step === "name" && (
            <Step
              art={<WaveArt />}
              eyebrow={suggestedName ? `Hey, ${suggestedName}.` : "Welcome."}
              question="What should we call you?"
              hint="This is the name you'll be greeted with."
            >
              <input
                className="ob-input"
                autoFocus
                value={draft.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                placeholder="Enter your name"
                maxLength={40}
                autoComplete="given-name"
                aria-label="First name"
              />
            </Step>
          )}

          {step === "context" && (
            <Step
              art={<WeekArt />}
              eyebrow="Your week"
              question="What does a normal week look like?"
              hint="It shapes how much your plan asks of you."
            >
              {/* A 2×2 of cards rather than a stack of bare text rows — four
                  equal options read as a choice, a list reads as a form. */}
              <div className="ob-tiles">
                {LIFE_CONTEXTS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`ob-tile ${draft.lifeContext === option.value ? "is-selected" : ""}`}
                    onClick={() => choose("lifeContext", option.value)}
                    aria-pressed={draft.lifeContext === option.value}
                  >
                    <span className="ob-tile-icon">
                      <OptionIcon icon={option.icon} />
                    </span>
                    <b>{option.label}</b>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            </Step>
          )}

          {step === "goal" && (
            <Step
              art={<TargetArt />}
              eyebrow="Your week"
              question="What are you working towards?"
              hint="We'll build your first plan around this."
            >
              <div className="ob-tiles">
                {PRIMARY_GOALS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`ob-tile ${draft.primaryGoal === option.value ? "is-selected" : ""}`}
                    onClick={() => choose("primaryGoal", option.value)}
                    aria-pressed={draft.primaryGoal === option.value}
                  >
                    <span className="ob-tile-icon">
                      <OptionIcon icon={option.icon} />
                    </span>
                    <b>{option.label}</b>
                    <small>{option.detail}</small>
                  </button>
                ))}
              </div>
            </Step>
          )}

          {step === "age" && (
            <Step
              art={<CalendarArt />}
              eyebrow="A little about you"
              question="How old are you?"
              hint="Used to personalise your profile."
            >
              <div className="ob-suffix-field">
                <input
                  className="ob-input ob-input-short"
                  autoFocus
                  value={draft.age}
                  onChange={(e) => set("age", e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  placeholder="24"
                  maxLength={3}
                  aria-label="Age in years"
                />
                <span className="ob-suffix">years</span>
              </div>
            </Step>
          )}

          {step === "sex" && (
            <Step eyebrow="A little about you" question="What's your sex?">
              <div className="ob-choice-pair">
                {SEXES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    // Each option carries its own colour, so the two are told
                    // apart at a glance rather than only once one is picked.
                    className={`ob-choice ob-choice-${option.value.toLowerCase()} ${
                      draft.sex === option.value ? "is-selected" : ""
                    }`}
                    onClick={() => choose("sex", option.value)}
                    aria-pressed={draft.sex === option.value}
                  >
                    <FigureGlyph variant={option.value} />
                    <span>{option.label}</span>
                  </button>
                ))}
              </div>
            </Step>
          )}

          {step === "height" && (
            <Step
              art={<HeightArt heightMm={heightMm} label={formatHeight(heightMm, draft.heightUnit)} />}
              eyebrow="Your measurements"
              question="How tall are you?"
            >
              <UnitToggle
                options={[
                  { value: "cm", label: "cm" },
                  { value: "ftin", label: "ft / in" },
                ]}
                value={draft.heightUnit}
                onChange={(v) => switchHeightUnit(v as Draft["heightUnit"])}
              />

              {draft.heightUnit === "cm" ? (
                <div className="ob-suffix-field">
                  <input
                    className="ob-input ob-input-short"
                    value={draft.cm}
                    onChange={(e) => set("cm", e.target.value.replace(/[^\d]/g, ""))}
                    inputMode="numeric"
                    maxLength={3}
                    aria-label="Height in centimetres"
                  />
                  <span className="ob-suffix">cm</span>
                </div>
              ) : (
                <div className="ob-split-field">
                  <div className="ob-suffix-field">
                    <input
                      className="ob-input ob-input-short"
                      value={draft.feet}
                      onChange={(e) => set("feet", e.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      maxLength={1}
                      aria-label="Height, feet"
                    />
                    <span className="ob-suffix">ft</span>
                  </div>
                  <div className="ob-suffix-field">
                    <input
                      className="ob-input ob-input-short"
                      value={draft.inches}
                      onChange={(e) => set("inches", e.target.value.replace(/[^\d]/g, ""))}
                      inputMode="numeric"
                      maxLength={2}
                      aria-label="Height, inches"
                    />
                    <span className="ob-suffix">in</span>
                  </div>
                </div>
              )}

              <input
                type="range"
                className="ob-slider"
                min={1200}
                max={2150}
                step={10}
                value={Math.min(2150, Math.max(1200, heightMm || 1700))}
                onChange={(e) => setHeightFromMm(Number(e.target.value))}
                aria-label="Height slider"
              />
            </Step>
          )}

          {step === "weight" && (
            <Step
              art={
                // formatWeight, not a local round: the dial must read the same
                // as the field beside it, decimals included.
                <WeightArt
                  weightGrams={weightGrams}
                  label={formatWeight(weightGrams, draft.weightUnit)}
                />
              }
              eyebrow="Your measurements"
              question="What's your current weight?"
            >
              <UnitToggle
                options={[
                  { value: "kg", label: "kg" },
                  { value: "lb", label: "lb" },
                ]}
                value={draft.weightUnit}
                onChange={(v) => switchWeightUnit(v as Draft["weightUnit"])}
              />

              <div className="ob-suffix-field">
                <input
                  className="ob-input ob-input-short"
                  value={draft.weight}
                  onChange={(e) => set("weight", e.target.value.replace(/[^\d]/g, ""))}
                  inputMode="numeric"
                  maxLength={5}
                  aria-label={`Weight in ${draft.weightUnit}`}
                />
                <span className="ob-suffix">{draft.weightUnit}</span>
              </div>

              <input
                type="range"
                className="ob-slider"
                min={30000}
                max={200000}
                step={1000}
                value={Math.min(200000, Math.max(30000, weightGrams || 70000))}
                onChange={(e) => setWeightFromGrams(Number(e.target.value))}
                aria-label="Weight slider"
              />
            </Step>
          )}

          {step === "activity" && (
            <Step eyebrow="Almost done" question="How active are you usually?">
              <div className="ob-level-list">
                {ACTIVITY_LEVELS.map((level) => (
                  <button
                    key={level.value}
                    type="button"
                    className={`ob-level ${draft.activityLevel === level.value ? "is-selected" : ""}`}
                    onClick={() => set("activityLevel", level.value)}
                    aria-pressed={draft.activityLevel === level.value}
                  >
                    <span className="ob-level-icon">
                      <ActivityGlyph level={level.value} />
                    </span>
                    <span className="ob-level-copy">
                      <b>{level.label}</b>
                      <small>{level.detail}</small>
                    </span>
                    <Check className="ob-level-check" size={16} />
                  </button>
                ))}
              </div>
            </Step>
          )}

          {step === "done" && (
            <div className="ob-step ob-step-done">
              <CompletionArt />

              <h1 className="ob-welcome">
                {existing ? "All updated" : "Welcome"}
                {draft.firstName ? `, ${draft.firstName}` : ""}
              </h1>
              <p className="ob-welcome-sub">Here&apos;s what&apos;s waiting for you.</p>

              {/* The answers turned into things. Saying so is the difference
                  between setup that felt worth it and a form that took eight
                  screens and handed back an empty dashboard. */}
              {summary && (
                <ul className="ob-summary">
                  {summary.plan && (
                    <li>
                      <span className="ob-summary-icon">
                        <Dumbbell size={15} />
                      </span>
                      <span className="ob-summary-copy">
                        <b>
                          {summary.plan.name} · {summary.plan.daysPerWeek} days a week
                        </b>
                        <small>{summary.plan.rationale}</small>
                      </span>
                    </li>
                  )}
                  {summary.goalsCreated > 0 && (
                    <li>
                      <span className="ob-summary-icon">
                        <Target size={15} />
                      </span>
                      <span className="ob-summary-copy">
                        <b>{summary.goalsCreated} goals to aim at</b>
                        <small>One for training, one for the rest of your week.</small>
                      </span>
                    </li>
                  )}
                  {summary.habitsCreated > 0 && (
                    <li>
                      <span className="ob-summary-icon">
                        <Sparkles size={15} />
                      </span>
                      <span className="ob-summary-copy">
                        <b>{summary.habitsCreated} habits to keep</b>
                        <small>Small enough to actually stick to.</small>
                      </span>
                    </li>
                  )}
                </ul>
              )}

              <button
                type="button"
                className="ob-primary"
                autoFocus
                onClick={() => router.push("/today")}
              >
                Go to your day <ArrowRight size={16} />
              </button>
            </div>
          )}

          {error && (
            <p className="ob-error" role="alert">
              {error}
            </p>
          )}

          {!done && (
            <div className="ob-controls">
              {index > 0 ? (
                <button type="button" className="ob-back" onClick={goBack} disabled={saving}>
                  <ArrowLeft size={15} /> Back
                </button>
              ) : (
                <span />
              )}

              <button type="submit" className="ob-primary" disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 size={16} className="spin" /> Saving
                  </>
                ) : index === QUESTIONS.length - 1 ? (
                  <>
                    Finish <Check size={16} />
                  </>
                ) : (
                  <>
                    Continue <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

const OPTION_ICONS: Record<string, LucideIcon> = {
  study: GraduationCap,
  work: Briefcase,
  both: Layers,
  other: Compass,
  // A weighing scale and a heartbeat say what they mean; a downward chart line
  // and a gust of wind did not.
  scale: Scale,
  strength: Dumbbell,
  heart: HeartPulse,
  healthy: Leaf,
};

function OptionIcon({ icon }: { icon: string }) {
  const Icon = OPTION_ICONS[icon] ?? Compass;
  return <Icon size={20} strokeWidth={1.7} />;
}

function Step({
  art,
  eyebrow,
  question,
  hint,
  children,
}: {
  art?: React.ReactNode;
  eyebrow: string;
  question: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="ob-step">
      {art}
      <p className="ob-eyebrow">{eyebrow}</p>
      <h1 className="ob-question">{question}</h1>
      {hint && <p className="ob-hint">{hint}</p>}
      <div className="ob-fields">{children}</div>
    </div>
  );
}

function UnitToggle({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ob-units" role="group" aria-label="Units">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "is-active" : ""}
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
