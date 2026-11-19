{
  delib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # eza considers theme.yml unstable; the port states the eza release it was
  # tested against.
  themes = mylib.schemeThemes {
    name = "eza";
    themes.rose-pine = _: "${rose-pine}/dist/rose-pine.yml";
  };
in
  delib.module ({myconfig, ...}: let
    inherit (myconfig.roles.colorscheme) resolved;
  in {
    name = "eza.colorscheme";
    tests.fixture = ["eza" "exclusive" "roles.colorscheme"];
    meta = {
      description = "Give eza the theme of the held color scheme.";
      follows = ["colorscheme"];
    };

    options.enable = delib.boolOption true;

    constraints.ifEnabled = [(themes.constraint resolved)];

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: {
      # Without EZA_CONFIG_DIR, eza looks in the platform's configuration
      # directory, which on Darwin is not XDG_CONFIG_HOME.
      environment.sessionVariables.EZA_CONFIG_DIR = "${config.xdg.config.directory}/eza";
      xdg.config.files."eza/theme.yml" = {
        exclusive = true;
        source = themes.of resolved pkgs;
      };
    };
  })
