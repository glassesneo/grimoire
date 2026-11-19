{
  delib,
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
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
  in {
    name = "claude-code.colorscheme";
    tests.fixture = ["claude-code" "roles.colorscheme"];
    meta = {
      description = "Give Claude Code the theme matching the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    hjem.ifEnabled.claude-code.settings.theme = themes.of resolved;
  })
