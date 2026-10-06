// pi's own Bun executable runs this setup in its entry (dist/bun/runtime-setup.js),
// which SDK hosts do not import.
import { bedrockProviderModule } from "@earendil-works/pi-ai/bedrock-provider";
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth";
import { setBedrockProviderModule } from "@earendil-works/pi-ai/compat";
// @ts-expect-error Bun's file loader supplies a path; the package has no WASM declaration.
import quickjsWasmPath from "quickjs-wasi/quickjs.wasm" with { type: "file" };
// Pi 1.0.2 exports this setter from config.js, but not its package entrypoint.
import { setEmbeddedQuickJSWasmPath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/config.js";

// As in pi's entry: warnings go straight to stderr, which corrupts the full-screen TUI.
process.emitWarning = () => {};
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
setEmbeddedQuickJSWasmPath(quickjsWasmPath);
