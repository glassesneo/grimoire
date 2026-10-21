{
  inputs,
  pkgs,
  system,
}: let
  lib = pkgs.lib;
  reconciler = pkgs.callPackage ../../adapters/hjem/services {};
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
            EnvironmentVariables."A&B" = "<value>\t\n\r${builtins.fromJSON ''"\u007f"''}";
            Extra = [true false (-1) [] {nested = "value";}];
          };
        };
      };
    }
  ];
  # Lowering is observed before serialization; the serializer owns plist syntax.
  # The build checks file placement, and runtime checks own lifecycle transitions.
  jobs = lib.listToAttrs (map (job: lib.nameValuePair job.name job) good.serviceApply.jobs);
  xml = good.serviceApply.plists."fixture.native".text;
  controls = builtins.fromJSON ''["\u0001", "\u0008", "\u000b", "\u000c", "\u000e", "\u001f"]'';
  wait = ["/bin/sh" "-c" ''/bin/wait4path /nix/store && exec "$@"'' "sh"];
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
  assert rejects "unsupported plist value" (bad {ThrottleInterval = 0.25;});
  assert rejects "unsupported plist value" (bad {Extra = [{nested = 1.5;}];});
  assert lib.all (control: rejects "XML control characters" (bad {Extra = [{nested = control;}];})) controls;
  assert rejects "XML control characters" (bad {EnvironmentVariables."bad${builtins.head controls}" = "value";});
  assert rejects "XML control characters" {userServices.x.command = ["/bin/true" (builtins.head controls)];};
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
  };
  assert jobs.example.config.ProgramArguments == wait ++ ["${pkgs.coreutils}/bin/true" "literal $arg"];
  assert jobs.example.config.EnvironmentVariables
  == {
    A = "a";
    B = "b";
  };
  assert jobs.example.config.LimitLoadToSessionType == "Background";
  assert jobs.native.config.ProgramArguments == wait ++ ["${pkgs.coreutils}/bin/true"];
  assert !(jobs.native.config ? Program);
  # Observe the adapter's escape=true wiring, not the upstream serializer's syntax.
  assert lib.hasInfix ''/bin/wait4path /nix/store &amp;&amp; exec &quot;$@&quot;'' xml;
  assert lib.hasInfix "<key>A&amp;B</key>" xml;
  assert lib.hasInfix "<string>&lt;value&gt;" xml;
  assert lib.all (name: let
    expected = name == "example";
    job = jobs.${name};
  in
    job.config.RunAtLoad == expected && job.runAtLoad == expected) ["example" "manual"]; true;
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
        inherit reconciler;
      }
      // lib.optionalAttrs pkgs.stdenv.hostPlatform.isDarwin {
        services = good.serviceApply;
      }) ''
      test -x "$reconciler/bin/hjem-services-reconcile"
      ${lib.optionalString pkgs.stdenv.hostPlatform.isDarwin ''
        test -f "$services/services.json"
        ${lib.concatMapStringsSep "\n" (job: ''test -f "$services/plists/${job.label}.plist"'') good.serviceApply.jobs}
      ''}
      touch "$out"
    '';
}
