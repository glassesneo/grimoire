{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (lib) types;

  inherit (mylib.anchors.sources ./anchors.json) nix-wrapper-modules;
  wrapperLib = import "${nix-wrapper-modules}/lib" {inherit lib;};

  # Zellij parses KDL v1 only.
  toKdl = content:
    wrapperLib.generators.toKdl (_: {
      version = 1;
      indent = "    ";
      inherit content;
    })
    + "\n";

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

  themes = import ./themes.nix {inherit mylib;};
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    configText = theme:
      toKdl [
        (renderKeybinds cfg.keybinds)
        (lib.optionalAttrs (theme != null) {theme = theme.name;} // cfg.settings)
      ];
    files = pkgs: theme:
      {"layouts/default.kdl" = ./layouts/default.kdl;}
      // lib.optionalAttrs (theme != null) {
        "themes/${theme.name}.kdl" = theme.source pkgs;
      };

    mkPackage = pkgs: theme:
      wrapperLib.wrapPackage {
        inherit pkgs;
        package = pkgs.zellij;
        flags."--config-dir" = pkgs.linkFarm "zellij-config" (files pkgs theme // {"config.kdl" = pkgs.writeText "config.kdl" (configText theme);});
      };
  in {
    name = "zellij";
    meta.description = "Provide, configure and publish the Zellij terminal multiplexer, and own its configuration file.";

    options = with delib; {
      enable = boolOption true;
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
      settings = {
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
      };

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
        shared = {
          "Ctrl Alt h" = [{NewPane = "Right";} {MovePane = "Left";}];
          "Ctrl Alt j" = [{NewPane = "Down";}];
          "Ctrl Alt k" = [{NewPane = "Down";} {MovePane = "Up";}];
          "Ctrl Alt l" = [{NewPane = "Right";}];
          "Alt Shift h" = [{MovePane = "Left";}];
          "Alt Shift j" = [{MovePane = "Down";}];
          "Alt Shift k" = [{MovePane = "Up";}];
          "Alt Shift l" = [{MovePane = "Right";}];

          "Super t" = [{NewTab = [];}];
          "Super ," = [{GoToPreviousTab = [];}];
          "Super ." = [{GoToNextTab = [];}];

          "Alt f" = [{ToggleFloatingPanes = [];}];
          "Alt z" = [{ToggleFocusFullscreen = [];}];
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

      # On Darwin, Zellij keeps this cache in Library/Caches, not
      # XDG_CACHE_HOME.
      files = lib.mkIf (pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
        "Library/Caches/org.Zellij-Contributors.Zellij/permissions.kdl" = permissionsFile;
      };
      xdg.cache.files = lib.mkIf (!pkgs.stdenv.hostPlatform.isDarwin && permissions != {}) {
        "zellij/permissions.kdl" = permissionsFile;
      };

      xdg.config.files =
        {
          "zellij/config.kdl" = {
            exclusive = true;
            text = configText null;
          };
        }
        // lib.mapAttrs' (path: source:
          lib.nameValuePair "zellij/${path}" {
            exclusive = true;
            inherit source;
          }) (files pkgs null);
    };

    bundles.ifEnabled = {pkgs, ...}:
      lib.mkMerge [
        {
          zellij = {
            package = mkPackage pkgs null;
            publish = true;
          };
        }
        (lib.mapAttrs' (combination: resolved: let
          theme = themes.of resolved;
        in
          lib.nameValuePair "zellij-${combination}" {
            package = mkPackage pkgs theme;
            publish = true;
          })
        (lib.filterAttrs (_: resolved: themes.of resolved != null) myconfig.colorscheme.combinations))
      ];

    tests.fixture = ["exclusive"];

    tests.cases = {
      pkgs,
      home,
      ...
    }: let
      configDir = "${home}/fixture-config";
      config = result: result.options.xdg.config.files.value."zellij/config.kdl".text;
    in {
      valid-config = {
        protects = "the KDL rendered from keybinds is configuration Zellij accepts";
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
        protects = "a null action leaves its key unbound";
        host.myconfig.ifEnabled.zellij.keybinds.shared."Super t" = null;
        expr = result: lib.hasInfix "Super t" (config result);
        expected = false;
      };

      bundle-themes = {
        protects = "each published configuration is accepted by Zellij and selects its combination's theme";
        uses = ["colorscheme" "colorscheme.rose-pine"];
        moduleSystem = "bundles";
        build = result:
          pkgs.runCommand "zellij-bundle-themes" {
            plain = result.packages.zellij;
            themed = result.packages.zellij-rose-pine;
          } ''
            export HOME=$TMPDIR
            for name in plain themed; do
              "''${!name}/bin/zellij" setup --check > check
              grep -F '[CONFIG FILE]: Well defined.' check
              dir=$(sed -n 's/^\[CONFIG DIR\]: "\(.*\)"$/\1/p' check)
              test -f "$dir/layouts/default.kdl"
              cp -rL "$dir" "$name"
            done
            if grep -F '"theme"' plain/config.kdl || test -e plain/themes; then exit 1; fi
            grep -Fx '"theme" "rose-pine"' themed/config.kdl
            grep -Eq '^[[:space:]]*rose-pine \{' themed/themes/rose-pine.kdl
            cat themed/config.kdl themed/themes/rose-pine.kdl > combined.kdl
            zellij=$themed/bin/zellij
            "$zellij" --config combined.kdl setup --check | grep -F '[CONFIG FILE]: Well defined.'
            touch "$out"
          '';
      };
    };
  })
