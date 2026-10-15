// Explicit isolated acceptance fixture, never loaded by quin --mock.
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
export default function (pi: ExtensionAPI) {
  const file = process.env.SHIELD_FIXTURE_PID;
  if (!file || !/^\/[a-zA-Z0-9_./-]+$/.test(file))
    throw new Error("isolated fixture PID file required");
  const faux = fauxProvider({ provider: "shield-faux", models: [{ id: "fixed" }] });
  pi.registerProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { command: `echo $$ > '${file}'; exec /bin/sleep 60` },
        { id: "bash-wait" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("Wait completed."),
  ]);
}
