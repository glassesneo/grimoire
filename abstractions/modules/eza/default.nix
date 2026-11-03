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

    tests = {pkgs, ...}: let
      host = extra: {
        uses = ["colorscheme" "zsh" "zsh.interactive" "zsh.interactive.zabrze"];
        host.myconfig.ifEnabled = lib.recursiveUpdate {colorscheme.selection.name = "rose-pine";} extra;
      };
      configDir = result: result.options.environment.sessionVariables.value.EZA_CONFIG_DIR or null;
    in {
      # eza finds the official theme where the environment points and colors
      # with it.
      colorscheme =
        host {}
        // {
          build = result: let
            theme = (lib.findFirst (file: file.target == "${configDir result}/theme.yml") (throw "Missing theme.yml") result.manifest.files).source;
          in
            pkgs.runCommand "eza-colorscheme" {
              inherit theme;
              nativeBuildInputs = [pkgs.eza];
            } ''
              mkdir -p config listed/dir
              cp "$theme" config/theme.yml
              # The port colors directories with iris.
              EZA_CONFIG_DIR=$PWD/config eza --color=always listed | grep -F $'\e[1;38;2;196;167;231mdir'
              touch "$out"
            '';
        };
      unsupported-scheme = lib.recursiveUpdate (host {}) themes.unsupportedCase;
      without-colorscheme =
        host {eza.useColorscheme = false;}
        // {
          expr = configDir;
          expected = null;
        };
    };
  })
