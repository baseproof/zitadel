import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { TurnstileProvider, useTurnstile } from "./turnstile-provider";

type Action = Parameters<typeof useTurnstile>[0];
type Handle = ReturnType<typeof useTurnstile>;
type Options = {
  callback: (token: string) => void;
  "expired-callback": () => void;
  "error-callback": () => boolean;
  "timeout-callback": () => void;
  "before-interactive-callback": () => void;
  "unsupported-callback": () => void;
  [key: string]: unknown;
};

const config = { enabled: true, siteKey: "public-test-site-key", appearance: "interaction-only" } as const;
let widgets: { id: string; container: HTMLElement; options: Options }[];
let api: {
  render: ReturnType<typeof vi.fn<(container: HTMLElement, options: Options) => string>>;
  remove: ReturnType<typeof vi.fn<(id: string) => void>>;
};

function Consumer({ capture, action = "login" }: { capture: (handle: Handle) => void; action?: Action }) {
  const handle = useTurnstile(action);
  useEffect(() => {
    capture(handle);
  }, [capture, handle]);
  return handle.widget;
}

async function mount(action: Action = "login", enabled = true) {
  let handle!: Handle;
  const view = render(
    <TurnstileProvider config={enabled ? config : { enabled: false }}>
      <Consumer action={action} capture={(value) => (handle = value)} />
    </TurnstileProvider>,
  );
  await act(async () => {});
  return {
    ...view,
    get handle() {
      return handle;
    },
  };
}

function failMessage(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => "unexpected_success",
    (error: Error) => error.message,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  widgets = [];
  api = {
    render: vi.fn((container: HTMLElement, options: Options) => {
      const id = `widget-${widgets.length + 1}`;
      widgets.push({ id, container, options });
      return id;
    }),
    remove: vi.fn(),
  };
  vi.stubGlobal("turnstile", api);
});

