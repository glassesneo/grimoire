import solidPlugin from "@opentui/solid/bun-plugin";
for (const [entry, outfile] of [["./main.tsx", "quin"], ["../client/shield.ts", "shield"]]) {
  const result = await Bun.build({ entrypoints: [entry!], target: "bun", plugins: [solidPlugin], minify: true, compile: { outfile: outfile!, autoloadBunfig: false, autoloadDotenv: false } });
  if (!result.success) { for (const log of result.logs) console.error(log); process.exit(1); }
}
