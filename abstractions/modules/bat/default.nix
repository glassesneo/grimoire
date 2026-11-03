{
  delib,
  lib,
  mylib,
  ...
}: let
  # Official ports by scheme name: bat names a theme after its file.
  themes = mylib.schemeThemes {
    name = "bat";
    themes.rose-pine = {
      name = "rose-pine";
      source = pkgs: "${pkgs.fetchFromGitHub {
        owner = "rose-pine";
        repo = "tm-theme";
        rev = "6d556734541ccb04172e81fd58de4a35fff72d19";
        hash = "sha256-5+fG21KbB7bdPvszkz9Ftl6fCDGs17fJNTAXFRFWZGo=";
      }}/dist/rose-pine.tmTheme";
    };
  };

  # bat reads themes only from its compiled cache, which keeps the built-in
  # assets beside the theme; the cache records the bat that built it.
  cache = pkgs: theme:
    pkgs.runCommandLocal "bat-cache" {nativeBuildInputs = [pkgs.bat];} ''
      mkdir -p source/themes
      cp ${theme.source pkgs} source/themes/${theme.name}.tmTheme
      bat cache --build --source source --target "$out"
    '';
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "bat";
    meta.description = "Provide and configure bat for file display.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether bat takes its theme from `colorscheme.resolved`.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.ifEnabled = {pkgs, ...}: {
      packages = [pkgs.bat];

      environment.sessionVariables = lib.mkIf (theme != null) {
        BAT_CACHE_PATH = cache pkgs theme;
      };

      xdg.config.files."bat/config" = {
        exclusive = true;
        text =
          ''
            --style="plain,changes"
            --number
          ''
          + lib.optionalString (theme != null) ''
            --theme="${theme.name}"
          '';
      };
    };

    tests = {pkgs, ...}: let
      host = extra: {
        uses = ["colorscheme"];
        host.myconfig.ifEnabled = lib.recursiveUpdate {colorscheme.selection.name = "rose-pine";} extra;
      };
      variables = result: result.options.environment.sessionVariables.value;
      config = result: result.options.xdg.config.files.value."bat/config".text;
    in {
      # The configured theme is the official one, found in the cache.
      colorscheme =
        host {}
        // {
          build = result:
            pkgs.runCommand "bat-colorscheme" {
              BAT_CACHE_PATH = (variables result).BAT_CACHE_PATH;
              config = pkgs.writeText "config" (config result);
              nativeBuildInputs = [pkgs.bat];
            } ''
              # bat writes 24-bit colors only to a terminal that reports them.
              export HOME=$TMPDIR BAT_CONFIG_PATH=$config COLORTERM=truecolor
              echo 'fn main() {}' > main.rs
              # The port colors Rust's `fn` with foam.
              bat --color=always main.rs | grep -F $'\e[38;2;156;207;216mfn'
              touch "$out"
            '';
        };
      unsupported-scheme = lib.recursiveUpdate (host {}) themes.unsupportedCase;
      without-colorscheme =
        host {bat.useColorscheme = false;}
        // {
          expr = result: {
            cache = (variables result) ? BAT_CACHE_PATH;
            theme = lib.hasInfix "--theme" (config result);
          };
          expected = {
            cache = false;
            theme = false;
          };
        };
    };
  })
