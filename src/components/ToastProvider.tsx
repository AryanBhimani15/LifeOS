"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Zap } from "lucide-react";

/**
 * Toasts report what actually happened.
 *
 * The mockup this replaces toasted "New task created in your inbox" from a
 * button that created nothing. A toast is a claim about the system's state, so
 * it is only ever fired after a server action returns.
 */

type ToastKind = "info" | "error";

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState<ToastKind>("info");

  const toast = useCallback((next: string, nextKind: ToastKind = "info") => {
    setMessage(next);
    setKind(nextKind);
  }, []);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 3200);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {message && (
        <div className={`toast ${kind === "error" ? "toast-error" : ""}`} role="status">
          <Zap size={15} /> {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}
