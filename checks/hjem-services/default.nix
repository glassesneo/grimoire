{
  inputs,
  pkgs,
  system,
}: let
  lib = pkgs.lib;
  makeSystem = (import ../../adapters/hjem {inherit inputs;}).moduleSystems.hjem.makeSystem;
  result = modules:
    makeSystem {
      inherit modules;
      extraArgs = {
        inherit system;
        username = "fixture";
        homeDirectory = "/tmp/hjem-services-fixture";
      };
    };
  good = result [
    {
      userServices = {
        example = {
          command = ["${pkgs.coreutils}/bin/true" "literal $arg"];
          environment.A = "a";
        };
        manual = {
          command = ["${pkgs.coreutils}/bin/true"];
          autoStart = false;
        };
      };
      platform.darwin.launchAgents = {
        example = {
          domain = "user";
          config.EnvironmentVariables.B = "b";
        };
        native = {
          domain = "gui";
          config = {
            Program = "${pkgs.coreutils}/bin/true";
            Label = "fixture.native";
          };
        };
      };
    }
  ];
  # Evaluation is the lowest boundary for duplicate/identity rejection. Plistlib
  # validates serialization separately; runtime checks own lifecycle transitions.
  rejected = module: !(builtins.tryEval (builtins.deepSeq (result [module]).serviceApply true)).success;
  # Declaration errors are assertions, so a rejection also names its reason.
  rejects = reason: module: lib.any (lib.hasInfix reason) (result [module]).failedAssertions && rejected module;
  base = {userServices.x.command = ["/bin/true"];};
  bad = extra:
    lib.recursiveUpdate base {
      platform.darwin.launchAgents.x = {
        domain = "user";
        config = extra;
      };
    };
  linuxResult = module:
    lib.evalModules {
      specialArgs = {
        inherit lib;
        pkgs = inputs.nixpkgs.legacyPackages.x86_64-linux;
      };
      modules = [
        "${inputs.nixpkgs}/nixos/modules/misc/assertions.nix"
        ../../adapters/hjem/services.nix
        {
          options.directory = lib.mkOption {
            type = lib.types.str;
            default = "/tmp/fixture";
          };
          config = module;
        }
      ];
    };
  darwinChecks = assert rejects "duplicate Label" {
    platform.darwin.launchAgents = {
      a = {
        domain = "user";
        config = {
          Label = "Org.Test";
          Program = "/bin/true";
        };
      };
      b = {
        domain = "gui";
        config = {
          Label = "org.test";
          Program = "/bin/true";
        };
      };
    };
  };
  assert rejects "duplicate x.EnvironmentVariables.A" (lib.recursiveUpdate (bad {EnvironmentVariables.A = "same";}) {userServices.x.environment.A = "same";});
  assert rejects "duplicate x.WorkingDirectory" (lib.recursiveUpdate (bad {WorkingDirectory = "/tmp";}) {userServices.x.workingDirectory = "/tmp";});
  assert rejects "duplicate x.ProgramArguments" (bad {ProgramArguments = ["relative"];});
  assert rejects "duplicate x.ProgramArguments" (bad {ProgramArguments = ["/bin/true"];});
  assert rejects "portable command conflicts with Program" (bad {Program = "/bin/true";});
  assert rejects "duplicate x.RunAtLoad" (bad {RunAtLoad = true;});
  assert rejects "invalid plist identity" (bad {Label = "../unsafe";});
  assert rejects "invalid plist identity" (bad {LimitLoadToSessionType = "Aqua";});
  # The option type rejects an empty argv before any assertion.
  assert rejected {userServices.x.command = [];};
  assert rejects "duplicate restartOnSwitch policy" (lib.recursiveUpdate base {
    platform.darwin.launchAgents.x = {
      domain = "user";
      restartOnSwitch = false;
    };
  });
  assert rejects "duplicate Label" {
    platform.darwin.launchAgents = {
      a = {
        domain = "user";
        config = {
          Label = "same";
          Program = "/bin/true";
        };
      };
      b = {
        domain = "gui";
        config = {
          Label = "same";
          Program = "/bin/true";
        };
      };
    };
  }; true;
in {
  check = assert lib.any (assertion: !assertion.assertion && lib.hasInfix "Linux user-service backend" assertion.message) (linuxResult base).config.assertions;
  assert (builtins.tryEval
    (linuxResult {
      platform.darwin.launchAgents.native = {
        domain = "gui";
        config.Program = "/bin/true";
      };
    }).config.serviceApply.drvPath).success;
  assert !pkgs.stdenv.hostPlatform.isDarwin || darwinChecks;
    pkgs.runCommand "hjem-services-test" ({
        nativeBuildInputs = [pkgs.python3];
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
        services = good.serviceApply;
      }) ''
      python3 ${./reconcile.py} ${../../adapters/hjem/services.py}
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        python3 - "$services" <<'PY'
        import json, pathlib, plistlib, sys
        out = pathlib.Path(sys.argv[1])
        jobs = {job['name']: job for job in json.loads((out / 'services.json').read_text())}
        plists = {name: plistlib.loads((out / 'plists' / (job['label'] + '.plist')).read_bytes()) for name, job in jobs.items()}
        wait = ['/bin/sh', '-c', '/bin/wait4path /nix/store && exec "$@"', 'sh']
        true = '${pkgs.coreutils}/bin/true'
        portable = plists['example']
        assert portable['ProgramArguments'] == wait + [true, 'literal $arg']
        assert portable['EnvironmentVariables'] == {'A': 'a', 'B': 'b'}
        assert portable['LimitLoadToSessionType'] == 'Background'
        assert plists['native']['ProgramArguments'] == wait + [true] and 'Program' not in plists['native']
        # The declared autoStart reaches launchd and the reconciler alike.
        for name, expected in [('example', True), ('manual', False)]:
            assert plists[name]['RunAtLoad'] is expected and jobs[name]['runAtLoad'] is expected
        PY
      ''}
      touch "$out"
    '';
}
