import { connect } from "node:net";
import { createInterface } from "node:readline";
import { encode, type Response } from "./protocol.ts";

const usage = "usage: edith ask <message>\n       edith dev [--session <name>]";
const [command, ...words] = process.argv.slice(2);

if (command === "dev") {
  const { dev, UsageError } = await import("./dev.ts");
  try {
    await dev(words);
    process.exit(0);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(error.message);
    process.exit(2);
  }
}

const content = words.join(" ");
if (command !== "ask" || content === "") {
  console.error(usage);
  process.exit(2);
}

const socketPath = process.env["EDITH_SOCKET"];
if (socketPath === undefined || socketPath === "") {
  console.error("EDITH does not run resident on this host; `edith dev` runs it here");
  process.exit(1);
}

const socket = connect(socketPath);
socket.on("error", (error) => {
  console.error(`cannot reach EDITH at ${socketPath}: ${error.message}`);
  process.exit(1);
});
socket.write(encode({ type: "ask", address: "cli", content }));

let response: Response | undefined;
for await (const line of createInterface({ input: socket })) {
  response = JSON.parse(line) as Response;
  break;
}
socket.destroy();

if (response === undefined) {
  console.error("EDITH closed the connection without a response");
  process.exit(1);
}
if (response.type === "error") {
  console.error(response.message);
  process.exit(1);
}
console.log(response.text);
