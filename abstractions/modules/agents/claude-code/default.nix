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
    tests.fixture = ["exclusive" "skills"];
    meta.description = "Provide and configure Claude Code.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether Claude Code takes its theme from `colorscheme.resolved`.";
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
      # Development shells put GNU sed first, while the agent writes sed for
      # the platform it runs on; on Darwin that is BSD sed. Only sed is
      # exposed, not the other commands bundled with Apple's text_cmds.
      bsdSed = pkgs.runCommand "agent-bsd-sed" {} ''
        mkdir -p "$out/bin"
        ln -s ${lib.getExe' pkgs.darwin.text_cmds "sed"} "$out/bin/sed"
      '';
      runtimePath = lib.makeBinPath ([pkgs.python3] ++ lib.optional pkgs.stdenv.hostPlatform.isDarwin bsdSed);
      # Claude Code sources $CLAUDE_ENV_FILE before each Bash tool command,
      # after the shell profile, so these tools precede any inherited PATH.
      runtimeTools = pkgs.writeShellScript "claude-code-runtime-tools" ''
        [ -n "''${CLAUDE_ENV_FILE:-}" ] || exit 0
        printf 'export PATH=%s:"$PATH"\n' ${lib.escapeShellArg runtimePath} >> "$CLAUDE_ENV_FILE"
      '';
    in {
      packages = [myconfig.agents.packages.claude-code];
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
    };
  })
