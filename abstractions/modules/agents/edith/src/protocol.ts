export type Request = { readonly type: "ask"; readonly address: string; readonly content: string };

export type Response =
  | { readonly type: "answer"; readonly text: string }
  | { readonly type: "error"; readonly message: string };

export function parseRequest(line: string): Request {
  const value: unknown = JSON.parse(line);
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "ask" &&
    "address" in value &&
    typeof value.address === "string" &&
    value.address !== "" &&
    "content" in value &&
    typeof value.content === "string" &&
    value.content !== ""
  ) {
    return { type: "ask", address: value.address, content: value.content };
  }
  throw new Error(
    'expected {type: "ask", address: <non-empty string>, content: <non-empty string>}',
  );
}

export function encode(message: Request | Response): string {
  return `${JSON.stringify(message)}\n`;
}
