{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Repository-owned contract of the runner: a module with tests yields one
  # check that builds when every case holds, and fails to evaluate when any case
  # does not. Failure messages are read by people, not checked here.
  compose = abstractions:
    denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          ../../adapters/hjem
          ../../extensions/hosts.nix
          ../../extensions/module-metadata.nix
          ../../extensions/module-tests.nix
        ]
        ++ abstractions;
    };

  # A module whose single test case must not hold.
  failing = name: case:
    builtins.toFile "${name}.nix" ''
      {delib, ...}:
      delib.module {
        name = "${name}";
        meta.description = "Hold a test case that must not hold.";
        tests = _: {case = ${case};};
      }
    '';

  failingModules = {
    mismatch = "{expr = _: 1; expected = 2;}";
    unmatched-assertion = ''{fails = "no such assertion";}'';
    no-throw = "{expr = _: 1; fails = true;}";
    unknown-field = "{expr = _: 1; expected = 1; expectd = 1;}";
    ambiguous = ''{expr = _: 1; expected = 1; fails = "x";}'';
    neither = "{expr = _: 1;}";
    # Without `uses`, the dependency stays outside the fixture.
    missing-use = "{modules.reader.hjem.always = {config, ...}: {files.reader.text = config.myconfig.dependency.value or (throw \"missing\");}; expr = result: map (file: file.target) result.manifest.files; expected = [];}";
  };

  configuration = compose ([
      ./subject.nix
      ./dependency.nix
    ]
    ++ lib.mapAttrsToList failing failingModules);

  checks = import ../../lib/module-tests.nix {inherit lib;} {
    inherit compose configuration pkgs system;
    infrastructure = [];
  };

  evaluates = check: (builtins.tryEval (builtins.deepSeq check.drvPath true)).success;
in
  assert lib.assertMsg (builtins.attrNames checks == lib.sort lib.lessThan (["module-subject"] ++ map (name: "module-${name}") (builtins.attrNames failingModules)))
  "Exactly the modules with test cases must yield a check";
  assert lib.assertMsg (evaluates checks.module-subject)
  "A module whose cases hold must yield a check that evaluates";
  assert lib.assertMsg (lib.all (name: !(evaluates checks."module-${name}")) (builtins.attrNames failingModules))
  "A case that does not hold must fail its module's check";
    checks.module-subject
