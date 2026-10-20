/**
 * A command input: the `command` assist, whose draft is a command name and
 * its argument. Without a space its candidates are the assists by name, and
 * accepting one writes the name into the draft; after the name, the named
 * assist's candidates for the argument are offered, and accepting one runs
 * that candidate's own action, checked as that action. Opening the input only
 * selects the assist on the screen.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keel } from "../api";
import { isRecord } from "../protocol/format";
import { assistDestination, type Candidate } from "../protocol/wire";

const COMMAND = "command";

export default function commands(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    const k = keel(ctx);
    k.actions.register([
      // The screen selects the command assist and focuses the editor.
      {
        id: "editor.command_open",
        class: "view",
        title: "Open the command input",
        keys: ["ctrl+g"],
      },
      { id: "timeline.command_open", class: "view", title: "Open the command input", keys: [":"] },
      {
        id: "command.complete",
        title: "Write a command name into the command input",
        run: ({ args }) => {
          const name = isRecord(args) && typeof args.name === "string" ? args.name : undefined;
          if (!name || !k.assists.list().includes(name)) throw new Error(`unknown command ${name}`);
          k.drafts.set(assistDestination(COMMAND), `${name} `);
        },
      },
    ]);
    k.assists.register({
      id: COMMAND,
      title: "Command",
      candidates: async (text) => {
        const space = text.indexOf(" ");
        const names = k.assists.list().filter((id) => id !== COMMAND);
        if (space === -1) {
          const query = text.trim().toLowerCase();
          return names
            .filter((id) => id.startsWith(query))
            .map((id): Candidate => ({
              id: `name:${id}`,
              label: id,
              action: { id: "command.complete", args: { name: id } },
            }));
        }
        const name = text.slice(0, space);
        if (!names.includes(name)) return [];
        const candidates = await k.assists.query(name, text.slice(space + 1));
        return candidates.map((candidate) => ({ ...candidate, id: `${name}:${candidate.id}` }));
      },
    });
  });
}
