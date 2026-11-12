{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  settings = {
    defaultProvider = "openai";
    defaultModel = "gpt-6.1-sol";
    defaultThinkingLevel = "medium";
    theme = "system";
    retry = {
      enabled = true;
      maxRetries = 3;
      baseDelayMs = 2000;
      provider = {
        maxRetries = 0;
        maxRetryDelayMs = 60000;
      };
    };
    compaction = {
      enabled = true;
      reserveTokens = 16384;
      keepRecentTokens = 20000;
    };
    defaultTools = ["+codemode"];
    codemode.mode = "only";
  };
  keybindings = {
    "tui.editor.deleteToLineEnd" = [];
    "tui.select.up" = ["up" "ctrl+p"];
    "tui.select.down" = ["down" "ctrl+n"];
    "tui.select.cancel" = ["escape" "ctrl+c"];
    "tui.editor.cursorUp" = ["up" "ctrl+p"];
    "tui.editor.cursorDown" = ["down" "ctrl+n"];
    "app.model.cycleForward" = [];
  };
  # Hjem and the bundle write the same settings; only the MCP selection differs.
  build = pkgs: servers:
    import ./package.nix {
      inherit lib pkgs keybindings servers;
      pi = myconfig.agents.packages.pi;
      settings = settings // {inherit (cfg) extensions;};
    };
in {
  name = "pi";
  tests.fixture = ["agents" "exclusive" "mcp"];
  meta.description = "Configure Pi for Hjem and publish a standalone configured Pi.";

  options = with delib; {
    enable = boolOption true;
    extensions = mylib.accumulatingOption (listOfOption lib.types.str [] "Absolute paths of the extension entries Pi loads. Features add their entries; the published bundle has only the modules' entries.");
    mcpServers = listOfOption lib.types.str [] "Names of registered MCP servers Pi starts through Hjem. An unknown name is rejected, and registering a server does not select it. A standalone bundle can use native project MCP configuration.";
    sdkTypes = readOnly (lib.mkOption {
      type = lib.types.path;
      default = ./types;
      # The store path changes with every repository change.
      defaultText = lib.literalExpression "./types";
      description = "Bun project whose SDK types match `agents.packages.pi`, for checking Pi features' TypeScript.";
    });
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    servers =
      lib.mapAttrs (_: spec: {
        inherit (spec) command args env;
        exposure = "direct";
      })
      config.mcp.selected.pi;
    files = (build pkgs servers).config;
  in {
    mcp.selections.pi = cfg.mcpServers;
    packages = [myconfig.agents.packages.pi];
    files = lib.genAttrs [".pi/agent/settings.json" ".pi/agent/keybindings.json" ".pi/agent/mcp.json"] (name: {
      exclusive = true;
      source = "${files}/${baseNameOf name}";
    });
  };

  # The bundle's writable agent directory defaults to $XDG_STATE_HOME/grimoire/pi, or
  # ~/.local/state/grimoire/pi; PI_CODING_AGENT_DIR overrides it. Existing unmanaged
  # configuration is not replaced.
  bundles.ifEnabled = {pkgs, ...}: {
    pi = {
      inherit (build pkgs {}) package;
      publish = true;
    };
  };

  tests.cases = {
    home,
    lib,
    pkgs,
    typescriptCheck,
    ...
  }: let
    targets = result: lib.sort lib.lessThan (map (file: lib.removePrefix home file.target) result.manifest.files);
    file = result: suffix: lib.findFirst (entry: lib.hasSuffix suffix entry.target) (throw "missing ${suffix}") result.manifest.files;
  in {
    disabled-writes-nothing = {
      protects = "a disabled Pi module writes none of its settings files";
      host.myconfig.ifEnabled.pi.enable = false;
      expr = targets;
      expected = [];
    };
    enabled-is-the-only-writer = {
      protects = "Pi alone writes settings.json, keybindings.json, and mcp.json";
      uses = ["pi.question" "pi.input" "pi.compaction"];
      expr = targets;
      expected = ["/.pi/agent/keybindings.json" "/.pi/agent/mcp.json" "/.pi/agent/settings.json"];
    };
    extension-contributions = {
      protects = "Pi writes every feature's and the host's extension entries to settings.json; a host entry does not replace a feature's";
      modules.example.myconfig.always.pi.extensions = ["/synthetic/module.ts"];
      host.myconfig.ifEnabled.pi.extensions = ["/synthetic/host.ts"];
      build = result:
        pkgs.runCommand "pi-extensions" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.extensions as $e | ["/synthetic/module.ts", "/synthetic/host.ts"] | all(. as $x | $e | index($x) != null)' ${(file result "settings.json").source}
          touch "$out"
        '';
    };
    registration-does-not-select-a-server = {
      protects = "registering an MCP server does not add it to Pi until Pi selects its name";
      uses = ["web"];
      host.myconfig.ifEnabled = {
        web.enable = true;
      };
      build = result:
        pkgs.runCommand "pi-mcp-unselected" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.mcpServers == {}' ${(file result "mcp.json").source}
          touch "$out"
        '';
    };
    selected-server-is-direct = {
      protects = "a selected registry server reaches Pi with its command, arguments and environment";
      host.myconfig.ifEnabled = {
        pi.mcpServers = ["example"];
      };
      modules.example.hjem.always.mcp.servers.example = {
        command = "/synthetic/bin/server";
        args = ["--stdio"];
        env.CONFIG = "/runtime/config";
      };
      build = result:
        pkgs.runCommand "pi-mcp-selected" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.mcpServers.example == {command:"/synthetic/bin/server",args:["--stdio"],env:{CONFIG:"/runtime/config"},exposure:"direct"}' ${(file result "mcp.json").source}
          touch "$out"
        '';
    };
    standalone-configuration = {
      protects = "the published Pi starts without Hjem, loads registered extensions, preserves writable state and refuses unmanaged configuration";
      moduleSystem = "bundles";
      uses = ["pi.question" "pi.input" "pi.compaction"];
      modules.example.myconfig.always.pi.extensions = [
        (toString (pkgs.writeText "bundle-extension.ts" ''
          export default function () { console.log("bundle extension loaded"); }
        ''))
      ];
      build = result:
        pkgs.runCommand "pi-standalone" {nativeBuildInputs = [pkgs.jq];} ''
          export HOME=$TMPDIR/home XDG_STATE_HOME=$TMPDIR/state PI_OFFLINE=1 PI_TELEMETRY=0
          mkdir -p "$HOME"
          ${lib.getExe result.packages.pi} --offline --no-session --no-context-files --no-skills --help > startup.log 2>&1
          if grep -q 'Failed to load extension' startup.log; then cat startup.log; exit 1; fi
          agent="$XDG_STATE_HOME/grimoire/pi"
          grep -Fx 'bundle extension loaded' startup.log
          printf '%s\n' '{"synthetic":"runtime state"}' > "$agent/auth.json"
          ${lib.getExe result.packages.pi} --offline --no-session --no-context-files --no-skills --help > /dev/null
          jq -e '.synthetic == "runtime state"' "$agent/auth.json"
          export PI_CODING_AGENT_DIR=$TMPDIR/custom
          mkdir -p "$PI_CODING_AGENT_DIR"
          printf '%s\n' '{"unmanaged":true}' > "$PI_CODING_AGENT_DIR/settings.json"
          if ${lib.getExe result.packages.pi} --help > refusal.log 2>&1; then exit 1; fi
          jq -e '.unmanaged == true' "$PI_CODING_AGENT_DIR/settings.json"
          touch "$out"
        '';
    };
    sdk-matches-pinned-pi = {
      protects = "features are type-checked against the SDK version of the Pi that loads them";
      expr = result: let
        sdk = lib.filterAttrs (name: _: lib.hasPrefix "@earendil-works/" name) (lib.importJSON ./types/package.json).devDependencies;
      in
        lib.unique (builtins.attrValues sdk) == [result.options.myconfig.agents.packages.value.pi.version];
      expected = true;
    };
    type-errors-fail-the-check = {
      protects = "a Pi feature's TypeScript check against the SDK types fails on a type error";
      build = result: let
        failure = pkgs.testers.testBuildFailure (typescriptCheck {
          name = "synthetic";
          src = pkgs.writeTextDir "wrong.ts" "export const value: number = \"text\";\n";
          types = result.options.myconfig.pi.sdkTypes.value;
        });
      in
        pkgs.runCommand "pi-typescript-rejects" {} ''
          grep -q TS2322 ${failure}/testBuildFailure.log
          touch "$out"
        '';
    };
    disabled-publishes-nothing = {
      protects = "a disabled Pi module publishes no bundle";
      moduleSystem = "bundles";
      host.myconfig.ifEnabled.pi.enable = false;
      expr = result: result.packages ? pi;
      expected = false;
    };
  };
})
