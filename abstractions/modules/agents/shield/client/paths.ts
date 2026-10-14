import { lstatSync, mkdirSync, chmodSync, realpathSync, openSync, closeSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, parse } from "node:path";

export const stateDirectory = () => join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "shield");
export const configDirectory = () => join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "shield/pi");
export const defaultSocket = () => join(stateDirectory(), "hub.sock");
export function socketPath(value = defaultSocket()) {
  if (!isAbsolute(value)) throw new Error("--socket requires an absolute path");
  if (Buffer.byteLength(value) > 100) throw new Error("socket path too long (Darwin Unix socket limit)");
  return value;
}

// Cooperative same-user boundary: refuse links/unowned paths, never replace the stable lock inode.
export function privateDirectory(path: string) {
  path = resolve(path);
  let current = parse(path).root;
  for (const part of path.slice(current.length).split("/")) {
    current = join(current, part);
    try {
      const stat = lstatSync(current);
      // /tmp and /var are OS-owned symlinks on Darwin; canonicalize ancestors,
      // but never permit the final managed directory to be a link.
      if (stat.isSymbolicLink()) {
        if (current === path || stat.uid !== 0 || !["/tmp", "/var", "/etc"].includes(current)) throw new Error(`unsafe directory: ${current}`);
        current = realpathSync(current);
      } else if (!stat.isDirectory()) throw new Error(`not a directory: ${current}`);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
      mkdirSync(current, { mode: 0o700 });
    }
  }
  const stat = lstatSync(path);
  if (stat.uid !== process.getuid?.() || !stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`unsafe directory owner/type: ${path}`);
  chmodSync(path, 0o700);
}
export function managedFile(path: string, kind: "file" | "socket") {
  try {
    const stat = lstatSync(path);
    if (stat.uid !== process.getuid?.() || stat.isSymbolicLink() || (kind === "file" ? !stat.isFile() : !stat.isSocket())) throw new Error(`unsafe ${kind}: ${path}`);
    if ((stat.mode & 0o077) !== 0) throw new Error(`unsafe permissions: ${path}`);
  } catch (e: any) { if (e.code !== "ENOENT") throw e; }
}
export function prepareSocket(path: string) {
  privateDirectory(dirname(path));
  managedFile(path, "socket");
  managedFile(`${path}.lock`, "file");
  const fd = openSync(`${path}.lock`, constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  closeSync(fd);
  managedFile(`${path}.log`, "file");
}
