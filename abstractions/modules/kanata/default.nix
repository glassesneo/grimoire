{
  delib,
  inputs,
  lib,
  ...
}: let
  kbd = import ./kbd.nix {inherit lib;};

  chord = lib.types.submodule {
    options = {
      keys = lib.mkOption {
        type = lib.types.uniq (lib.types.listOf lib.types.str);
        description = "Keys that, pressed together, activate the chord.";
      };
      action = lib.mkOption {type = kbd.expression;};
      timeout = lib.mkOption {
        type = lib.types.ints.positive;
        description = "Milliseconds from the first key within which every key must be pressed.";
      };
      release = lib.mkOption {
        type = lib.types.enum ["all-released" "first-release"];
        description = "Whether the action is released when every key or the first key is released.";
      };
      disabledLayers = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
      };
    };
  };

  profiles = import ./profiles.nix;
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: {
    name = "kanata";
    meta.description = "Remap keyboard input with Kanata, generating its configuration from actions declared per layer and key.";

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        package = packageOption pkgs.kanata;
        profile = allowNull (enumOption (builtins.attrNames profiles) null) "Keymap from `profiles.nix` whose values this module contributes; `null` contributes none.";
        settings = attrsOfOption kbd.setting {} "Entries of `defcfg`; `true` and `false` render as `yes` and `no`. `delegate-to-first-layer` is always enabled.";
        defaultLayer = strOption "base" "Layer active at startup. A key another layer leaves unmapped acts as on the layer below it, and finally as on this one; a key this layer leaves unmapped keeps its own function.";
        layers = attrsOfOption (types.attrsOf kbd.expression) {} "Actions by layer and key name.";
        aliases = attrsOfOption kbd.expression {} "Actions that expressions reference as `@<name>`.";
        virtualKeys = attrsOfOption kbd.expression {} "Virtual keys that actions press, release or test by name.";
        chords = attrsOfOption chord {} "Chords (`defchordsv2`), named by contribution.";
        configFile = readOnly (defaultText (lib.mkOption {
          type = types.package;
          default =
            pkgs.runCommand "kanata.kbd" {
              text = kbd.render {inherit (cfg) settings defaultLayer layers aliases virtualKeys chords;};
              passAsFile = ["text"];
              nativeBuildInputs = [cfg.package];
            } ''
              cp "$textPath" "$out"
              HOME=$TMPDIR kanata --check --nodelay --cfg "$out"
            '';
          description = "Kanata configuration rendered from these options, built only if `kanata --check` accepts it.";
        }) (lib.literalMD "the configuration rendered from these options"));
      };

    myconfig.ifEnabled.kanata = lib.mkMerge (
      lib.mapAttrsToList (name: lib.mkIf (cfg.profile == name)) profiles
      ++ [
        # Kanata rejects chords without it.
        {settings.concurrent-tap-hold = lib.mkIf (cfg.chords != {}) true;}
      ]
    );

    darwin.always.imports = [inputs.kanata-darwin.darwinModules.default];

    darwin.ifEnabled = {
      services.kanata = {
        enable = true;
        # Kanata 1.12 opens the keyboard only with Input Monitoring and
        # Accessibility (Device Control and Data Access on macOS 27), granted
        # by hand on first activation to kanata and to Kanata Bar, which
        # launches it. A bundle identity keeps kanata's grants across rebuilds.
        package = myconfig.app-identity.mkAppBundle {
          inherit (cfg) package;
          identifier = "com.github.jtroo.kanata";
        };
        sudoers = true;
        daemon.enable = false;
        configSource = cfg.configFile;
        kanata-bar = {
          enable = true;
          settings = {
            kanata = {
              port = 5829;
              extra_args = ["--nodelay"];
            };
            kanata_bar = {
              autostart_kanata = true;
              autorestart_kanata = true;
            };
          };
          extraLaunchdConfig = {
            KeepAlive.SuccessfulExit = false;
            ProcessType = "Interactive";
            ThrottleInterval = 5;
            StandardOutPath = "/tmp/kanata-bar.log";
            StandardErrorPath = "/tmp/kanata-bar.err";
          };
        };
      };
    };

    tests = _: let
      contributor = action: {myconfig.always.kanata.layers.base.x = action;};
      base = result: result.options.myconfig.kanata.layers.value.base;
    in {
      conflicting-actions-rejected = {
        protects = "a contribution to kanata.layers cannot silently replace another's different action for the same layer and key";
        modules = {
          a = contributor ["tap-hold" 200 200 "x" "lctl"];
          b = contributor ["tap-hold" 200 200 "x" "lalt"];
        };
        expr = base;
        fails = true;
      };
      equal-actions-merge = {
        protects = "contributions that declare the same action for one layer and key agree instead of conflicting";
        modules = {
          a = contributor ["tap-hold" 200 200 "x" "lctl"];
          b = contributor ["tap-hold" 200 200 "x" "lctl"];
        };
        expr = result: (base result).x;
        expected = ["tap-hold" 200 200 "x" "lctl"];
      };
    };
  })
