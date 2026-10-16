// Node keeps Pi's public storage APIs outside quin's bundle; discovery never opens or repairs a session.
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import {
  SessionManager,
  parseSessionEntries,
  buildSessionContext,
} from "@earendil-works/pi-coding-agent";

function fail(category, message) {
  throw new Error(`${category}: ${message}`);
}

async function contained(root, path) {
  const canonical = await realpath(path);
  const rel = relative(root, canonical);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    fail("outside_root", "session must be inside SHIELD's sessions directory");
  return canonical;
}

async function metadata(root, path) {
  path = await contained(root, path);
  if (!(await stat(path)).isFile()) fail("invalid_session", "not a file");
  const entries = parseSessionEntries(await readFile(path, "utf8"));
  const header = entries[0];
  if (header?.type !== "session" || typeof header.cwd !== "string" || !isAbsolute(header.cwd))
    fail("invalid_header", "session requires a saved cwd");
  if (
    typeof header.id !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(header.id)
  )
    fail("invalid_header", "session requires a valid ID");
  const { model } = buildSessionContext(entries.filter((e) => e.type !== "session"));
  return {
    path,
    id: header.id,
    cwd: header.cwd,
    ...(model ? { model: `${model.provider}/${model.modelId}` } : {}),
  };
}

async function main() {
  const [directory, specifier, cwd] = process.argv.slice(2);
  if (!directory || !specifier || !cwd) fail("usage", "expected sessions-root specifier cwd");
  let root;
  try {
    root = await realpath(directory);
  } catch (error) {
    if (error.code === "ENOENT") fail("not_found", "no SHIELD sessions directory");
    throw error;
  }
  if (isAbsolute(specifier) || specifier.includes("/") || specifier.endsWith(".jsonl"))
    return metadata(root, resolve(cwd, specifier));
  const candidates = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = await contained(root, resolve(root, entry.name));
    // Pi's listing API follows links without a filter, so fail closed before it
    // can read outside SHIELD, even if the link is unrelated to the requested ID.
    for (const file of await readdir(dir)) {
      if (file.endsWith(".jsonl")) await contained(root, resolve(dir, file));
    }
    for (const info of await SessionManager.listAll(dir)) {
      if (typeof info.id === "string" && info.id.startsWith(specifier)) candidates.push(info);
    }
  }
  const exact = candidates.filter((info) => info.id === specifier);
  const matches = exact.length ? exact : candidates;
  if (!matches.length) fail("not_found", "no matching SHIELD session");
  if (matches.length !== 1) fail("ambiguous", "use a unique session ID or path");
  return metadata(root, matches[0].path);
}

main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
