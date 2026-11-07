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
    settings =
      {
        "$schema" = "https://json.schemastore.org/claude-code-settings.json";
        autoMemoryEnabled = false;
        permissions.defaultMode = "auto";
        sandbox = {
          enabled = true;
          autoAllowBashIfSandboxed = true;
        };
        env = {
          DISABLE_AUTOUPDATER = "1";
          ENABLE_TOOL_SEARCH = "true";
        };
      }
      // lib.optionalAttrs (theme != null) {inherit theme;};
  in {
    name = "claude-code";
    tests.fixture = ["exclusive"];
    meta.description = "Provide and configure Claude Code.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether Claude Code takes its theme from `colorscheme.resolved`.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.ifEnabled = {
      packages = [myconfig.agents.packages.claude-code];

      files.".claude/settings.json" = {
        exclusive = true;
        text = builtins.toJSON settings;
      };
    };
  })
