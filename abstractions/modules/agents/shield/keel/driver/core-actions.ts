/**
 * The actions the driver itself provides, whatever extensions are loaded: stopping, pausing,
 * and resuming the run, which only the driver's control of Pi can do. keel's model declares
 * its own actions (drafts, sending, answering, accepting candidates) and the screen's
 * (focus, the stage, the write right, closing).
 *
 * Global actions take no default keys. Where an operation is useful from several regions,
 * each region has its own action for it, sharing what it does.
 */
import type { ActionDefinition } from "../api";
import type { Control } from "./control";
import type { NoticeLevel } from "../protocol/items";
import { Accepted } from "./outcome";

export function coreActions(
  control: Control,
  notice: (level: NoticeLevel, text: string) => void,
): ActionDefinition[] {
  const pause = () => control.pause();
  const resume = () => control.resume();
  return [
    {
      id: "global.stop",
      title: "Stop the run",
      class: "control",
      run: () => {
        void control.stop().catch((error) => notice("error", `stop failed: ${String(error)}`));
        return new Accepted();
      },
    },
    { id: "global.pause", title: "Pause the run", class: "control", run: pause },
    { id: "global.resume", title: "Resume the run", class: "control", run: resume },
    ...(["editor", "timeline"] as const).flatMap((region): ActionDefinition[] => [
      { id: `${region}.pause`, class: "control", keys: ["alt+p"], run: pause },
      { id: `${region}.resume`, class: "control", keys: ["alt+r"], run: resume },
    ]),
  ];
}
