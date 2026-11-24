{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "claude-code";
  tests.fixture = ["agents" "exclusive" "mcp" "skills"];
  meta.description = "Provide and configure Claude Code.";

  options = with delib; {
    enable = boolOption true;
    unattended = boolOption false "Run every tool call without permission prompts or the Bash sandbox, and disable auto mode.";
    mcpServers = listOfOption lib.types.str [] "Names of registered MCP servers the Claude wrapper passes. An unknown name is rejected, and an empty selection leaves the original package unchanged.";
  };

  hjem.always = {pkgs, ...}: {
    options.claude-code.settings = lib.mkOption {
      inherit (pkgs.formats.json {}) type;
      default = {};
      description = "Settings written to the user's Claude Code settings file.";
    };
  };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    resolved = config.mcp.selected.claude-code;
    mcpConfig = pkgs.writeText "claude-mcp.json" (builtins.toJSON {
      mcpServers = lib.mapAttrs (_: spec: {inherit (spec) command args env;}) resolved;
    });
    wrapper = pkgs.writeShellScriptBin "claude" ''
      exec ${lib.getExe myconfig.agents.packages.claude-code} --mcp-config=${mcpConfig} "$@"
    '';
    bsdSed = pkgs.linkFarm "agent-bsd-sed" {"bin/sed" = lib.getExe' pkgs.darwin.text_cmds "sed";};
    runtimePath = lib.makeBinPath ([pkgs.python3] ++ lib.optional pkgs.stdenv.hostPlatform.isDarwin bsdSed);
    runtimeTools = pkgs.writeShellScript "claude-code-runtime-tools" ''
      [ -n "''${CLAUDE_ENV_FILE:-}" ] || exit 0
      printf 'export PATH=%s:"$PATH"\n' ${lib.escapeShellArg runtimePath} >> "$CLAUDE_ENV_FILE"
    '';
  in {
    packages =
      if resolved == {}
      then [myconfig.agents.packages.claude-code]
      else [wrapper];
    mcp.selections.claude-code = cfg.mcpServers;
    skillDirs = [".claude/skills"];

    claude-code.settings =
      {
        "$schema" = "https://json.schemastore.org/claude-code-settings.json";
        model = "claude-opus-5-5";
        effortLevel = "medium";
        autoMemoryEnabled = false;
        tui = "fullscreen";
        disableClaudeAiConnectors = true;
        permissions.defaultMode =
          if cfg.unattended
          then "bypassPermissions"
          else "auto";
        sandbox = {
          enabled = !cfg.unattended;
          autoAllowBashIfSandboxed = true;
          filesystem.allowWrite = ["~/.cache/nix" "~/.cache/treefmt"];
          network = {
            allowUnixSockets = ["/nix/var/nix/daemon-socket/socket"];
            allowLocalBinding = true;
          };
        };
        hooks.SessionStart = [
          {
            hooks = [
              {
                type = "command";
                command = "${runtimeTools}";
              }
            ];
          }
        ];
        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = "true";
          CLAUDE_CODE_EXPERIMENTAL_CODE_MODE = "1";
        };
      }
      // lib.optionalAttrs cfg.unattended {
        disableAutoMode = "disable";
        skipDangerousModePermissionPrompt = true;
      };

    files.".claude/settings.json" = {
      exclusive = true;
      generator = lib.generators.toJSON {};
      value = config.claude-code.settings;
    };

    files.".claude/keybindings.json" = {
      exclusive = true;
      generator = lib.generators.toJSON {};
      value = {
        "$schema" = "https://www.schemastore.org/claude-code-keybindings.json";
        bindings = [
          {
            context = "Chat";
            bindings = {
              "ctrl+j" = null;
              "ctrl+l" = null;
            };
          }
        ];
      };
    };
  };

  tests.cases = {
    lib,
    pkgs,
    ...
  }: {
    empty-selection-keeps-the-package = {
      protects = "an empty MCP selection keeps the Claude Code package and does not add a wrapper";
      expr = result: result.packages == [(toString result.options.myconfig.agents.packages.value.claude-code)];
      expected = true;
    };
    wrapper-passes-mcp-config = {
      protects = "the wrapper passes a selected server as one --mcp-config argument, without --strict-mcp-config, and keeps the caller's prompt and options as separate arguments";
      modules.example.hjem.always.mcp.servers.example = {
        command = "/bin/echo";
        args = ["mcp"];
      };
      host.myconfig.ifEnabled.claude-code.mcpServers = ["example"];
      build = result: let
        claude = lib.findFirst (path: lib.hasSuffix "-claude" (baseNameOf path)) (throw "missing wrapper") result.packages;
        real = lib.getExe result.options.myconfig.agents.packages.value.claude-code;
      in
        pkgs.runCommand "claude-wrapper" {nativeBuildInputs = [pkgs.jq];} ''
          printf '#!${pkgs.runtimeShell}\nprintf "%%s\\n" "$@"\n' > stub
          chmod +x stub
          substitute ${claude}/bin/claude wrapper --replace-fail ${real} "$PWD/stub"
          ${pkgs.runtimeShell} wrapper 'SYNTHETIC PROMPT' --model synthetic > argv
          test "$(wc -l < argv)" -eq 4
          config=$(sed -n 1p argv)
          case "$config" in --mcp-config=/*) ;; *) cat argv; exit 1 ;; esac
          jq -e '.mcpServers.example == {command:"/bin/echo",args:["mcp"],env:{}}' "''${config#--mcp-config=}"
          test "$(sed -n 2p argv)" = 'SYNTHETIC PROMPT'
          test "$(sed -n 3,4p argv)" = "$(printf '%s\n' --model synthetic)"
          touch "$out"
        '';
    };
  };
})
