{
  delib,
  lib,
  mylib,
  ...
}: let
  colorschemeTheme = import ./themes.nix {inherit lib;};
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    # Unset theme tables write nothing.
    theme = lib.filterAttrs (_: table: table != {}) cfg.theme;

    # elio finds its preview tools on PATH: pdfinfo and pdftocairo for PDF,
    # resvg for SVG.
    previewTools = pkgs: [pkgs.poppler-utils pkgs.resvg];

    # elio with its configuration passed as arguments, leaving the user's files
    # and environment untouched. Subcommands and --version/--help must come
    # first, so they reach elio unchanged.
    mkPackage = pkgs: theme: let
      toml = pkgs.formats.toml {};
      flags =
        ["--config" (toml.generate "config.toml" cfg.settings)]
        ++ lib.optionals (theme != {}) ["--theme" (toml.generate "theme.toml" theme)];
      elio = lib.getExe cfg.package;
    in
      pkgs.writeShellScriptBin "elio" ''
        PATH=$PATH:${lib.makeBinPath (previewTools pkgs)}
        case "''${1-}" in
          shell | portal | --portal-chooser | -V | --version | -h | --help) exec ${elio} "$@" ;;
        esac
        exec ${elio} ${lib.escapeShellArgs flags} "$@"
      '';
  in {
    name = "elio";
    meta.description = "Provide and publish elio, configure its settings and theme, and integrate it with Zsh.";

    options = {pkgs, ...}: let
      inherit (mylib.anchors.sources ./anchors.json) elio;
      inherit (lib) types;
      # A TOML value; tables are declared as attribute sets down to their keys,
      # so a higher source replaces only the keys it defines.
      table = types.attrsOf (pkgs.formats.toml {}).type;
      tables = types.attrsOf table;
      section = type:
        lib.mkOption {
          inherit type;
          default = {};
        };
    in
      with delib; {
        enable = boolOption true;
        upstreamPackage = packageOption (pkgs.callPackage "${elio}/nix/package.nix" {}) "Package whose source `sourceFiles` patches.";
        package = packageOption (mylib.sourceFiles.apply cfg.upstreamPackage cfg.sourceFiles) "Package installed and published; setting it bypasses `sourceFiles`.";
        sourceFiles = mylib.sourceFiles.option "upstreamPackage";
        settings = lib.mkOption {
          type = tables;
          default = {};
          description = "Settings written to elio's `config.toml`, by table and key.";
        };
        theme = lib.mkOption {
          type = types.submodule {
            options = {
              palette = section table;
              focused_entry = section table;
              preview = section tables;
              classes = section tables;
              directories = section tables;
              extensions = section tables;
              files = section tables;
            };
          };
          default = {};
          description = "Tables of elio's `theme.toml`, overriding elio's built-in theme; with every table empty, no file is written.";
        };
      };

    myconfig.ifEnabled.elio.settings = {
      # Files without a matching rule go to the system opener.
      open.rules = [
        {
          type = "text";
          command = "$EDITOR";
          terminal = true;
        }
      ];
      # Setting an action replaces its default keys.
      keys = {
        nav_up = ["k" "up" "ctrl+p"];
        nav_down = ["j" "down" "ctrl+n"];
        page_up = ["pageup" "ctrl+u"];
        page_down = ["pagedown" "ctrl+d"];
        # q leaves the shell where it was; Q takes it to the browsed directory.
        quit = "Q";
        quit_without_cd = "q";
      };
    };

    hjem.ifEnabled = {pkgs, ...}: let
      toml = pkgs.formats.toml {};
    in {
      packages = [cfg.package] ++ previewTools pkgs;

      # elio's macOS lookup includes ~/.config, so XDG paths apply on every platform.
      xdg.config.files =
        {
          "elio/config.toml" = {
            exclusive = true;
            generator = toml.generate "config.toml";
            value = cfg.settings;
          };
        }
        // lib.optionalAttrs (theme != {}) {
          "elio/theme.toml" = {
            exclusive = true;
            generator = toml.generate "theme.toml";
            value = theme;
          };
        };

      # Replaces `elio shell install`, which edits the rc file.
      zsh.zshrc.elio.text = ''
        source ${pkgs.runCommand "elio-init.zsh" {} "${lib.getExe cfg.package} shell init zsh > $out"}
      '';
    };

    # `elio` carries no theme; `elio-<combination>` follows each combination of
    # `colorscheme.combinations`, whatever the host selects.
    bundles.ifEnabled = {pkgs, ...}:
      lib.mkMerge [
        {
          elio = {
            package = mkPackage pkgs theme;
            publish = true;
          };
        }
        (lib.mapAttrs' (combination: resolved:
          lib.nameValuePair "elio-${combination}" {
            package = mkPackage pkgs (lib.recursiveUpdate (colorschemeTheme resolved) theme);
            publish = true;
          })
        myconfig.colorscheme.combinations)
      ];

    tests.fixture = ["exclusive" "zsh.interactive"];

    tests.cases = {pkgs, ...}: {
      # Stands in for elio and prints the arguments it receives.
      bundles = let
        fake = pkgs.writeShellScriptBin "elio" ''printf '%s\n' "$@"'';
      in {
        protects = "the bundle wrapper passes subcommands through and adds the configuration, and a combination's theme, only to launches";
        uses = ["colorscheme" "colorscheme.rose-pine"];
        moduleSystem = "bundles";
        modules.fixture.myconfig.always.elio.package = fake;
        build = result: let
          inherit (result) packages;
        in
          assert builtins.attrNames packages == ["elio" "elio-rose-pine"];
            pkgs.runCommand "elio-bundles" {} ''
              plain=${lib.getExe packages.elio}
              themed=${lib.getExe packages.elio-rose-pine}
              # Subcommands and --version reach elio unchanged.
              test "$($themed --version)" = --version
              test "$($themed shell init zsh | head -1)" = shell
              # A launch receives the configuration; only a combination has a theme.
              $plain /start > plain
              $themed /start > themed
              test "$(head -1 plain)" = --config
              ! grep -qx -- --theme plain
              test "$(tail -1 plain)" = /start
              grep -qx -- --theme themed
              grep -Fqx 'bg = "#191724"' "$(grep -A1 -x -- --theme themed | tail -1)"
              test "$(tail -1 themed)" = /start
              touch "$out"
            '';
      };
    };
  })
