import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { verifyTurnstile } from "./turnstile";

// Execute the production action module, substituting only its private effects.
// Keeping the real verifier catches ordering failures as well as missing guards.
// This isolates the security boundary from generated protobufs and live accounts;
// the application build remains the module/type contract check.
const effects = new Map<string, ReturnType<typeof vi.fn>>();
function effect(name: string) {
  if (!effects.has(name))
    effects.set(
      name,
      vi.fn(async (..._args: unknown[]) => ({ redirect: "/next" })),
    );
  return effects.get(name)!;
}
const source = readFileSync(resolve("src/lib/server/actions.ts"), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
});
const actionModule = { exports: {} as Record<string, (command: Record<string, unknown>) => Promise<any>> };
runInNewContext(compiled.outputText, {
  module: actionModule,
  exports: actionModule.exports,
  process,
  URLSearchParams,
  require: (name: string) => {
    if (name === "./turnstile") return { verifyTurnstile };
    if (name === "next/headers") return { headers: async () => new Headers({ host: "id.example.com" }) };
    if (name === "./host") return { getPublicHostWithProtocol: () => "https://id.example.com" };
    if (name === "@zitadel/client") return { create: (_schema: unknown, value: unknown) => value };
    if (name.endsWith("challenge_pb")) {
      return { RequestChallengesSchema: {}, UserVerificationRequirement: { REQUIRED: 1, DISCOURAGED: 3 } };
    }
    if (name.endsWith("session_service_pb")) return { ChecksSchema: {} };
    if (
      [
        "./password",
        "./register",
        "./loginname",
        "./session",
        "./passkeys",
        "./verify",
        "./idp",
        "./idp-intent",
        "./device",
        "./oidc",
        "./u2f",
        "../client",
      ].includes(name)
    ) {
      return new Proxy({}, { get: (_target, property) => effect(`${name}:${String(property)}`) });
    }
    throw new Error(`Unexpected action dependency: ${name}`);
  },
});
const actions = actionModule.exports;

const protectedOperations = [
  {
    name: "sendPassword",
    action: "login",
    command: { loginName: "user@example.com", checks: { password: { password: "dummy" } } },
    effect: "./password:sendPassword",
  },
  {
    name: "checkSessionAndSetPassword",
    action: "login",
    command: { sessionId: "session", currentPassword: "dummy", password: "new" },
    effect: "./password:checkSessionAndSetPassword",
  },
  { name: "registerUser", action: "signup", command: { email: "user@example.com" }, effect: "./register:registerUser" },
  {
    name: "registerUserAndLinkToIDP",
    action: "signup",
    command: { email: "user@example.com" },
    effect: "./register:registerUserAndLinkToIDP",
  },
  {
    name: "sendPasskey",
    action: "login",
    command: { checks: { webAuthN: { credentialAssertionData: {} } } },
    effect: "./passkeys:sendPasskey",
  },
  {
    name: "createNewSessionForLDAP",
    action: "login",
    command: { username: "user", password: "dummy" },
    effect: "./idp:createNewSessionForLDAP",
  },
  {
    name: "processIDPCallback",
    action: "signup",
    command: { provider: "google", id: "intent", token: "intent-token" },
    effect: "./idp-intent:processIDPCallback",
  },
  ...["email", "sms", "time-based"].map((method) => ({
    name: "updateOrCreateSession",
    action: "login",
    command: { operation: "otp-verify", method, code: "123456" },
    effect: "./session:updateOrCreateSession",
  })),
];

function cloudflare(success: boolean, action = "login") {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success,
            action,
            hostname: "id.example.com",
            challenge_ts: new Date().toISOString(),
          }),
          { headers: { "content-type": "application/json" } },
        ),
    ),
  );
}

