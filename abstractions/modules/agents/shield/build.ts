/**
 * Builds keel's executables: the screen as a compiled Bun executable, and the
 * driver as one Node module beside its node_modules,
 * which Pi and its extensions load from at run time.
 */
import solidPlugin from "@opentui/solid/bun-plugin";

const check = (result: Awaited<ReturnType<typeof Bun.build>>) => {
  if (result.success) return;
  for (const log of result.logs) console.error(log);
  process.exit(1);
};

const builds = await Promise.all([
  Bun.build({
    entrypoints: ["./keel/screen/main.tsx"],
    target: "bun",
    plugins: [solidPlugin],
    minify: true,
    // The screen runs in arbitrary directories, whose Bun configuration must not change it.
    compile: { outfile: "dist/keel", autoloadBunfig: false, autoloadDotenv: false },
  }),
  Bun.build({
    entrypoints: ["./keel/driver/main.ts"],
    target: "node",
    format: "esm",
    packages: "external",
    naming: "driver.mjs",
    outdir: "dist",
  }),
]);
builds.forEach(check);
