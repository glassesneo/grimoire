/**
 * Builds keel's executables: the screen and the shield client as compiled Bun
 * executables, and the runtime as one Node module beside its node_modules,
 * which Pi and its extensions load from at run time.
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const check = (result: Awaited<ReturnType<typeof Bun.build>>) => {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  process.exit(1);
};

const builds = await Promise.all([
  ...[
    ["./keel/screen/main.tsx", "dist/keel"],
    ["./client/shield.ts", "dist/shield"],
  ].map(([entry, outfile]) =>
    Bun.build({
      entrypoints: [entry!],
      target: "bun",
      plugins: [solidPlugin],
      minify: true,
      // The screen runs in arbitrary directories, whose Bun configuration must not change it.
      compile: { outfile: outfile!, autoloadBunfig: false, autoloadDotenv: false },
    }),
  ),
  Bun.build({
    entrypoints: ["./keel/runtime/main.ts"],
    target: "node",
    format: "esm",
    packages: "external",
    naming: "runtime.mjs",
    outdir: "dist",
  }),
]);
builds.forEach(check);
