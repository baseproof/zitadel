"use client";

import type { TurnstileAction, TurnstilePublicConfig } from "@/lib/turnstile";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_TIMEOUT_MS = 15_000;
const SUBMISSION_TIMEOUT_MS = 60_000;

type WidgetOptions = {
  sitekey: string;
  action: TurnstileAction;
  appearance: "always" | "execute" | "interaction-only";
  execution: "render";
  theme: "auto";
  language: "auto";
  size: "flexible";
  retry: "never";
  "refresh-expired": "manual";
  "refresh-timeout": "manual";
  "response-field": false;
  callback: (token: string) => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "error-callback": () => boolean;
  "unsupported-callback": () => void;
  "before-interactive-callback": () => void;
  "after-interactive-callback": () => void;
};

type TurnstileApi = {
  render: (container: HTMLElement, options: WidgetOptions) => string | undefined;
  remove: (widgetId: string) => void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };
const scripts = new WeakMap<Document, { element: HTMLScriptElement; promise: Promise<TurnstileApi> }>();

function loadScript(): Promise<TurnstileApi> {
  const api = (window as TurnstileWindow).turnstile;
  if (api) return Promise.resolve(api);
  const existing = scripts.get(document);
  if (existing?.element.isConnected) return existing.promise;

  const element = document.createElement("script");
  element.src = SCRIPT_URL;
  element.async = true;
  element.defer = true;
  const promise = new Promise<TurnstileApi>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      element.onload = null;
      element.onerror = null;
    };
    const failed = () => {
      cleanup();
      element.remove();
      scripts.delete(document);
      reject(new Error("turnstile_script_unavailable"));
    };
    const timeout = setTimeout(failed, SCRIPT_TIMEOUT_MS);
    element.onload = () => {
      const loaded = (window as TurnstileWindow).turnstile;
      if (!loaded || typeof loaded.render !== "function" || typeof loaded.remove !== "function") {
        failed();
        return;
      }
      cleanup();
      resolve(loaded);
    };
    element.onerror = failed;
  });
  scripts.set(document, { element, promise });
  document.head.appendChild(element);
  return promise;
}

export type TurnstileMessages = {
  label: string;
  checking: string;
  interaction: string;
  unavailable: string;
  timeout: string;
  cancelled: string;
  pending: string;
  retry: string;
};

const defaultMessages: TurnstileMessages = {
  label: "Security verification",
  checking: "Checking your browser…",
  interaction: "Complete the security verification to continue.",
  unavailable: "Security verification is unavailable. Check your connection and try again.",
  timeout: "Security verification took too long. Please try again.",
  cancelled: "Security verification was cancelled. Please try again.",
  pending: "Security verification is already in progress.",
  retry: "Try verification again",
};

type ProviderValue = { config: TurnstilePublicConfig; messages: TurnstileMessages };
const TurnstileContext = createContext<ProviderValue | null>(null);

export function TurnstileProvider({
  config,
  messages = defaultMessages,
  children,
}: {
  config: TurnstilePublicConfig;
  messages?: TurnstileMessages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ config, messages }), [config, messages]);
  return <TurnstileContext.Provider value={value}>{children}</TurnstileContext.Provider>;
}

type PendingToken = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type WidgetState = {
  mounted: boolean;
  generation: number;
  api?: TurnstileApi;
  id?: string;
  token?: string;
  consumed: boolean;
  error?: string;
  pending?: PendingToken;
};

type Status = "loading" | "ready" | "waiting" | "interaction" | "error";

