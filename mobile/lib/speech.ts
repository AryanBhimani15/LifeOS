import { useCallback, useEffect, useRef, useState } from "react";

/**
 * On-device speech recognition, with the native module treated as optional.
 *
 * Transcription happens on the phone and only TEXT is sent to LifeOS. Streaming
 * audio to the server would burn the AI quota on transcription rather than on
 * understanding the command, add bandwidth, and put a recording of someone's
 * personal task list on the wire.
 *
 * WHY THE MODULE IS LOADED DEFENSIVELY
 * `expo-speech-recognition` ships native iOS code, so it is not compiled into
 * the Expo Go binary. A static top-level import therefore crashes the whole app
 * at launch in Expo Go — not at the moment someone taps the microphone. Loading
 * it through a guarded require lets the app run everywhere and degrade to typing
 * where the native side is missing, which matters because a capture app that
 * cannot capture is useless.
 *
 * In a development build (`npx expo run:ios`) the module resolves and voice works.
 */

export type SpeechState = "idle" | "starting" | "listening" | "unavailable" | "denied";

interface SpeechEvent {
  results?: { transcript?: string }[];
  isFinal?: boolean;
  error?: string;
}

interface NativeSpeech {
  ExpoSpeechRecognitionModule: {
    requestPermissionsAsync: () => Promise<{ granted: boolean }>;
    start: (options: Record<string, unknown>) => void;
    stop: () => void;
  };
  useSpeechRecognitionEvent: (name: string, handler: (event: SpeechEvent) => void) => void;
}

/**
 * Resolves the native module, or null when it is not present.
 *
 * Both failure shapes are handled: the require itself throwing (Expo modules
 * call `requireNativeModule()` at import time), and a module that loads but is
 * missing the pieces we use.
 */
function loadNative(): NativeSpeech | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-speech-recognition") as Partial<NativeSpeech>;
    if (!mod?.ExpoSpeechRecognitionModule || typeof mod.useSpeechRecognitionEvent !== "function") {
      return null;
    }
    return mod as NativeSpeech;
  } catch {
    return null;
  }
}

const NATIVE = loadNative();

/** True when voice input can actually work on this build. */
export const speechAvailable = NATIVE !== null;

/**
 * Stand-in for the native event hook.
 *
 * Whether the real hook or this one is used is decided once at module load and
 * never changes for the life of the app, so hook order stays stable across
 * renders and the Rules of Hooks are satisfied.
 */
const noopEventHook: NativeSpeech["useSpeechRecognitionEvent"] = () => {};
const useSpeechEvent = NATIVE?.useSpeechRecognitionEvent ?? noopEventHook;

export const UNAVAILABLE_MESSAGE =
  "Voice needs a development build — Expo Go can't load the speech module. Type instead.";

export interface SpeechController {
  state: SpeechState;
  /** Live text while speaking; not sent anywhere until it is final. */
  transcript: string;
  error: string | null;
  /** False in Expo Go: the UI should lead with typing. */
  available: boolean;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useSpeech(onFinal: (text: string) => void): SpeechController {
  const [state, setState] = useState<SpeechState>(speechAvailable ? "idle" : "unavailable");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the event handler always sees the latest callback without
  // re-subscribing on every render.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useSpeechEvent("start", () => setState("listening"));

  useSpeechEvent("result", (event) => {
    const text = event.results?.[0]?.transcript ?? "";
    setTranscript(text);
    // `isFinal` is the signal that the speaker paused. Sending anything earlier
    // would fire a request per interim result and exhaust the AI quota inside
    // a single sentence.
    if (event.isFinal && text.trim()) onFinalRef.current(text.trim());
  });

  useSpeechEvent("end", () => {
    setState((current) => (current === "listening" || current === "starting" ? "idle" : current));
  });

  useSpeechEvent("error", (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setState("denied");
      setError("Microphone access is off. Turn it on in Settings, or type instead.");
    } else {
      setState("idle");
      // Usually the recogniser being unavailable offline without downloaded
      // dictation assets.
      setError("Speech isn't available right now — you can type instead.");
    }
  });

  const start = useCallback(async () => {
    if (!NATIVE) {
      setState("unavailable");
      setError(UNAVAILABLE_MESSAGE);
      return;
    }

    setError(null);
    setTranscript("");
    setState("starting");

    try {
      const permission = await NATIVE.ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setState("denied");
        setError("Microphone access is off. Turn it on in Settings, or type instead.");
        return;
      }

      NATIVE.ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        requiresOnDeviceRecognition: false,
        continuous: false,
      });
    } catch {
      setState("unavailable");
      setError("Speech isn't available on this device — you can type instead.");
    }
  }, []);

  const stop = useCallback(() => {
    try {
      NATIVE?.ExpoSpeechRecognitionModule.stop();
    } catch {
      // Stopping something that never started is not worth surfacing.
    }
    setState(speechAvailable ? "idle" : "unavailable");
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    setState(speechAvailable ? "idle" : "unavailable");
  }, []);

  return { state, transcript, error, available: speechAvailable, start, stop, reset };
}
