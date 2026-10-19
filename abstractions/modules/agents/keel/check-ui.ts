/**
 * Finds uses of Pi's standard UI (`ctx.ui`) in extensions written for keel,
 * which keel answers without showing anything; an extension's UI goes through
 * `keel(ctx)`. A use is a property access or destructuring of `ui` that the
 * TypeScript checker resolves to Pi's ExtensionContext, so comments, strings,
 * and unrelated `ui` properties are not uses.
 *
 *   node check-ui.ts [--level warning|error] [--project tsconfig.json] FILE...
 *
 * Every use is printed as `file:line:column`. With `--level error` (the
 * default) any use fails the check; with `warning` it only reports. The
 * project's tsconfig must include the files. This checks code that keel's
 * authors build, and does not analyze or isolate arbitrary JavaScript.
 *
 * Runs under Node: TypeScript 7's checker API is reached through
 * `typescript/unstable/sync`, which needs Node's process internals.
 */
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { API } from "typescript/unstable/sync";
import { SyntaxKind } from "typescript/unstable/ast";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    level: { type: "string", default: "error" },
    project: { type: "string", default: "tsconfig.json" },
  },
});
if (values.level !== "warning" && values.level !== "error") {
  console.error("check-ui: --level is warning or error");
  process.exit(2);
}
const project = resolve(values.project!);
const files = positionals.map((file) => resolve(file));
if (files.length === 0) {
  console.error("check-ui: name the files to check");
  process.exit(2);
}

const api = new API({ cwd: dirname(project) });
const findings: string[] = [];
try {
  const snapshot = api.updateSnapshot({ openProjects: [project] });
  const loaded = snapshot.getProject(project);
  if (!loaded) throw new Error(`${project} could not be loaded`);
  for (const file of files) {
    const source = loaded.program.getSourceFile(file);
    if (!source) throw new Error(`${file} is not part of ${project}`);
    const text = readFileSync(file, "utf8");
    const position = (offset: number) => {
      const before = text.slice(0, offset).split("\n");
      return `${before.length}:${before.at(-1)!.length + 1}`;
    };
    const visit = (node: any): void => {
      const name =
        node.kind === SyntaxKind.PropertyAccessExpression
          ? node.name
          : node.kind === SyntaxKind.BindingElement
            ? (node.propertyName ?? node.name)
            : undefined;
      if (name?.text === "ui") {
        const parent = loaded.checker.getSymbolAtLocation(name)?.getParent();
        if (parent?.name === "ExtensionContext")
          findings.push(
            `${relative(process.cwd(), file)}:${position(name.end - 2)}: ctx.ui is Pi's UI, which keel does not show; use keel(ctx)`,
          );
      }
      node.forEachChild(visit);
    };
    visit(source);
  }
} finally {
  api.close();
}
for (const finding of findings) console.error(`${values.level}: ${finding}`);
if (findings.length && values.level === "error") process.exit(1);
