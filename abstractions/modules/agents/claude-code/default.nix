{
  delib,
  lib,
  mylib,
  ...
}: let
  # Claude Code has no port; its ANSI themes take the terminal's colors, which
  # follow the scheme, so the table only states whether a scheme is dark.
  themes = mylib.schemeThemes {
    name = "claude-code";
    themes.rose-pine = "dark-ansi";
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "claude-code";
    tests.fixture = ["agents" "colorscheme" "exclusive" "mcp" "skills"];
    meta.description = "Provide and configure Claude Code.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether Claude Code takes its theme from `colorscheme.resolved`.";
      mcpServers = listOfOption lib.types.str [] "Names of registered MCP servers the Claude wrapper passes. An unknown name is rejected, and an empty selection leaves the original package unchanged.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

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
      # The wrapper name is claude, so it precedes the package's own binary.
      # --mcp-config merges with the user's existing configuration. It takes
      # several values, so the separate form would also consume a prompt.
      wrapper = pkgs.writeShellScriptBin "claude" ''
        exec ${lib.getExe myconfig.agents.packages.claude-code} --mcp-config=${mcpConfig} "$@"
      '';
      # Development shells put GNU sed first, while the agent writes sed for
      # the platform it runs on; on Darwin that is BSD sed. Only sed is
      # exposed, not the other commands bundled with Apple's text_cmds.
      bsdSed = pkgs.linkFarm "agent-bsd-sed" {"bin/sed" = lib.getExe' pkgs.darwin.text_cmds "sed";};
      runtimePath = lib.makeBinPath ([pkgs.python3] ++ lib.optional pkgs.stdenv.hostPlatform.isDarwin bsdSed);
      # Claude Code sources $CLAUDE_ENV_FILE before each Bash tool command,
      # after the shell profile, so these tools precede any inherited PATH.
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
          autoMemoryEnabled = false;
          tui = "fullscreen";
          disableClaudeAiConnectors = true;
          permissions.defaultMode = "auto";
          sandbox = {
            enabled = true;
            autoAllowBashIfSandboxed = true;
            # nix keeps its evaluation and fetcher caches here as SQLite databases,
            # and treefmt, run by `nix fmt` and commit hooks, keeps its cache beside them.
            filesystem.allowWrite = ["~/.cache/nix" "~/.cache/treefmt"];
            # nix commands talk to the daemon instead of opening the store themselves.
            network.allowUnixSockets = ["/nix/var/nix/daemon-socket/socket"];
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
          };
        }
        // lib.optionalAttrs (theme != null) {inherit theme;};

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
              # Ctrl-J and Ctrl-L switch SKK input modes.
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
          # The real binary is replaced by a stub that records the argv it receives.
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
