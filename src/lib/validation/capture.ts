import { z } from "zod";
import { isoDateTime } from "./common";

/**
 * Direct capture — turning a spoken or typed sentence into a record WITHOUT
 * the AI.
 *
 * The AI is good at "break my project into five milestones". It is overkill,
 * slow, and rate-limited for "call dad", which is the overwhelmingly common
 * case. Capture must therefore work when the AI is unavailable, out of quota,
 * or switched off entirely — otherwise a two-word note can fail because a
 * language model is busy.
 */

export const captureType = z.enum(["task", "goal", "note", "project", "expense"]);

export const captureSchema = z.object({
  /** Raw transcript or typed text. Used verbatim as the title. */
  text: z.string().trim().min(1, "Nothing to capture").max(2_000),
  type: captureType,
  /** Optional, set by the client's date picker rather than parsed from speech. */
  dueAt: isoDateTime.nullish(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
});

export type CaptureInput = z.infer<typeof captureSchema>;
export type CaptureType = z.infer<typeof captureType>;

/**
 * Pulls a monetary amount out of free text, deterministically.
 *
 * Handles "250 rupee lunch", "$4.50 coffee", "spent 12.99 on books", "₹1,250".
 * Returns null when there is no clear number, in which case the caller stores
 * zero and lets the user correct it — guessing an amount is worse than showing
 * one that is obviously wrong.
 *
 * Deliberately NOT an LLM call: it is a regex, it costs nothing, and it cannot
 * hallucinate a figure into someone's finances.
 */
export function extractAmount(text: string): { amountMajor: number; currency?: string } | null {
  const CURRENCY_SYMBOLS: Record<string, string> = {
    "£": "GBP",
    "$": "USD",
    "€": "EUR",
    "₹": "INR",
    "¥": "JPY",
  };
  const CURRENCY_WORDS: Record<string, string> = {
    rupee: "INR",
    rupees: "INR",
    dollar: "USD",
    dollars: "USD",
    pound: "GBP",
    pounds: "GBP",
    euro: "EUR",
    euros: "EUR",
    yen: "JPY",
  };

  // Symbol immediately before the number: "$4.50", "₹1,250"
  const symbolFirst = text.match(/([£$€₹¥])\s?([\d,]+(?:\.\d{1,2})?)/);
  if (symbolFirst) {
    const value = Number(symbolFirst[2]!.replace(/,/g, ""));
    if (Number.isFinite(value)) {
      return { amountMajor: value, currency: CURRENCY_SYMBOLS[symbolFirst[1]!] };
    }
  }

  // Number followed by a currency word: "250 rupee lunch"
  const wordAfter = text.match(/([\d,]+(?:\.\d{1,2})?)\s*(rupees?|dollars?|pounds?|euros?|yen)\b/i);
  if (wordAfter) {
    const value = Number(wordAfter[1]!.replace(/,/g, ""));
    if (Number.isFinite(value)) {
      return { amountMajor: value, currency: CURRENCY_WORDS[wordAfter[2]!.toLowerCase()] };
    }
  }

  // A bare number anywhere: "spent 12.99 on books". Least confident, so last.
  const bare = text.match(/(?:^|\s)([\d,]+(?:\.\d{1,2})?)(?:\s|$)/);
  if (bare) {
    const value = Number(bare[1]!.replace(/,/g, ""));
    if (Number.isFinite(value) && value > 0) return { amountMajor: value };
  }

  return null;
}

/**
 * Trims a sentence into something that reads as a title.
 *
 * Only strips leading filler that speech naturally produces ("remind me to",
 * "I need to"). It does NOT try to understand the sentence — that is the AI's
 * job, and doing it badly here would be worse than leaving the text alone.
 */
export function tidyTitle(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  const stripped = trimmed.replace(
    /^(?:remind me to|remember to|i need to|i have to|note to self:?|todo:?|task:?)\s+/i,
    "",
  );
  const result = stripped || trimmed;
  return result.charAt(0).toUpperCase() + result.slice(1);
}