afterEach(() => {
  cleanup();
  document
    .querySelectorAll('script[src^="https://challenges.cloudflare.com/turnstile/"]')
    .forEach((script) => script.remove());
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Turnstile widget admission", () => {
  test("starts in the background with only public configuration and does not submit a form", async () => {
    const view = await mount("signup");
    expect(api.render).toHaveBeenCalledOnce();
    expect(widgets[0].options).toMatchObject({
      sitekey: config.siteKey,
      action: "signup",
      appearance: "interaction-only",
      execution: "render",
      "response-field": false,
      retry: "never",
    });
    act(() => widgets[0].options.callback("private-challenge-token"));
    expect(view.container.textContent).not.toContain("private-challenge-token");
    expect(view.container.querySelector("input")).toBeNull();
    await expect(view.handle.getToken()).resolves.toBe("private-challenge-token");
  });

  test("returns undefined without loading anything only when explicitly disabled", async () => {
    const view = await mount("login", false);
    await expect(view.handle.getToken()).resolves.toBeUndefined();
    expect(view.container).toBeEmptyDOMElement();
    expect(api.render).not.toHaveBeenCalled();
    expect(document.querySelector('script[src*="challenges.cloudflare.com"]')).toBeNull();
  });

  test("waits for an explicitly requested token and rejects concurrent acquisition", async () => {
    const view = await mount();
    let pending!: Promise<string | undefined>;
    let duplicate!: Promise<string>;
    act(() => {
      pending = view.handle.getToken();
      duplicate = failMessage(view.handle.getToken());
    });
    expect(screen.getByText("Checking your browser…")).toBeVisible();
    await expect(duplicate).resolves.toBe("Security verification is already in progress.");
    act(() => widgets[0].options.callback("first-token"));
    await expect(pending).resolves.toBe("first-token");
  });

  test("refreshes a consumed token before a later independent submission", async () => {
    const view = await mount();
    act(() => widgets[0].options.callback("first-token"));
    await expect(view.handle.getToken()).resolves.toBe("first-token");
    let next!: Promise<string | undefined>;
    await act(async () => {
      next = view.handle.getToken();
    });
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    expect(widgets).toHaveLength(2);
    let resolved = false;
    void next.then(() => {
      resolved = true;
    });
    await act(async () => widgets[0].options.callback("stale-token"));
    expect(resolved).toBe(false);
    act(() => widgets[1].options.callback("fresh-token"));
    await expect(next).resolves.toBe("fresh-token");
  });

  test("replaces an expired background token and ignores the old widget callback", async () => {
    const view = await mount();
    act(() => widgets[0].options.callback("expired-token"));
    await act(async () => widgets[0].options["expired-callback"]());
    expect(widgets).toHaveLength(2);
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = view.handle.getToken();
    });
    act(() => {
      widgets[0].options.callback("expired-token");
      widgets[1].options.callback("renewed-token");
    });
    await expect(pending).resolves.toBe("renewed-token");
  });

  test("surfaces challenge failure, rejects the pending submission and supports explicit retry", async () => {
    const view = await mount();
    let rejected!: Promise<string>;
    act(() => {
      rejected = failMessage(view.handle.getToken());
    });
    act(() => expect(widgets[0].options["error-callback"]()).toBe(true));
    await expect(rejected).resolves.toMatch(/unavailable/);
    expect(screen.getByRole("alert")).toHaveTextContent("Security verification is unavailable");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try verification again" })));
    expect(widgets).toHaveLength(2);
    act(() => widgets[1].options.callback("after-retry"));
    await expect(view.handle.getToken()).resolves.toBe("after-retry");
  });

  test("bounds a pending submission even when the provider never calls back", async () => {
    const view = await mount();
    let rejected!: Promise<string>;
    act(() => {
      rejected = failMessage(view.handle.getToken());
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await expect(rejected).resolves.toMatch(/took too long/);
    act(() => widgets[0].options.callback("late-token"));
    await expect(view.handle.getToken()).rejects.toThrow(/took too long/);
    expect(screen.getByRole("button", { name: "Try verification again" })).toBeEnabled();
  });

  test("removes the widget and rejects pending work on unmount", async () => {
    const view = await mount();
    let rejected!: Promise<string>;
    act(() => {
      rejected = failMessage(view.handle.getToken());
    });
    view.unmount();
    await expect(rejected).resolves.toMatch(/cancelled/);
    expect(api.remove).toHaveBeenCalledWith("widget-1");
    act(() => widgets[0].options.callback("unmounted-token"));
    await expect(view.handle.getToken()).rejects.toThrow(/cancelled/);
  });

  test("reset cancels a pending submission rather than silently resuming it", async () => {
    const view = await mount();
    let rejected!: Promise<string>;
    act(() => {
      rejected = failMessage(view.handle.getToken());
    });
    await act(async () => view.handle.reset());
    await expect(rejected).resolves.toMatch(/cancelled/);
    expect(widgets).toHaveLength(2);
  });

  test("focuses interaction only for a waiting submission", async () => {
    const view = await mount();
    act(() => widgets[0].options["before-interactive-callback"]());
    expect(widgets[0].container).not.toHaveFocus();
    let pending!: Promise<string | undefined>;
    act(() => {
      pending = view.handle.getToken();
    });
    act(() => widgets[0].options["before-interactive-callback"]());
    expect(widgets[0].container).toHaveFocus();
    expect(screen.getByText("Complete the security verification to continue.")).toBeVisible();
    act(() => widgets[0].options.callback("interactive-token"));
    await expect(pending).resolves.toBe("interactive-token");
  });

  test("independent forms never overwrite or share tokens", async () => {
    let login!: Handle;
    let signup!: Handle;
    render(
      <TurnstileProvider config={config}>
        <Consumer action="login" capture={(handle) => (login = handle)} />
        <Consumer action="signup" capture={(handle) => (signup = handle)} />
      </TurnstileProvider>,
    );
    await act(async () => {});
    expect(widgets).toHaveLength(2);
    expect(widgets[0].container).not.toBe(widgets[1].container);
    act(() => {
      widgets[0].options.callback("login-token");
      widgets[1].options.callback("signup-token");
    });
    await expect(login.getToken()).resolves.toBe("login-token");
    await expect(signup.getToken()).resolves.toBe("signup-token");
  });
});

describe("Turnstile script lifecycle", () => {
  beforeEach(() => vi.stubGlobal("turnstile", undefined));

  test("loads one official script for multiple widgets", async () => {
    await mount("login");
    await mount("signup");
    const scripts = document.querySelectorAll<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]');
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    vi.stubGlobal("turnstile", api);
    await act(async () => scripts[0].dispatchEvent(new Event("load")));
    expect(api.render).toHaveBeenCalledTimes(2);
  });

  test("supports retry after script failure without reloading the page", async () => {
    const view = await mount();
    let rejected!: Promise<string>;
    act(() => {
      rejected = failMessage(view.handle.getToken());
    });
    const script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]')!;
    await act(async () => script.dispatchEvent(new Event("error")));
    await expect(rejected).resolves.toMatch(/unavailable/);
    expect(script.isConnected).toBe(false);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Try verification again" })));
    const retry = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]')!;
    expect(retry).not.toBe(script);
    vi.stubGlobal("turnstile", api);
    await act(async () => retry.dispatchEvent(new Event("load")));
    act(() => widgets[0].options.callback("loaded-after-retry"));
    await expect(view.handle.getToken()).resolves.toBe("loaded-after-retry");
  });

  test("bounds script loading and never starts an unmounted widget", async () => {
    const view = await mount();
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
    expect(api.render).not.toHaveBeenCalled();
    view.unmount();
    const next = await mount();
    const script = document.querySelector<HTMLScriptElement>('script[src*="challenges.cloudflare.com"]')!;
    next.unmount();
    vi.stubGlobal("turnstile", api);
    await act(async () => script.dispatchEvent(new Event("load")));
    expect(api.render).not.toHaveBeenCalled();
  });
});
