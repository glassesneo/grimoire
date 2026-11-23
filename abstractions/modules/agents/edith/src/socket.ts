// Serves clients in other processes on a Unix socket; the daemon stays the storage's only writer.
import { rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import type { Context } from "@earendil-works/chord/context";
import type { Edith } from "./core.ts";
import { encode, parseRequest, type Response } from "./protocol.ts";

async function serve(edith: Edith, socket: Socket, context: Context): Promise<void> {
  const lines = createInterface({ input: socket });
  let response: Response = { type: "error", message: "connection closed before a request" };
  try {
    for await (const line of lines) {
      const request = parseRequest(line);
      const answer = await edith.ask(request.address, request.content, context);
      response =
        answer.status === "done"
          ? { type: "answer", text: answer.text }
          : {
              type: "error",
              message: answer.status === "stopped" ? "stopped" : `unanswered: ${answer.reason}`,
            };
      break;
    }
  } catch (error) {
    response = { type: "error", message: error instanceof Error ? error.message : String(error) };
  }
  lines.close();
  socket.end(encode(response));
}

export function listen(edith: Edith, path: string, context: Context): Server {
  // A socket left by an earlier process would make listen fail.
  rmSync(path, { force: true });
  const server = createServer({ allowHalfOpen: true }, (socket) => {
    socket.on("error", (error) => console.error("socket client:", error.message));
    void serve(edith, socket, context);
  });
  server.listen(path);
  return server;
}
