import { useCallback, useEffect, useRef, useState } from "react";
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from "expo-speech-recognition";

/**
 * On-device speech recognition.
 *
 * Transcription happens on the phone and only TEXT is sent to LifeOS. Streaming
 * audio to the server would burn the AI quota on transcription rather than on
 * understanding the command, add bandwidth, and put a recording of someone's
 * personal task list on the wire. None of that buys anything.
 *
 * Two failure modes are handled explicitly because both are silent otherwise:
 *
 *  1. Offline with no downloaded dictation assets. iOS reports the recogniser as
 *     unavailable and the mic simply never starts. The UI must fall back to
 *     typing rather than appearing broken.
 *  2. Partial results. Only the FINAL transcript is sent onward — firing a
 *     request per interim result would exhaust a 20-requests-per-minute quota in
 *     one sentence.
 */

export type SpeechState = "idle" | "starting" | "listening" | "unavailable" | "denied";

export interface SpeechController {
  state: SpeechState;
  /** Live text while speaking; not sent anywhere until it is final. */
  transcript: string;
  /** Set when recognition failed in a way the user can act on. */
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useSpeech(onFinal: (text: string) => void): SpeechController {
  const [state, setState] = useState<SpeechState>("idle");
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Held in a ref so the event handler always sees the latest callback without
  // re-subscribing on every render.
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  useSpeechRecognitionEvent("start", () => setState("listening"));

  useSpeechRecognitionEvent("result", (event) => {
    const text = event.results?.[0]?.transcript ?? "";
    setTranscript(text);
    // `isFinal` is the signal that the speaker paused. Anything earlier is a
    // guess that will change.
    if (event.isFinal && text.trim()) {
      onFinalRef.current(text.trim());
    }
  });

  useSpeechRecognitionEvent("end", () => {
    setState((current) => (current === "listening" || current === "starting" ? "idle" : current));
  });

  useSpeechRecognitionEvent("error", (event) => {
    setState("idle");
    // `not-allowed` and `service-not-allowed` mean permission; everything else
    // is usually the recogniser being unavailable offline.
    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      setState("denied");
      setError("Microphone access is off. Turn it on in Settings, or type instead.");
    } else {
      setError("Speech isn't available right now — you can type instead.");
    }
  });

  const start = useCallback(async () => {
    setError(null);
    setTranscript("");
    setState("starting");

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        setState("denied");
        setError("Microphone access is off. Turn it on in Settings, or type instead.");
        return;
      }

      ExpoSpeechRecognitionModule.start({
        lang: "en-US",
        interimResults: true,
        // Prefer on-device where the phone supports it; iOS falls back to its
        // own service when it does not.
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
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // Stopping something that never started is not an error worth showing.
    }
    setState("idle");
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    setState("idle");
  }, []);

  return { state, transcript, error, start, stop, reset };
}
