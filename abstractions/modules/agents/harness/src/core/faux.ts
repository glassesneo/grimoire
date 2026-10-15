/**
 * Drives real sessions with pi's faux provider, so tests exercise the session,
 * its extensions, and the screen without a model or credentials.
 */
import {
  type FauxProviderHandle,
  type FauxResponseStep,
  fauxProvider,
  type ImageContent,
  type TextContent,
} from "@earendil-works/pi-ai";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { SessionCustomization } from "./session";

export interface ToolResult {
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  details?: unknown;
}

export interface FauxSessionOptions {
  /** Replies in request order; a request with none left fails. */
  responses: FauxResponseStep[];
  /** Streaming speed; omitted, replies arrive at once. */
  tokensPerSecond?: number;
  /**
   * Results returned instead of running tools, by tool call id. When given, no
   * tool runs, and a call without a result fails as a tool error.
   */
  toolResults?: Record<string, ToolResult>;
}

export const FAUX_PROVIDER = "faux";
export const FAUX_MODEL = "faux";

export function createFauxSession(options: FauxSessionOptions): {
  faux: FauxProviderHandle;
  customization: SessionCustomization;
} {
  const faux = fauxProvider({
    provider: FAUX_PROVIDER,
    models: [{ id: FAUX_MODEL, name: "Faux", reasoning: true }],
    tokensPerSecond: options.tokensPerSecond,
  });
  faux.setResponses(options.responses);
  const { toolResults } = options;
  return {
    faux,
    customization: {
      prepare(services) {
        services.modelRuntime.registerNativeProvider(faux.provider);
        return services.modelRuntime.getModel(FAUX_PROVIDER, FAUX_MODEL);
      },
      onSession(session) {
        if (toolResults) substituteTools(session, toolResults);
      },
    },
  };
}

/**
 * pi assigns the agent's tools whenever the loadout changes, and every run reads
 * them from there, so wrapping the assignment covers each run. Calls a tool
 * makes through `ctx.executeTool()` are not covered; they do not happen while
 * their caller is substituted.
 */
function substituteTools(session: AgentSession, results: Record<string, ToolResult>): void {
  type Tool = (typeof session.agent.state.tools)[number];
  const state = session.agent.state;
  const descriptor = Object.getOwnPropertyDescriptor(state, "tools");
  if (!descriptor?.get || !descriptor.set)
    throw new Error("pi's agent state no longer exposes a tools accessor");
  // `get` is reinstalled as the same object's getter and `set` is called on it, so both keep `state` as `this`.
  // oxlint-disable-next-line typescript/unbound-method
  const { get, set } = descriptor;
  const wrap = (tools: Tool[]): Tool[] =>
    tools.map(
      (tool) =>
        ({
          ...tool,
          execute: async (toolCallId: string) => {
            const result = results[toolCallId];
            if (!result)
              throw new Error(`No result is given for tool call ${toolCallId} (${tool.name})`);
            if (result.isError)
              throw new Error(
                result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"),
              );
            return { content: result.content, details: result.details ?? {} };
          },
        }) as Tool,
    );
  Object.defineProperty(state, "tools", {
    configurable: true,
    enumerable: true,
    get,
    set: (tools: Tool[]) => set.call(state, wrap(tools)),
  });
  state.tools = get.call(state);
}