/** Each hook owns one widget and one pending submission; tokens never leave component memory. */
export function useTurnstile(action: TurnstileAction): {
  getToken: () => Promise<string | undefined>;
  reset: () => void;
  widget: ReactNode;
} {
  const context = useContext(TurnstileContext);
  if (!context) throw new Error("useTurnstile requires TurnstileProvider");
  const { config, messages } = context;
  const enabled = config.enabled;
  const siteKey = config.enabled ? config.siteKey : undefined;
  const appearance = config.enabled ? config.appearance : undefined;
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<WidgetState>({ mounted: false, generation: 0, consumed: false });
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string>();

  const rejectPending = useCallback((message: string) => {
    const current = runtime.current;
    if (current.pending) {
      const pending = current.pending;
      current.pending = undefined;
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
    }
  }, []);

  const fail = useCallback(
    (message: string) => {
      const current = runtime.current;
      current.generation++;
      current.token = undefined;
      current.error = message;
      rejectPending(message);
      if (current.mounted) {
        setError(message);
        setStatus("error");
      }
    },
    [rejectPending],
  );

  const start = useCallback(async (): Promise<void> => {
    const current = runtime.current;
    if (!enabled || !current.mounted || !container.current || !siteKey || !appearance) return;
    const generation = ++current.generation;
    const active = () => current.mounted && current.generation === generation;
    current.token = undefined;
    current.consumed = false;
    current.error = undefined;
    setError(undefined);
    setStatus(current.pending ? "waiting" : "loading");
    if (current.id !== undefined) {
      current.api?.remove(current.id);
      current.id = undefined;
    }
    try {
      const api = await loadScript();
      if (!active() || !container.current) return;
      current.api = api;
      const id = api.render(container.current, {
        sitekey: siteKey,
        action,
        appearance,
        execution: "render",
        theme: "auto",
        language: "auto",
        size: "flexible",
        retry: "never",
        "refresh-expired": "manual",
        "refresh-timeout": "manual",
        "response-field": false,
        callback: (token) => {
          if (!active() || current.consumed) return;
          if (!token || token.length > 2048) {
            fail(messages.unavailable);
            return;
          }
          setStatus("ready");
          const pending = current.pending;
          if (pending) {
            current.pending = undefined;
            clearTimeout(pending.timeout);
            current.consumed = true;
            pending.resolve(token);
          } else {
            current.token = token;
          }
        },
        "expired-callback": () => {
          if (active()) void start();
        },
        "timeout-callback": () => {
          if (active()) fail(messages.timeout);
        },
        "error-callback": () => {
          if (active()) fail(messages.unavailable);
          return true;
        },
        "unsupported-callback": () => {
          if (active()) fail(messages.unavailable);
        },
        "before-interactive-callback": () => {
          if (!active()) return;
          setStatus("interaction");
          if (current.pending) container.current?.focus();
        },
        "after-interactive-callback": () => {
          if (active() && !current.token && !current.consumed) {
            setStatus(current.pending ? "waiting" : "loading");
          }
        },
      });
      if (id === undefined) {
        fail(messages.unavailable);
        return;
      }
      current.id = id;
    } catch {
      // Only script loading/rendering is caught here; no raw provider error reaches logs or the UI.
      if (active()) fail(messages.unavailable);
    }
  }, [enabled, siteKey, appearance, action, fail, messages]);

  useEffect(() => {
    const current = runtime.current;
    current.mounted = true;
    if (enabled) void start();
    return () => {
      current.mounted = false;
      current.generation++;
      current.token = undefined;
      rejectPending(messages.cancelled);
      if (current.id !== undefined) {
        current.api?.remove(current.id);
        current.id = undefined;
      }
    };
  }, [enabled, start, rejectPending, messages.cancelled]);

  const getToken = useCallback((): Promise<string | undefined> => {
    if (!enabled) return Promise.resolve(undefined);
    const current = runtime.current;
    if (!current.mounted) return Promise.reject(new Error(messages.cancelled));
    if (current.pending) return Promise.reject(new Error(messages.pending));
    if (current.error) return Promise.reject(new Error(current.error));
    if (current.token) {
      const token = current.token;
      current.token = undefined;
      current.consumed = true;
      return Promise.resolve(token);
    }
    if (current.consumed) void start();
    setStatus("waiting");
    return new Promise<string>((resolve, reject) => {
      current.pending = {
        resolve,
        reject,
        timeout: setTimeout(() => fail(messages.timeout), SUBMISSION_TIMEOUT_MS),
      };
    });
  }, [enabled, fail, messages, start]);

  const reset = useCallback(() => {
    rejectPending(messages.cancelled);
    if (enabled) void start();
  }, [enabled, messages.cancelled, rejectPending, start]);

  return {
    getToken,
    reset,
    widget: enabled ? (
      <div className="my-2" aria-label={messages.label}>
        <div ref={container} tabIndex={-1} aria-label={messages.label} />
        <div aria-live="polite" aria-atomic="true" className="text-sm">
          {status === "waiting" && messages.checking}
          {status === "interaction" && messages.interaction}
          {status === "error" && (
            <>
              <p role="alert">{error}</p>
              <button type="button" onClick={reset} className="mt-2 underline">
                {messages.retry}
              </button>
            </>
          )}
        </div>
      </div>
    ) : null,
  };
}
