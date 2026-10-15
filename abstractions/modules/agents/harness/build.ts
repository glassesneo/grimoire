// `bun build` cannot load the Solid JSX transform from the command line, so the
// executable is compiled through Bun.build with the OpenTUI Solid plugin.
import solidPlugin from "@opentui/solid/bun-plugin";
import pi from "./node_modules/@earendil-works/pi-coding-agent/package.json" with { type: "json" };
import harness from "./package.json" with { type: "json" };

/** The shipped executable's entrypoints: the CLI and the codemode worker pi starts from it. */
export const entrypoints = ["src/main.ts", "src/extensions/codemode/worker.ts"].map(
  (path) => `${import.meta.dir}/${path}`,
);

/**
 * Compile entrypoints into one executable with the harness's options; tests
 * compile probes the same way so they exercise what ships.
 */
export async function compile(
  entrypoints: string[],
  outfile: string,
): Promise<Awaited<ReturnType<typeof Bun.build>>> {
  return Bun.build({
    entrypoints,
    // Pi looks up the worker by its source path, not Bun's default output path.
    root: import.meta.dir,
    naming: { entry: "[dir]/[name].ts" },
    target: "bun",
    plugins: [solidPlugin],
    minify: true,
    // A compiled pi reads its own package.json beside the executable at run
    // time, so the version is fixed here instead.
    define: {
      HARNESS_VERSION: JSON.stringify(harness.version),
      PI_VERSION: JSON.stringify(pi.version),
    },
    // The executable runs in arbitrary project directories, whose Bun
    // configuration must not change it.
    compile: {
      outfile,
      autoloadBunfig: false,
      autoloadDotenv: false,
    },
  });
}

if (import.meta.main) {
  const result = await compile(entrypoints, `./${harness.name}`);
  if (!result.success) {
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }
}
