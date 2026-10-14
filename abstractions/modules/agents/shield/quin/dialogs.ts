/**
 * Pi's pending dialogs, as the hub reports them, become local requests: select
 * and confirm become stage requests, input and editor become editor drafts.
 * The hub owns each dialog and accepts its first valid reply from any UI, so a
 * dialog that leaves the view closes its local request without replying.
 */
import type { JSX } from "@opentui/solid";
import type { Controller } from "./controller";
import type { StageContentType } from "./ui/controllers";
import type { QuinUIInstance } from "./ui/quin-ui";
import type { ChoiceValue } from "./ui/stage";

export function bridgeDialogs(options: {
  controller: Controller;
  ui: QuinUIInstance<JSX.Element>;
  choiceType: StageContentType<ChoiceValue, JSX.Element>;
  confirmType: StageContentType<ChoiceValue, JSX.Element>;
}): () => void {
  const { controller, ui } = options;
  const open = new Map<string, AbortController>();

  const present = async (id: string, d: any, signal: AbortSignal): Promise<Record<string, unknown> | undefined> => {
    if (d.method === "select" || d.method === "confirm") {
      const confirm = d.method === "confirm";
      const choices = confirm ? ["Yes", "No"] : d.options || [];
      const value: ChoiceValue = { title: d.title, message: d.message, choices, cursor: 0, expiresAt: d.expiresAt };
      const handle = ui.stage.show({
        requester: "pi", type: confirm ? options.confirmType : options.choiceType, value, signal,
        preferredHeight: choices.length + 1 + (d.message ? 1 : 0) + (d.expiresAt ? 1 : 0),
      });
      const result = await handle.closed;
      if (result.status !== "closed") return { cancelled: true };
      return confirm ? { confirmed: result.value.result === "Yes" } : { value: result.value.result };
    }
    const title = d.placeholder ? `${d.title} (${d.placeholder})` : d.title;
    const result = await ui.editor.openDraft({
      destination: `dialog:${id}`, label: `${d.method}: ${title}`, requester: ui.controllers.regions.current(),
      initialText: d.prefill, fresh: true, signal,
    });
    return result.status === "submitted" ? { value: result.text } : { cancelled: true };
  };

  const sync = () => {
    const dialogs = controller.adapter.view.dialogs;
    for (const [id, abort] of open) {
      if (!(id in dialogs)) {
        open.delete(id);
        abort.abort();
      }
    }
    for (const [id, d] of Object.entries(dialogs)) {
      if (open.has(id) || !["select", "confirm", "input", "editor"].includes(d.method)) continue;
      const abort = new AbortController();
      open.set(id, abort);
      void present(id, d, abort.signal).then(reply => {
        // Closed by the hub: another UI answered, it timed out, or Pi went away.
        if (abort.signal.aborted || !reply) return;
        return controller.replyDialog(id, reply);
      });
    }
  };
  sync();
  const unsubscribe = controller.subscribe(sync);
  return () => {
    unsubscribe();
    for (const abort of open.values()) abort.abort();
    open.clear();
  };
}
