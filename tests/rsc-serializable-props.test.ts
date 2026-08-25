/**
 * RSC boundary guard — server components may only pass SERIALISABLE props.
 *
 * React Server Components cannot send a function across the server/client
 * boundary. Doing so throws at render time:
 *
 *   "Functions cannot be passed directly to Client Components unless you
 *    explicitly expose it by marking it with 'use server'."
 *
 * That is exactly how «پول → حساب‌ها» broke: the page handed its `toIrt`
 * formatter to the `AccountListItem` client component, so every user with at
 * least one wallet saw the generic error card instead of their accounts.
 *
 * A plain SSR render does NOT catch this (the check lives in the Flight
 * encoder), so this suite statically inspects the source instead: for every
 * client component imported by a server component, no declared prop may be a
 * function type.
 *
 * Static analysis only — nothing is executed, and no financial code is touched.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC);

function readSource(file: string): string {
  return fs.readFileSync(file, "utf8");
}

function isClientComponent(file: string): boolean {
  const head = readSource(file).slice(0, 400);
  return /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/m.test(head);
}

/** Resolve an `@/...` or relative import to a file on disk. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;

  for (const candidate of [`${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** Client components that a server component (page/layout) renders. */
function clientComponentsUsedByServerComponents(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const file of files) {
    if (isClientComponent(file)) continue;
    const source = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const target = resolveImport(file, statement.moduleSpecifier.text);
      if (!target || !isClientComponent(target)) continue;
      result.set(target, [...(result.get(target) ?? []), file]);
    }
  }
  return result;
}

/** Prop names declared with a function type in a client component. */
function functionTypedProps(file: string): string[] {
  const source = ts.createSourceFile(file, readSource(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];

  const isFunctionType = (node: ts.TypeNode | undefined): boolean => {
    if (!node) return false;
    if (ts.isFunctionTypeNode(node)) return true;
    if (ts.isUnionTypeNode(node)) return node.types.some(isFunctionType);
    if (ts.isParenthesizedTypeNode(node)) return isFunctionType(node.type);
    return false;
  };

  const visitMembers = (members: ts.NodeArray<ts.TypeElement>, owner: string) => {
    for (const member of members) {
      if (ts.isPropertySignature(member) && isFunctionType(member.type)) {
        offenders.push(`${owner}.${member.name.getText(source)}`);
      }
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isInterfaceDeclaration(node)) visitMembers(node.members, node.name.text);
    if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      visitMembers(node.type.members, node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return offenders;
}

test("client components rendered by server components declare only serialisable props", () => {
  const usage = clientComponentsUsedByServerComponents();
  assert.ok(usage.size > 0, "the import graph found client components used by server components");

  const violations: string[] = [];
  for (const [clientFile, importers] of usage) {
    for (const prop of functionTypedProps(clientFile)) {
      violations.push(
        `${path.relative(process.cwd(), clientFile)} declares function prop \`${prop}\`, ` +
          `rendered by ${importers.map((f) => path.relative(process.cwd(), f)).join(", ")}`,
      );
    }
  }

  assert.deepEqual(
    violations,
    [],
    "a server component may not pass a function to a client component:\n" + violations.join("\n"),
  );
});

test("AccountListItem takes pre-formatted strings, not a formatter function", () => {
  const file = path.join(SRC, "components", "accounts", "AccountListItem.tsx");
  const source = readSource(file);

  // The specific regression: the money formatter must not cross the boundary.
  assert.ok(!/toIrt\s*[?:]/.test(source), "AccountListItem must not accept a `toIrt` function prop");
  assert.deepEqual(functionTypedProps(file), [], "no function-typed props at all");

  // It receives already-formatted money strings instead.
  assert.ok(/balanceLabel/.test(source), "balance arrives pre-formatted");

  const page = readSource(path.join(SRC, "app", "accounts", "page.tsx"));
  assert.ok(!/toIrt=\{/.test(page), "the accounts page must not pass `toIrt` as a prop");
});
