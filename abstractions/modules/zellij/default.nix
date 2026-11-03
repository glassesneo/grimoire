{
  delib,
  inputs,
  lib,
  ...
}: let
  inherit (lib) types;

  # Zellij parses KDL v1 only.
  toKdl = content:
    inputs.nix-wrapper-modules.lib.toKdl (_: {
      version = 1;
      indent = "    ";
      inherit content;
    });

  argument = types.oneOf [types.bool types.int types.float types.str];
  arguments = types.either argument (types.listOf argument);
  node =
    types.oneOf [argument (types.listOf argument) (types.attrsOf node)]
    // {description = "KDL node: arguments, or an attribute set of child nodes";};

  action =
    types.addCheck (types.attrsOf (types.oneOf [
      argument
      (types.listOf argument)
      (types.submodule {
        options = {
          args = lib.mkOption {
            type = types.listOf argument;
            default = [];
          };
          children = lib.mkOption {
            type = types.attrsOf arguments;
            default = {};
          };
        };
      })
    ])) (attrs: builtins.length (builtins.attrNames attrs) == 1)
    // {description = "Zellij action";};

  # `shared` binds in every mode, so it comes first.
  modes = ["shared" "normal" "locked" "resize" "pane" "move" "tab" "scroll" "search" "entersearch" "renametab" "renamepane" "session" "tmux" "prompt"];

  renderAction = attrs: let
    name = builtins.head (builtins.attrNames attrs);
    value = attrs.${name};
  in {
    ${name} =
      if value == []
      then _: {}
      else if builtins.isAttrs value
      then
        _: {
          props = value.args;
          content = value.children;
        }
      else value;
  };

  renderKeybinds = keybinds: {
    keybinds = _: {
      props = {clear-defaults = true;};
      content = map (mode: {
        ${mode} = _: {
          content = lib.mapAttrsToList (key: actions: {
            bind = _: {
              props = [key];
              content = map renderAction actions;
            };
          }) (lib.filterAttrs (_: actions: actions != null) keybinds.${mode});
        };
      }) (lib.filter (mode: keybinds.${mode} != {}) modes);
    };
  };

  # Zellij's legacy theme format, which it converts to its UI components; the
  # palette has no orange, so the nearest ANSI hue stands in.
  colorschemeSettings = palette: let
    a = palette.ansi;
  in {
    themes.colorscheme = {
      fg = palette.foreground;
      bg = palette.background;
      inherit (a) black red green yellow blue magenta cyan white;
      orange = a.yellow;
    };
    theme = "colorscheme";
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    # A configuration directory, as Zellij reads it with `--config-dir`.
    configDir = pkgs: settings:
      pkgs.linkFarm "zellij-config" {
        "config.kdl" = pkgs.writeText "config.kdl" (toKdl [(renderKeybinds cfg.keybinds) settings]);
        "layouts/default.kdl" = ./layouts/default.kdl;
      };

    mkPackage = pkgs: settings:
      inputs.nix-wrapper-modules.lib.wrapPackage {
        inherit pkgs;
        package = pkgs.zellij;
        flags."--config-dir" = configDir pkgs settings;
      };
  in {
    name = "zellij";
    meta.description = "Provide, configure and publish the Zellij terminal multiplexer, and own its configuration file.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether Zellij takes its colors from `colorscheme.resolved`.";
      settings = lib.mkOption {
        type = types.attrsOf node;
        default = {};
        description = "Top-level nodes of Zellij's `config.kdl` other than `keybinds`; a list repeats the node's arguments.";
      };
      keybinds = lib.mkOption {
        type = types.submodule {
          options = lib.genAttrs modes (_:
            lib.mkOption {
              type = types.attrsOf (types.nullOr (types.listOf action));
              default = {};
            });
        };
        default = {};
        description = "Actions bound by mode and key, replacing Zellij's default keybindings; `shared` binds in every mode, and `null` leaves a key unbound. An action is an attribute set of one action name to its arguments, or to `args` and `children` for an action with a block.";
      };
    };

    myconfig.ifEnabled.zellij = {
      settings = lib.mkMerge [
        {
          plugins = {};
          load_plugins = {};

          support_kitty_graphics_protocol = true;
          support_kitty_keyboard_protocol = true;
          styled_underlines = true;

          pane_frames = true;
          show_startup_tips = false;
          show_release_notes = false;
          mouse_hover_effects = true;
          mouse_hover_tips = false;

          session_serialization = false;
          disable_session_metadata = true;
          auto_layout = false;
          stacked_resize = false;
          scroll_mode_sync = true;
          copy_on_select = true;
          mouse_mode = true;
          advanced_mouse_actions = false;
        }
        (lib.mkIf (cfg.useColorscheme && myconfig.colorscheme.resolved != null)
          (colorschemeSettings myconfig.colorscheme.resolved.palette))
      ];

      keybinds = let
        scrollAndSearch = {
          "j" = [{ScrollDown = [];}];
          "k" = [{ScrollUp = [];}];
          "d" = [{HalfPageScrollDown = [];}];
          "u" = [{HalfPageScrollUp = [];}];
          "Ctrl f" = [{PageScrollDown = [];}];
          "Ctrl b" = [{PageScrollUp = [];}];
          "g" = [{ScrollToTop = [];}];
          "G" = [{ScrollToBottom = [];}];
          "e" = [{EditScrollback = [];} {SwitchToMode = "Normal";}];
          "Esc" = [{ScrollToBottom = [];} {SwitchToMode = "Normal";}];
        };
      in {
        # Super bindings rely on the terminal reporting Cmd through the kitty
        # keyboard protocol.
        shared = {
          # NewPane only opens to the right or below; the pane is moved to
          # open it on the left or above.
          "Super h" = [{NewPane = "Right";} {MovePane = "Left";}];
          "Super j" = [{NewPane = "Down";}];
          "Super k" = [{NewPane = "Down";} {MovePane = "Up";}];
          "Super l" = [{NewPane = "Right";}];

          "Super t" = [{NewTab = [];}];
          "Super [" = [{GoToPreviousTab = [];}];
          "Super ]" = [{GoToNextTab = [];}];

          "Super p" = [{ToggleFloatingPanes = [];}];
          "Super z" = [{ToggleFocusFullscreen = [];}];
          "Super u" = [{SwitchToMode = "Scroll";}];
          "Super f" = [{SwitchToMode = "EnterSearch";} {SearchInput = 0;}];
        };
        scroll =
          scrollAndSearch
          // {
            "[" = [{ScrollToPreviousPrompt = [];}];
            "]" = [{ScrollToNextPrompt = [];}];
            "/" = [{SwitchToMode = "EnterSearch";} {SearchInput = 0;}];
          };
        entersearch = {
          "Enter" = [{SwitchToMode = "Search";}];
          "Esc" = [{SwitchToMode = "Normal";}];
        };
        search =
          scrollAndSearch
          // {
            "n" = [{Search = "down";}];
            "N" = [{Search = "up";}];
          };
      };
    };

    hjem.always.options.zellij.pluginPermissions = lib.mkOption {
      type = with types;
        attrsOf (listOf (enum [
          "ReadApplicationState"
          "ChangeApplicationState"
          "OpenFiles"
          "RunCommands"
          "OpenTerminalsOrPlugins"
          "WriteToStdin"
          "WebAccess"
          "ReadCliPipes"
          "MessageAndLaunchOtherPlugins"
          "Reconfigure"
          "FullHdAccess"
          "StartWebServer"
          "InterceptInput"
          "ReadPaneContents"
          "RunActionsAsUser"
          "WriteToClipboard"
          "ReadSessionEnvironmentVariables"
        ]));
      default = {};
      description = "Permissions granted to plugins, by the absolute path of the plugin's wasm file. When any are declared, they replace Zellij's permission cache, which Zellij can then no longer write, so a plugin that is not declared asks for its permissions in every session.";
    };

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      permissions = config.zellij.pluginPermissions;
      permissionsFile = {
        exclusive = true;
        text = lib.concatStrings (lib.mapAttrsToList (plugin: granted:
          "${builtins.toJSON plugin} {\n"
          + lib.concatMapStrings (permission: "    ${permission}\n") granted
          + "}\n")
        permissions);
      };
    in {
      packages = [pkgs.zellij];

      # Zellij keeps the cache in the platform's cache directory, which on
      # Darwin is not XDG_CACHE_HOME.
      files = lib.mkIf (pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
        "Library/Caches/org.Zellij-Contributors.Zellij/permissions.kdl" = permissionsFile;
      };
      xdg.cache.files = lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
        "zellij/permissions.kdl" = permissionsFile;
      };

      xdg.config.files = {
        "zellij/config.kdl" = {
          exclusive = true;
          text = toKdl [(renderKeybinds cfg.keybinds) cfg.settings];
        };
        # Replaces the built-in default layout, which also serves as the
        # template of new tabs.
        "zellij/layouts/default.kdl" = {
          exclusive = true;
          source = ./layouts/default.kdl;
        };
      };
    };

    # `zellij` carries no theme; `zellij-<combination>` follows each
    # combination of `colorscheme.combinations`, whatever the host selects.
    bundles.ifEnabled = {pkgs, ...}:
      lib.mkMerge [
        {
          zellij = {
            package = mkPackage pkgs cfg.settings;
            publish = true;
          };
        }
        (lib.mapAttrs' (combination: resolved:
          lib.nameValuePair "zellij-${combination}" {
            package = mkPackage pkgs (lib.recursiveUpdate cfg.settings (colorschemeSettings resolved.palette));
            publish = true;
          })
        myconfig.colorscheme.combinations)
      ];

    checks = {
      pkgs,
      home,
      ...
    }: let
      configDir = "${home}/fixture-config";
      config = result: result.options.xdg.config.files.value."zellij/config.kdl".text;
    in {
      valid-config = {
        uses = ["colorscheme"];
        modules.fixture = {
          hjem.always.xdg.config.directory = configDir;
          myconfig.always.zellij.keybinds.shared."Super x" = [{CloseFocus = [];}];
        };
        build = result:
          pkgs.runCommand "zellij-valid-config" {
            config = pkgs.writeText "config.kdl" (config result);
            nativeBuildInputs = [pkgs.zellij];
          } ''
            export HOME=$TMPDIR
            zellij --config "$config" setup --check
            grep -Fx '        "bind" "Super x" {' "$config"
            touch "$out"
          '';
      };

      null-unbinds = {
        uses = ["colorscheme"];
        host.myconfig.ifEnabled.zellij.keybinds.shared."Super t" = null;
        expr = result: lib.hasInfix "Super t" (config result);
        expected = false;
      };

      # The published configuration must be one Zellij accepts and carry the
      # combination's colors only where a combination is named.
      bundle-colors = {
        uses = ["colorscheme"];
        moduleSystem = "bundles";
        build = result:
          pkgs.runCommand "zellij-bundle-colors" {
            plain = result.packages.zellij;
            themed = result.packages.zellij-rose-pine;
            background = result.options.myconfig.colorscheme.combinations.value.rose-pine.palette.background;
          } ''
            export HOME=$TMPDIR
            for name in plain themed; do
              "''${!name}/bin/zellij" setup --check > check
              grep -F '[CONFIG FILE]: Well defined.' check
              dir=$(sed -n 's/^\[CONFIG DIR\]: "\(.*\)"$/\1/p' check)
              test -f "$dir/layouts/default.kdl"
              cp "$dir/config.kdl" "$name.kdl"
            done
            if grep -Fi "$background" plain.kdl; then exit 1; fi
            grep -Fi "$background" themed.kdl
            touch "$out"
          '';
      };
    };
  })
