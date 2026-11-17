// An MCP server's tools as one pi-durable extension, named `mcp:<server>`, so a profile
// enables a server as a whole. The tools are callable only by other tools: under code mode,
// scripts call them and the model never sees them directly.
import { defineExtension, defineTool, type Extension } from "@earendil-works/pi-durable";
import {
  createMcpToolName,
  limitMcpContent,
  McpClient,
  normalizeMcpInputSchema,
  StdioTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";

export type ServerConfig = {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
};

export type Server = {
  readonly extension: Extension;
  close(): Promise<void>;
};

export function serverExtensionName(server: string): string {
  return `mcp:${server}`;
}

export async function connectServer(name: string, config: ServerConfig): Promise<Server> {
  // The server gets only its declared environment, not EDITH's provider keys.
  const transport = new StdioTransport({
    command: config.command,
    args: config.args,
    env: { ...config.env },
    inheritEnv: false,
    stderr: "pipe",
    onStderr: (chunk) => console.error(`mcp ${name}: ${chunk.trimEnd()}`),
  });
  const client = new McpClient({ name: "edith", version: "1" });
  await client.connect(transport);
  const tools = (await client.listTools()).map((tool) =>
    defineTool({
      name: createMcpToolName(name, tool.name),
      description: tool.description ?? tool.name,
      parameters: normalizeMcpInputSchema(tool.inputSchema),
      callers: ["tools"],
      async execute(args, _api, context) {
        const result = await client.callTool(tool.name, args as Record<string, unknown>, {
          ...(context.abortSignal && { signal: context.abortSignal }),
        });
        const { content } = await limitMcpContent(toLlmContent(result));
        return { output: content, isError: result.isError === true };
      },
    }),
  );
  return {
    extension: defineExtension({ name: serverExtensionName(name), tools }),
    close: () => client.close(),
  };
}
