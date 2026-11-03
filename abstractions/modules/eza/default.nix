{
  delib,
  lib,
  mylib,
  ...
}: let
  # Official ports by scheme name. eza considers theme.yml unstable; the
  # port states the eza release it was tested against.
  themes = mylib.schemeThemes {
    name = "eza";
    themes.rose-pine = pkgs: "${pkgs.fetchFromGitHub {
      owner = "rose-pine";
      repo = "eza";
      rev = "ffd796b8265cc6395231f4ad663e6749f34fc897";
      hash = "sha256-UNdszLPp2IOAUydJQgoa3WwCr99dpD7bju0ktAtVS1I=";
    }}/dist/rose-pine.yml";
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "eza";
    meta.description = "Provide eza for listing files and directories.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether eza takes its colors from `colorscheme.resolved`.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      flags = "--git --icons=auto -a";
    in {
      packages = [pkgs.eza];

      # Without EZA_CONFIG_DIR, eza looks in the platform's configuration
      # directory, which on Darwin is not XDG_CONFIG_HOME.
      environment.sessionVariables = lib.mkIf (theme != null) {
        EZA_CONFIG_DIR = "${config.xdg.config.directory}/eza";
      };
      xdg.config.files = lib.mkIf (theme != null) {
        "eza/theme.yml" = {
          exclusive = true;
          source = theme pkgs;
        };
      };

      zsh.zabrze.snippets = {
        "eza" = {
          trigger = "ls";
          snippet = "eza ${flags}";
        };
        "eza -l" = {
          trigger = "ll";
          snippet = "eza -l ${flags}";
        };
        "eza -T" = {
          trigger = "tree";
          snippet = "eza -T ${flags}";
        };
      };
    };
  })
