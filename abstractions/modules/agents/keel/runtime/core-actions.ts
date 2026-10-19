/**
 * The actions keel itself provides, whatever extensions are loaded: editing
 * and sending drafts, answering requests, accepting assist candidates,
 * stopping and pausing, focus and stage navigation, and the screen's own
 * operations. Actions without `run` are carried out by the screen; they are
 * declared here so the key configuration and the class check know them.
 *
 * Global actions take no default keys. Where an operation is useful from
 * several regions, each region has its own action for it, sharing what it does.
 */
import type { ActionDefinition } from "../api";
import type { Region } from "../protocol/keys";
import { isRecord } from "../protocol/format";
import type { Runtime } from "./host";
import { Accepted, StoreError } from "./store";
import { PROMPT } from "../protocol/wire";

function field<T>(args: unknown, name: string, check: (value: unknown) => value is T): T {
  const value = isRecord(args) ? args[name] : undefined;
  if (!check(value)) throw new StoreError("invalid_arguments", `${name} is missing or invalid`);
  return value;
}
const isString = (value: unknown): value is string => typeof value === "string";
const isInteger = (value: unknown): value is number => Number.isInteger(value);

/** Screen actions for one operation in several regions. */
function perRegion(
  name: string,
  regions: readonly Region[],
  definition: Omit<ActionDefinition, "id">,
): ActionDefinition[] {
  return regions.map((region) => ({ ...definition, id: `${region}.${name}` }));
}

export function coreActions(runtime: Runtime): ActionDefinition[] {
  const { store, control } = runtime;
  return [
    {
      id: "draft.set",
      title: "Edit a draft",
      run: ({ args }) => ({
        revision: store.editDraft(
          field(args, "destination", isString),
          field(args, "text", isString),
          field(args, "base", isInteger),
        ),
      }),
    },
    {
      id: "editor.submit",
      title: "Send the prompt",
      keys: ["return", "kpenter"],
      run: async ({ args }) => {
        const destination = field(args, "destination", isString);
        if (destination !== PROMPT)
          throw new StoreError("invalid_arguments", "only the prompt is sent");
        return new Accepted({
          disposition: await control.submitPrompt(field(args, "revision", isInteger)),
        });
      },
    },
    {
      id: "request.answer",
      title: "Answer a request",
      run: ({ args }) => {
        store.answer(
          field(args, "request", isString),
          field(args, "value", isString),
          field(args, "revision", isInteger),
        );
        control.resumePaused();
      },
    },
    {
      id: "assist.accept",
      title: "Accept an assist candidate",
      // The candidate's own action is checked when it runs.
      class: "control",
      run: (invocation) => {
        const id = field(invocation.args, "assist", isString);
        const assist = store.assistInfo(id);
        if (!assist) throw new StoreError("unknown_assist");
        // The candidates must be the ones computed from the draft as it is now.
        const revision = field(invocation.args, "revision", isInteger);
        if (assist.revision !== revision || store.draft(assist.destination).revision !== revision)
          throw new StoreError("stale_revision", "the candidates are for an older draft");
        const candidateId = field(invocation.args, "candidate", isString);
        const candidate = assist.candidates.find((entry) => entry.id === candidateId);
        if (!candidate) throw new StoreError("unknown_candidate");
        return runtime.run(candidate.action.id, { ...invocation, args: candidate.action.args });
      },
    },
    {
      id: "global.stop",
      title: "Stop the run",
      class: "control",
      run: () => {
        void control
          .stop()
          .catch((error) => store.notice("error", `stop failed: ${String(error)}`));
        return new Accepted();
      },
    },
    { id: "global.pause", title: "Pause the run", class: "control", run: () => control.pause() },
    { id: "global.resume", title: "Resume the run", class: "control", run: () => control.resume() },

    // The screen arms stop on the first press and invokes global.stop on the second.
    ...perRegion("stop", ["editor", "timeline", "stage"], {
      class: "control",
      title: "Stop the run (press twice)",
      keys: ["ctrl+c"],
    }),
    ...perRegion("pause", ["editor", "timeline"], {
      class: "control",
      keys: ["alt+p"],
      run: () => control.pause(),
    }),
    ...perRegion("resume", ["editor", "timeline"], {
      class: "control",
      keys: ["alt+r"],
      run: () => control.resume(),
    }),
    { id: "screen.take_write", class: "control", title: "Take the write right" },
    ...perRegion("take_write", ["editor", "timeline"], { class: "control", keys: ["alt+w"] }),
    { id: "screen.detach", class: "view", title: "Close this screen" },
    ...perRegion("detach", ["editor", "timeline", "stage"], { class: "view", keys: ["ctrl+q"] }),
    ...perRegion("focus_next", ["editor", "timeline", "stage"], { class: "view", keys: ["tab"] }),
    ...perRegion("focus_previous", ["editor", "timeline", "stage"], {
      class: "view",
      keys: ["shift+tab"],
    }),
    { id: "editor.stage_next", class: "view", keys: ["alt+j"] },
    { id: "editor.stage_previous", class: "view", keys: ["alt+k"] },
    { id: "editor.stage_leave", class: "view", keys: ["escape"] },
    { id: "editor.candidate_next", class: "view", keys: ["ctrl+n"] },
    { id: "editor.candidate_previous", class: "view", keys: ["ctrl+p"] },
    { id: "stage.next", class: "view", keys: ["l", "right"] },
    { id: "stage.previous", class: "view", keys: ["h", "left"] },
    { id: "stage.leave", class: "view", keys: ["escape"] },
    { id: "stage.cursor_down", class: "view", keys: ["j", "down"] },
    { id: "stage.cursor_up", class: "view", keys: ["k", "up"] },
    // Answers the request or accepts the candidate the stage shows.
    { id: "stage.confirm", class: "control", keys: ["return", "kpenter"] },
  ];
}
