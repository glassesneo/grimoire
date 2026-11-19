{
  inputs,
  denix,
  pkgs,
}: let
  inherit (pkgs) lib;

  # Repository-owned contract: disabling a parent, or a role a module follows,
  # gates the module's default without masking explicit overrides, and
  # conflicts, like a followed role no module declares, produce failed
  # assertions.
  # Assertion enforcement is tested at the consumer boundary, not here.
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
in {
  check = assert lib.assertMsg (
    normal.config.parent.child.enable
    && normal.config.parent.child.package == pkgs.zsh
    && !conditionOff.config.parent.child.enable
    && !normal.config.parent.conditional.enable
    && !disabled.config.parent.child.enable
    && !disabled.config.parent.conditional.enable
    && disabled.config.parent.missing.child.enable
    && disabled.config.absent.child.enable
    && disabled.config.parent.settings.value == "setting"
    && disabled.config.parent.settings.child.enable
    && explicit.config.parent.conditional.enable
    && conflict.config.parent.child.enable
    && normal.config.follower.enable
    && !seatOff.config.follower.enable
    && followerForced.config.follower.enable
  ) "Module dependency defaults or overrides failed";
  assert lib.assertMsg (
    lib.all (entry: entry.assertion) normal.assertions
    && lib.all (entry: entry.assertion) disabled.assertions
    && lib.any (entry: !entry.assertion) conflict.assertions
  ) "An enabled child with a disabled parent must produce a failed assertion";
  assert lib.assertMsg (
    lib.all (entry: entry.assertion) seatOff.assertions
    && lib.any (entry: !entry.assertion && entry.message == "follower.enable = true requires roles.seat.enable = true") followerForced.assertions
    && lib.any (entry: !entry.assertion && entry.message == "orphan: meta.follows names \"missing\", which no module roles.missing declares") unknownRole.assertions
  ) "An enabled module whose followed role is disabled, or a followed role no module declares, must produce a failed assertion";
    pkgs.runCommand "module-dependencies-test" {} ''
      mkdir "$out"
    '';
}
