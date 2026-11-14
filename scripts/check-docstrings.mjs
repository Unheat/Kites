/**
 * Docstring shape gate for the TypeDoc-scoped layers (`src/offscreen`, `src/shared`).
 *
 * TypeDoc only extracts TSDoc: a malformed or stale comment silently produces wrong reference pages.
 * This check enforces the shape the reference relies on:
 *
 *   1. no legacy `@file` block tag (TypeDoc reports it as unknown);
 *   2. `@param` names must match the actual parameter names exactly;
 *   3. if any parameter is documented, every parameter is documented;
 *   4. a documented symbol starts with a one-line summary, not with a block tag.
 *
 * Symbols without any comment are counted by `check-docs.mjs` instead; this script only guards the
 * shape of comments that exist, so it can run green while the backlog is burned down.
 *
 * Usage: node scripts/check-docstrings.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOTS = ['src/offscreen', 'src/shared'];
const SKIP = [/\.test\.tsx?$/, /hypherData/];

/**
 * Lists TypeScript sources under a directory, skipping tests and bundled data.
 *
 * @param {string} dir - Directory to walk.
 * @param {string[]} [out] - Accumulator.
 * @returns {string[]} File paths.
 */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (!SKIP.some((pattern) => pattern.test(path))) walk(path, out);
    } else if (/\.tsx?$/.test(entry) && !SKIP.some((pattern) => pattern.test(path))) {
      out.push(path);
    }
  }
  return out;
}

/**
 * Returns the JSDoc comments attached to a node.
 *
 * @param {ts.Node} node - Declaration node.
 * @returns {ts.JSDoc[]} Attached doc comments.
 */
function docsOf(node) {
  return node.jsDoc?.filter((doc) => ts.isJSDoc(doc)) ?? [];
}

/**
 * Visits a node and its children, validating each documented declaration.
 *
 * @param {ts.Node} node - Node to inspect.
 * @param {ts.SourceFile} source - Owning source file.
 * @param {{ file: string; line: number; rule: string; detail: string }[]} violations - Collected output.
 * @returns {void}
 */
function visit(node, source, violations) {
  const docs = docsOf(node);
  if (docs.length > 0) {
    const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
    const file = source.fileName;
    for (const doc of docs) {
      const text = doc.getText(source);
      if (/@file\b/.test(text)) {
        violations.push({ file, line, rule: 'no-@file', detail: 'replace the @file tag with a plain summary line' });
      }
      const comment = (doc.comment ?? '').toString().trim();
      const tags = (doc.tags ?? []).map((tag) => tag.getText(source));
      if (!comment && tags.length === 0) {
        violations.push({ file, line, rule: 'empty-comment', detail: '/** */ with no content' });
      }
      if (comment.startsWith('@')) {
        violations.push({ file, line, rule: 'summary-first', detail: 'documented symbol starts with a block tag' });
      }
      // Parameter names must match the declaration exactly.
      const params = ts.isFunctionLike(node) ? node.parameters
        : ts.isVariableDeclaration(node) && node.initializer && ts.isFunctionLike(node.initializer) ? node.initializer.parameters
        : ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) ? []
        : [];
      const paramTags = (doc.tags ?? []).filter((tag) => tag.tagName.text === 'param');
      if (params.length > 0 && paramTags.length > 0) {
        const declared = params.map((param) => param.name.getText(source));
        for (const tag of paramTags) {
          const name = tag.name?.getText(source).replace(/^[[{]/,'').replace(/[\]}]$/,'');
          if (!declared.some((param) => param === name || param.startsWith(`${name}:`))) {
            violations.push({ file, line, rule: 'param-name', detail: `@param ${name} not in (${declared.join(', ')})` });
          }
        }
        const documented = new Set(paramTags.map((tag) => tag.name?.getText(source)));
        for (const param of declared) {
          if (!documented.has(param)) {
            violations.push({ file, line, rule: 'param-missing', detail: `parameter ${param} has no @param` });
          }
        }
      }
    }
  }
  ts.forEachChild(node, (child) => visit(child, source, violations));
}

const violations = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    visit(source, source, violations);
  }
}

const byRule = violations.reduce((acc, violation) => {
  acc[violation.rule] = (acc[violation.rule] ?? 0) + 1;
  return acc;
}, {});
console.log(`[docs] docstring shape violations: ${violations.length}`, byRule);
for (const violation of violations.slice(0, 200)) {
  console.log(`  ${violation.file}:${violation.line} [${violation.rule}] ${violation.detail}`);
}
if (violations.length > 200) console.log(`  … ${violations.length - 200} more`);
process.exit(violations.length > 0 ? 1 : 0);
