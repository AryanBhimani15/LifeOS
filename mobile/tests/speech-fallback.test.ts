import { describe, expect, it } from "vitest";

/**
 * Speech degradation.
 *
 * Node has no native modules, which is exactly the condition Expo Go creates:
 * the JS package is present but its native side is not. So importing the module
 * here reproduces the Expo Go case faithfully, and the assertion that matters is
 * simply that the import does not throw.
 *
 * That was the actual bug: `lib/speech.ts` imported `expo-speech-recognition` at
 * module scope, `app/index.tsx` imported that, so in Expo Go the app died at
 * launch rather than showing a disabled microphone.
 */

describe("speech module", () => {
  it("imports without throwing when the native module is absent", async () => {
    // A static top-level import in the app is what crashed Expo Go. If this
    // import throws, that regression is back.
    await expect(import("../lib/speech")).resolves.toBeTruthy();
  });

  it("reports itself unavailable rather than pretending to work", async () => {
    const { speechAvailable } = await import("../lib/speech");
    expect(speechAvailable).toBe(false);
  });

  it("explains why voice is missing and what to do instead", async () => {
    const { UNAVAILABLE_MESSAGE } = await import("../lib/speech");
    // The message has to name the cause and the workaround — "unavailable"
    // alone leaves someone poking at a dead button.
    expect(UNAVAILABLE_MESSAGE).toMatch(/development build/i);
    expect(UNAVAILABLE_MESSAGE).toMatch(/type/i);
  });

  it("exposes the same controller shape either way", async () => {
    const speech = await import("../lib/speech");
    // The screen must not need to branch on availability to call these.
    expect(typeof speech.useSpeech).toBe("function");
  });
});