beforeEach(() => {
  effects.forEach((mock) => mock.mockClear());
  vi.stubEnv("TURNSTILE_ENABLED", "true");
  vi.stubEnv("TURNSTILE_SITE_KEY", "dummy-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "dummy-secret-key");
  vi.stubEnv("TURNSTILE_ALLOWED_HOSTNAMES", "id.example.com");
  vi.stubEnv("TURNSTILE_APPEARANCE", "interaction-only");
  cloudflare(false);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each(protectedOperations)("$name $command.method", (operation) => {
  test.each([undefined, "invalid-token"])("rejects %s before any private effect", async (turnstileToken) => {
    expect(await actions[operation.name]({ ...operation.command, turnstileToken })).toHaveProperty("error");
    effects.forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  test("rejects a token issued for a different action", async () => {
    cloudflare(true, operation.action === "login" ? "signup" : "login");
    expect(await actions[operation.name]({ ...operation.command, turnstileToken: "token" })).toHaveProperty("error");
    effects.forEach((mock) => expect(mock).not.toHaveBeenCalled());
  });
  test("verifies exactly once before invoking the intended operation", async () => {
    cloudflare(true, operation.action);
    await actions[operation.name]({ ...operation.command, turnstileToken: "token" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(effect(operation.effect)).toHaveBeenCalledTimes(1);
  });
});

test("explicit disabled configuration keeps existing behavior", async () => {
  vi.stubEnv("TURNSTILE_ENABLED", "false");
  await actions.registerUser({ email: "user@example.com" });
  expect(effect("./register:registerUser")).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["checks", "challenges", "lifetime"])("the public session action rejects raw %s payloads", async (key) => {
  vi.stubEnv("TURNSTILE_ENABLED", "false");
  const result = await actions.updateOrCreateSession({
    operation: "passkey-challenge",
    userVerification: "required",
    [key]: {},
  });
  expect(result).toHaveProperty("error");
  effects.forEach((mock) => expect(mock).not.toHaveBeenCalled());
});

test("pre-authentication challenge creation cannot carry a credential check", async () => {
  await actions.updateOrCreateSession({ operation: "passkey-challenge", userVerification: "required" });
  const command = effect("./session:updateOrCreateSession").mock.calls[0][0];
  expect(command).not.toHaveProperty("checks");
  expect(command).not.toHaveProperty("lifetime");
  expect(fetch).not.toHaveBeenCalled();
});

test("generic helpers and credential-bearing cookie helpers are not server actions", () => {
  const root = resolve("src/lib");
  const files = [
    "client.ts",
    "cookies.ts",
    "self.ts",
    ...readdirSync(resolve(root, "server"))
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "actions.ts")
      .map((name) => `server/${name}`),
  ];
  for (const file of files) {
    const content = readFileSync(resolve(root, file), "utf8");
    const parsed = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const directives = parsed.statements
      .filter(ts.isExpressionStatement)
      .filter((statement) => ts.isStringLiteral(statement.expression))
      .map((statement) => (statement.expression as ts.StringLiteral).text);
    expect(directives, file).not.toContain("use server");
  }
  expect(compiled.diagnostics).toEqual([]);
});

test("browser imports cross the public action boundary before server-only helpers", () => {
  const root = resolve("src");
  const walk = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)],
    );
  const files = walk(root).filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  const nodes = new Map<string, { client: boolean; action: boolean; private: boolean; imports: string[] }>();
  for (const file of files) {
    const filename = resolve(root, file);
    const content = readFileSync(filename, "utf8");
    const javascript = ts.transpileModule(content, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const parsed = ts.createSourceFile(filename, javascript, ts.ScriptTarget.Latest, true);
    const directives = parsed.statements
      .filter(ts.isExpressionStatement)
      .map((statement) => (ts.isStringLiteral(statement.expression) ? statement.expression.text : ""));
    const imports: string[] = [];
    const collectImports = (node: ts.Node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        imports.push(node.moduleSpecifier.text);
      }
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        imports.push(node.arguments[0].text);
      }
      ts.forEachChild(node, collectImports);
    };
    collectImports(parsed);
    nodes.set(filename, {
      client: directives.includes("use client"),
      action: directives.includes("use server"),
      private: imports.includes("server-only"),
      imports,
    });
  }
  const visited = new Set<string>();
  const inspect = (filename: string, path: string[]) => {
    const node = nodes.get(filename);
    if (!node || node.action || visited.has(filename)) return;
    expect(node.private, path.join(" -> ")).toBe(false);
    visited.add(filename);
    for (const imported of node.imports) {
      const base = imported.startsWith("@/")
        ? resolve(root, imported.slice(2))
        : imported.startsWith(".")
          ? resolve(dirname(filename), imported)
          : undefined;
      if (!base) continue;
      const target = [base, `${base}.ts`, `${base}.tsx`, resolve(base, "index.ts"), resolve(base, "index.tsx")].find(
        (candidate) => nodes.has(candidate) && existsSync(candidate),
      );
      if (target) inspect(target, [...path, imported]);
    }
  };
  nodes.forEach((node, filename) => {
    if (node.client) inspect(filename, [filename]);
  });
  expect(visited.size).toBeGreaterThan(30);
});
