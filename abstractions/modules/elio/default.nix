{
  delib,
  inputs,
  lib,
  mylib,
  ...
}: let
  # Any scheme's theme. Surfaces the palette lacks reuse its terminal roles;
  # ANSI roles follow upstream's terminal-ansi example theme.
  ansiTheme = palette: let
    a = palette.ansi;
  in {
    palette = {
      bg = palette.background;
      chrome = a.black;
      chrome_alt = palette.background;
      chip_text = palette.background;
      panel = palette.background;
      panel_alt = palette.background;
      surface = a.black;
      elevated = palette.selectionBackground;
      border = a.brightBlack;
      text = palette.foreground;
      muted = a.brightBlack;
      accent = a.blue;
      accent_soft = a.black;
      accent_text = palette.foreground;
      selected_bg = palette.selectionBackground;
      selected_border = a.blue;
      selection_bar = a.yellow;
      yank_bar = a.green;
      cut_bar = a.red;
      progress_bar = a.blue;
      trash_bar = a.red;
      restore_bar = a.blue;
      sidebar_active = a.black;
      button_bg = palette.background;
      button_disabled_bg = palette.background;
      path_bg = palette.background;
    };
    preview.code = {
      fg = palette.foreground;
      bg = palette.background;
      selection_bg = palette.selectionBackground;
      selection_fg = palette.selectionForeground;
      caret = palette.cursor;
      line_highlight = a.black;
      line_number = a.brightBlack;
      comment = a.brightBlack;
      string = a.green;
      constant = a.yellow;
      keyword = a.blue;
      function = a.cyan;
      type = a.magenta;
      parameter = a.yellow;
      tag = a.green;
      operator = a.cyan;
      macro = a.red;
      invalid = a.red;
    };
    classes = lib.mapAttrs (_: color: {inherit color;}) {
      directory = a.blue;
      code = a.cyan;
      config = a.magenta;
      document = a.green;
      license = a.yellow;
      image = a.cyan;
      audio = a.yellow;
      video = a.magenta;
      archive = a.red;
      font = a.magenta;
      data = a.green;
      file = a.white;
    };
  };

  # Schemes whose own vocabulary places elio's surfaces more precisely, by
  # name, layered over the ANSI theme. Rosé Pine has no elio port: neutral
  # roles follow the uses its palette assigns them, and the accent and code
  # colors follow its TextMate port, whose buttons and badges are rose.
  namedThemes.rose-pine = c: {
    palette = {
      bg = c.base;
      chrome = c.surface;
      chrome_alt = c.base;
      chip_text = c.base;
      panel = c.surface;
      panel_alt = c.base;
      surface = c.surface;
      elevated = c.overlay;
      border = c.highlightHigh;
      text = c.text;
      muted = c.subtle;
      accent = c.rose;
      accent_soft = c.overlay;
      selected_bg = c.highlightMed;
      selected_border = c.rose;
      yank_bar = c.foam;
      progress_bar = c.foam;
      restore_bar = c.foam;
      sidebar_active = c.overlay;
      button_bg = c.surface;
      button_disabled_bg = c.base;
      path_bg = c.base;
    };
    preview.code = {
      caret = c.highlightHigh;
      line_highlight = c.highlightLow;
      line_number = c.muted;
      comment = c.muted;
      string = c.gold;
      constant = c.rose;
      keyword = c.pine;
      function = c.rose;
      type = c.foam;
      parameter = c.iris;
      tag = c.foam;
      operator = c.subtle;
      macro = c.love;
      invalid = c.love;
    };
    classes.directory.color = c.iris;
  };

  colorschemeTheme = resolved:
    lib.recursiveUpdate (ansiTheme resolved.palette)
    ((namedThemes.${resolved.name} or (_: {})) resolved.palette.named);
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
        upstreamPackage = packageOption inputs.elio.packages.${pkgs.stdenv.hostPlatform.system}.elio "Package whose source `sourceFiles` patches.";
        package = packageOption (mylib.sourceFiles.apply cfg.upstreamPackage cfg.sourceFiles) "Package installed and published; setting it bypasses `sourceFiles`.";
        sourceFiles = mylib.sourceFiles.option "upstreamPackage";
        useColorscheme = boolOption true "Whether elio takes its colors from `colorscheme.resolved`.";
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

    myconfig.ifEnabled.elio.theme = lib.mkIf (cfg.useColorscheme && myconfig.colorscheme.resolved != null) (colorschemeTheme myconfig.colorscheme.resolved);

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

    tests = {pkgs, ...}: let
      host = extra: expected: {
        inherit expected;
        uses = ["colorscheme"];
        # Bundles evaluate `myconfig` without the Zsh features elio adds to.
        moduleSystem = "bundles";
        host.myconfig.ifEnabled =
          lib.recursiveUpdate {
            elio.package = pkgs.emptyDirectory;
            colorscheme.selection.name = "rose-pine";
          }
          extra;
        expr = result: let
          theme = result.options.myconfig.elio.theme.value;
        in {
          bg = theme.palette.bg or null;
          directory = theme.classes.directory.color or null;
        };
      };
    in {
      # A scheme without named colors for elio takes the ANSI theme.
      ansi-scheme =
        host {colorscheme.selection.name = "fixture";} {
          bg = "#191724";
          directory = "#9ccfd8";
        }
        // {
          protects = "a scheme without an elio theme maps to the ANSI theme";
          modules.fixture.myconfig.always = {config, ...}: {
            colorscheme.schemes.fixture.palette = config.myconfig.colorscheme.schemes.rose-pine.palette;
          };
        };
      # Stands in for elio and prints the arguments it receives.
      bundles = let
        fake = pkgs.writeShellScriptBin "elio" ''printf '%s\n' "$@"'';
      in {
        protects = "the bundle wrapper passes subcommands through and adds the configuration, and a combination's theme, only to launches";
        uses = ["colorscheme"];
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
