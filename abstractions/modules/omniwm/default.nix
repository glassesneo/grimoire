{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) omniwm;
  upstream = import "${omniwm}/nix/lib.nix" {inherit lib;};
  defaults = builtins.fromTOML (builtins.readFile "${omniwm}/settings-defaults.toml");
  settingsLib = import "${omniwm}/nix/module/settings.nix" {inherit lib;};

  # A private Kanata -> OmniWM protocol. Physical Shift remains a modifier,
  # selecting the move action without a second navigation layer.
  navigation = [
    {
      key = "h";
      functionKey = "f14";
      focus = "focus.left";
      move = "moveColumn.left";
    }
    {
      key = "j";
      functionKey = "f15";
      focus = "switchWorkspace.next";
      move = "moveWindowToWorkspaceDown";
    }
    {
      key = "k";
      functionKey = "f16";
      focus = "switchWorkspace.previous";
      move = "moveWindowToWorkspaceUp";
    }
    {
      key = "l";
      functionKey = "f17";
      focus = "focus.right";
      move = "moveColumn.right";
    }
  ];
  bindings = lib.listToAttrs (lib.concatMap (entry: [
      (lib.nameValuePair entry.focus "Control+Command+${lib.toUpper entry.functionKey}")
      (lib.nameValuePair entry.move "Control+Shift+Command+${lib.toUpper entry.functionKey}")
    ])
    navigation);
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: {
    name = "omniwm";
    meta = {
      description = "Provide OmniWM as a user service, own its writable settings, and integrate its navigation with Kanata.";
      tags = ["gui"];
    };
    tests.fixture = ["kanata" "services" "exclusive"];

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        package = packageOption (pkgs.callPackage "${omniwm}/nix/package.nix" {});
        settings = lib.mkOption {
          type = lib.types.attrsOf (pkgs.formats.toml {}).type;
          default = {};
          description = "Settings layered over the pinned OmniWM defaults; hotkeys are merged by id. The switch reapplies them to the writable settings file.";
        };
      };

    constraints.ifEnabled = [
      {
        assertion = myconfig.kanata.enable;
        message = "omniwm.enable requires kanata.enable = true for its held navigation layer";
      }
      {
        assertion = myconfig.spaces.enable;
        message = "omniwm.enable requires spaces.enable = true for Displays have separate Spaces";
      }
    ];

    myconfig.ifEnabled = {
      kanata.layers = {
        base.lmet = ["tap-dance-eager" 300 ["lmet" ["layer-while-held" "omniwm"]]];
        omniwm = lib.listToAttrs (map (entry: lib.nameValuePair entry.key "C-M-${entry.functionKey}") navigation) // {o = "C-M-f18";};
      };
      omniwm.settings = {
        general = {
          defaultLayoutType = "niri";
          updateChecksEnabled = false;
          ipcEnabled = false;
          animationsEnabled = true;
          animationSpeed = 1.0;
        };
        clipboard.historyEnabled = false;
        gaps = {
          size = 5.0;
          fullscreenUsesOuterGaps = true;
          outer = {
            top = 38.0;
            left = 4.0;
            right = 4.0;
            bottom = 4.0;
          };
        };
        borders = {
          enabled = true;
          width = 3.0;
        };
        appRules =
          defaults.appRules
          ++ [
            (upstream.appRule "com.apple.finder" {layout = "float";})
            (upstream.appRule "com.apple.systempreferences" {layout = "float";})
            (upstream.appRule "" {
              axSubrole = "AXDialog";
              layout = "float";
            })
          ];
        focus = {
          followsMouse = false;
          moveMouseToFocusedWindow = false;
          followsWindowToMonitor = true;
          crossesMonitorAtEdge = false;
        };
        niri.defaultContainerPrimarySpan = 1.0;
        hiddenBar.enabled = false;
        workspaceBar.enabled = false;
        quakeTerminal.enabled = false;
        overview.enabled = true;
        windowSwitcher = {
          enabled = true;
          commandTab = "activeWorkspace";
          optionTab = "allWorkspaces";
          order = "lastUsed";
        };
        gestures = {
          workspaceSwipeEnabled = true;
          workspaceSwipeAxis = "vertical";
          workspaceSwipeEdgeBehavior = "cycle";
          workspaceSwipeFingerCount = 3;
        };
        workspaces = upstream.workspaces (
          lib.replicate 5 {layoutType = "niri";}
          ++ lib.replicate 5 {
            layoutType = "niri";
            monitorAssignment.type = "secondary";
          }
        );
        # No default, digit, floating or fullscreen shortcuts leak through.
        hotkeys = upstream.hotkeys (
          lib.genAttrs (map (hotkey: hotkey.id) defaults.hotkeys) (_: "Unassigned")
          // bindings
          // {toggleOverview = "Control+Command+F18";}
        );
      };
    };

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      settings = settingsLib.merge defaults cfg.settings;
      toml = (pkgs.formats.toml {}).generate "omniwm-settings.toml" settings;
      json = pkgs.writeText "omniwm-settings.json" (builtins.toJSON settings);
      deploy = pkgs.writers.writeNu "omniwm-deploy-settings" (builtins.readFile "${omniwm}/scripts/deploy-settings.nu");
      app = "${cfg.package}/Applications/OmniWM.app";
    in {
      packages = [cfg.package];
      files."Applications/OmniWM.app" = {
        exclusive = true;
        source = app;
      };
      # OmniWM rewrites settings at startup, so this must not be a store link.
      applySteps.omniwm = {
        before = ["services"];
        package = pkgs.writeShellApplication {
          name = "apply";
          runtimeInputs = [pkgs.coreutils];
          text = ''
            ${deploy} ${toml} ${json} ${lib.escapeShellArg "${config.xdg.config.directory}/omniwm/settings.toml"} '[]'
          '';
        };
      };
      userServices.omniwm = {
        command = ["${app}/Contents/MacOS/OmniWM"];
        environment.XDG_CONFIG_HOME = config.xdg.config.directory;
        restart = "on-failure";
      };
    };
  })
