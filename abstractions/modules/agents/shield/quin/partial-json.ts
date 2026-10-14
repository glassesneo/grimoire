/**
 * The value a streamed, still incomplete JSON text has so far, as pi-ai's
 * `parseStreamingJson` gives the harness: open strings, arrays, and objects
 * are closed, and an unfinished key, literal, or trailing separator is
 * dropped. Undefined when nothing complete has arrived.
 */
export function parsePartialJson(text: string): unknown {
  // Structural positions outside strings, where a shorter prefix can be closed.
  const cuts: number[] = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[" || c === ",") cuts.push(i);
  }
  for (let prefix = text; ; ) {
    const value = closed(prefix);
    if (value !== undefined) return value;
    const cut = cuts.pop();
    if (cut === undefined) return undefined;
    // An opening bracket stays, so the value is at least empty; a separator goes.
    prefix = text.slice(0, text[cut] === "," ? cut : cut + 1);
  }
}

/** The prefix with its open string and brackets closed, if that parses. */
function closed(prefix: string): unknown {
  const open: string[] = [];
  let inString = false;
  let escaped = false;
  for (const c of prefix) {
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") open.push("}");
    else if (c === "[") open.push("]");
    else if (c === "}" || c === "]") open.pop();
  }
  let text = prefix;
  if (inString) text = (escaped ? text.slice(0, -1) : text) + '"';
  text = text.replace(/[\s,:]+$/, "") + open.reverse().join("");
  try { return JSON.parse(text); } catch { return undefined; }
}
