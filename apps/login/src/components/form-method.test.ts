import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, test } from "vitest";

// Before the page hydrates, a submit is the browser's own, and a form with no
// method sends a GET: every named field, a password too, lands in the URL and
// so in history and access logs. Seen on 02b against a slow dev server on
// 2026-10-29 (baseproof/legal-agents#120): GET /register?firstname=…&email=&consent=on.
// A POST to a page renders that page and drops the body, so every form posts.
const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

// A form whose action is a server action: React renders it as a POST itself
// and overrides any method set beside it.
const SERVER_ACTION_FORMS = new Set(["components/sign-in-with-idp.tsx"]);

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx") ? [path] : [];
  });
}

function formsThatMayGet(path: string): string[] {
  const file = relative(SRC, path);
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];

  const visit = (node: ts.Node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(source) === "form") {
      const attribute = (name: string) =>
        node.attributes.properties.find(
          (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(source) === name,
        );
      const method = attribute("method")?.initializer;
      const posts = !!method && ts.isStringLiteral(method) && method.text === "post";
      const serverAction = SERVER_ACTION_FORMS.has(file) && !!attribute("action");
      if (!posts && !serverAction) {
        found.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

describe("the login's forms", () => {
  test("finds the forms it guards", () => {
    const files = sources(SRC).map((path) => relative(SRC, path));
    expect(files).toContain("components/password-form.tsx");
    expect(files).toContain("components/set-password-form.tsx");
  });

  test("every form posts, so a submit before hydration puts no field in the URL", () => {
    expect(sources(SRC).flatMap(formsThatMayGet)).toEqual([]);
  });
});
