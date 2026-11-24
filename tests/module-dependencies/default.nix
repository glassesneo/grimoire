{
  inputs,
  denix,
  pkgs,
}: let
  inherit (pkgs) lib;

  feature = name: enabled: {delib, ...}:
    delib.module {
      inherit name;
      options.enable = delib.boolOption enabled;
    };

  evaluateWith = extra: overrides: let
    configuration = denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          ../../extensions/module-constraints.nix
          ../../extensions/module-dependencies.nix
          (feature "parent" true)
          ({delib, ...}:
            delib.module ({myconfig, ...}: {
              name = "parent.child";
              options = {pkgs, ...}: {
                enable = delib.boolOption (myconfig.parent.settings.value == "setting");
                package = delib.packageOption pkgs.zsh;
              };
            }))
          (feature "parent.conditional" false)
          (feature "parent.missing.child" true)
          (feature "absent.child" true)
          (feature "parent.settings.child" true)
          ({delib, ...}:
            delib.module {
              name = "parent.settings";
              options.value = delib.strOption "setting";
            })
          (feature "roles.seat" true)
          ({delib, ...}:
            delib.module {
              name = "follower";
              meta.follows = ["seat"];
              options.enable = delib.boolOption true;
            })
          ({delib, ...}:
            delib.module {
              name = "test-overrides";
              myconfig.always = overrides;
            })
        ]
        ++ extra;
    };
    evaluation =
      (lib.evalModules {
        modules = [
          (configuration.genModule {})
          {
            options.assertions = lib.mkOption {
              type = lib.types.listOf lib.types.unspecified;
              default = [];
            };
          }
        ];
        specialArgs = {inherit pkgs;};
      }).config;
  in {
    config = evaluation.myconfig;
    inherit (evaluation) assertions;
  };

  evaluate = evaluateWith [];
  normal = evaluate {};
  disabled = evaluate {parent.enable = false;};
  conflict = evaluate {
    parent.enable = false;
    parent.child.enable = true;
  };
  explicit = evaluate {parent.conditional.enable = true;};
  conditionOff = evaluate {parent.settings.value = "other";};
  seatOff = evaluate {roles.seat.enable = false;};
  followerForced = evaluate {
    roles.seat.enable = false;
    follower.enable = true;
  };
  unknownRole = evaluateWith [
    ({delib, ...}:
      delib.module {
        name = "orphan";
        meta.follows = ["missing"];
      })
  ] {};
  failedMessages = evaluation: map (entry: entry.message) (lib.filter (entry: !entry.assertion) evaluation.assertions);
in {
  cases = {
    enabled-parent-keeps-child-defaults = {
      protects = "while the parent is enabled, its children keep the defaults they declare, including defaults read from other options";
      expr = {
        child = normal.config.parent.child.enable;
        childPackage = normal.config.parent.child.package;
        childWithConditionOff = conditionOff.config.parent.child.enable;
        conditional = normal.config.parent.conditional.enable;
      };
      expected = {
        child = true;
        childPackage = pkgs.zsh;
        childWithConditionOff = false;
        conditional = false;
      };
    };
    disabled-parent-disables-child-defaults = {
      protects = "disabling a parent turns its children's enable defaults off";
      expr = {
        child = disabled.config.parent.child.enable;
        conditional = disabled.config.parent.conditional.enable;
      };
      expected = {
        child = false;
        conditional = false;
      };
    };
    disabled-parent-gates-only-its-direct-children = {
      protects = "disabling a parent leaves modules without a direct parent module, their other options, and children of a module without enable untouched";
      expr = {
        missingParentChild = disabled.config.parent.missing.child.enable;
        absentParentChild = disabled.config.absent.child.enable;
        settingsValue = disabled.config.parent.settings.value;
        settingsChild = disabled.config.parent.settings.child.enable;
      };
      expected = {
        missingParentChild = true;
        absentParentChild = true;
        settingsValue = "setting";
        settingsChild = true;
      };
    };
    explicit-enable-overrides-gated-default = {
      protects = "an explicit enable wins over the default, whether the default is the module's own or gated by a disabled parent";
      expr = {
        conditional = explicit.config.parent.conditional.enable;
        childOfDisabledParent = conflict.config.parent.child.enable;
      };
      expected = {
        conditional = true;
        childOfDisabledParent = true;
      };
    };
    follower-tracks-seat = {
      protects = "a module declaring meta.follows is enabled by default while the followed seat is enabled, disabled while it is not, and an explicit enable still wins";
      expr = {
        seatOn = normal.config.follower.enable;
        seatOff = seatOff.config.follower.enable;
        forced = followerForced.config.follower.enable;
      };
      expected = {
        seatOn = true;
        seatOff = false;
        forced = true;
      };
    };
    consistent-configurations-pass-assertions = {
      protects = "gated defaults alone, with a parent or a followed seat disabled, produce no failed assertion";
      expr = {
        normal = failedMessages normal;
        disabled = failedMessages disabled;
        seatOff = failedMessages seatOff;
      };
      expected = {
        normal = [];
        disabled = [];
        seatOff = [];
      };
    };
    enabled-child-of-disabled-parent-fails-assertion = {
      protects = "an enabled child whose parent is disabled produces a failed assertion";
      expr = failedMessages conflict != [];
      expected = true;
    };
    enabled-follower-of-disabled-seat-fails-assertion = {
      protects = "an enabled module whose followed seat is disabled produces a failed assertion naming both";
      expr = lib.elem "follower.enable = true requires roles.seat.enable = true" (failedMessages followerForced);
      expected = true;
    };
    undeclared-followed-role-fails-assertion = {
      protects = "a meta.follows naming a role no module declares produces a failed assertion";
      expr = lib.elem "orphan: meta.follows names \"missing\", which no module roles.missing declares" (failedMessages unknownRole);
      expected = true;
    };
  };
}
