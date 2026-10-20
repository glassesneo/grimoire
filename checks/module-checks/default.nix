{
  inputs,
  denix,
  pkgs,
  system,
}: let
  lib = pkgs.lib;

  # Keep the runner's repository-owned boundary: successful fixture values and
  # builds reach one aggregate; invalid modes, missing uses and mismatches fail
  # evaluation. Also cover declaration-only discovery, conservative closure and
  # coverage normalization: Nix types alone cannot detect those regressions.
  # Builder failure is exercised externally through failingAggregate below.
  compose = abstractions:
    denix.lib.denixConfiguration {
      extraInputs = inputs;
      modules =
        [
          ../../adapters/hjem
          ../../extensions/hosts.nix
          ../../extensions/module-metadata.nix
          ../../extensions/module-checks.nix
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
        checks = _: {case = ${case};};
      }
    '';

  failingModules = {
    mismatch = "{expr = _: 1; expected = 2;}";
    unmatched-assertion = ''{fails = "no such assertion";}'';
    no-throw = "{expr = _: 1; fails = true;}";
    unknown-field = "{expr = _: 1; expected = 1; expectd = 1;}";
    ambiguous = ''{expr = _: 1; expected = 1; fails = "x";}'';
    neither = "{expr = _: 1;}";
    no-expr = "{expected = 1;}";
    false-fails = "{expr = _: 1; fails = false;}";
    null-fails = "{expr = _: 1; fails = null;}";
    non-derivation = "{build = _: 1;}";
    build-expr = "{build = _: throw \"not forced\"; expr = _: 1;}";
    build-expected = "{build = _: throw \"not forced\"; expected = 1;}";
    # Without `uses`, the dependency stays outside the fixture.
    missing-use = "{modules.reader.hjem.always = {config, ...}: {files.reader.text = config.myconfig.dependency.value or (throw \"missing\");}; expr = result: map (file: file.target) result.manifest.files; expected = [];}";
  };

  configuration = compose ([
      ./subject.nix
      ./dependency.nix
    ]
    ++ lib.mapAttrsToList failing failingModules);

  checks = import ../../lib/module-checks.nix {inherit lib;} {
    inherit compose configuration pkgs system;
    infrastructure = [];
  };

  evaluates = check: (builtins.tryEval (builtins.deepSeq check.drvPath true)).success;
  infoFor = configuration:
    configuration.config.moduleCheckInfo {
      inherit pkgs system;
      home = "/tmp/module-checks";
      root = ../..;
      oxlintConfig = ../../.oxlintrc.json;
      infrastructure = [];
    };
  graphModule = name: uses: platforms: {delib, ...}:
    delib.module {
      inherit name;
      meta.description = "Exercise conservative dependency closure.";
      checks = _: {
        edge = {
          inherit uses platforms;
          expr = _: true;
          expected = true;
        };
      };
    };
  graphConfiguration = compose [
    (graphModule "a" ["a" "b" "b"] [system])
    (graphModule "b" ["c"] [system])
    (graphModule "c" ["a"] [system])
    (graphModule "branch" ["c"] [])
    (graphModule "leaf" ["branch"] [system])
  ];
  graph = infoFor graphConfiguration;
  graphChecks = import ../../lib/module-checks.nix {inherit lib;} {
    inherit pkgs system;
    configuration = graphConfiguration;
    infrastructure = [];
    compose = _: throw "fixture generated during graph discovery";
  };
  unknownGraph = infoFor (compose [(graphModule "unknown" ["absent"] [system])]);
  coverage = (infoFor configuration).subject.tsRoots;
  lazyChecks = import ../../lib/module-checks.nix {inherit lib;} {
    inherit configuration pkgs system;
    infrastructure = [];
    compose = _: throw "fixture generated while discovering names";
  };
  invalidRoot = path:
    (builtins.tryEval (builtins.deepSeq
      (infoFor (compose [
        ({delib, ...}:
          delib.module {
            name = "coverage";
            meta.description = "Exercise invalid coverage roots.";
            checks = _: {
              case = {
                tsRoots = [path];
                platforms = [];
                build = _: throw "excluded";
              };
            };
          })
      ])).coverage.tsRoots
      true)).success;
  failingConfiguration = compose [
    (builtins.toFile "failing-build.nix" ''
      {delib, ...}: delib.module {
        name = "build-failure";
        meta.description = "Exercise aggregate builder failure.";
        checks = {pkgs, ...}: {failure.build = _: pkgs.runCommand "intentional-module-failure" {} "exit 1";};
      }
    '')
  ];
  failingAggregate =
    (import ../../lib/module-checks.nix {inherit lib;} {
      inherit compose pkgs system;
      configuration = failingConfiguration;
      infrastructure = [];
    }).module-build-failure;
in {
  # Intentionally not published under flake checks. Build this descriptor field
  # externally to observe the returned builder failing through its aggregate.
  inherit failingAggregate;
  check = assert !(graphChecks ? module-branch);
  assert graph.c.affectedChecks == ["module-a" "module-b" "module-c" "module-leaf"];
  assert !(builtins.tryEval (builtins.deepSeq unknownGraph.unknown.affectedChecks true)).success;
  assert builtins.attrNames lazyChecks == builtins.attrNames checks;
  assert coverage == ["checks/module-checks" "checks/module-checks/sub/nested"];
  assert !(invalidRoot "../outside");
  assert !(invalidRoot "/absolute");
  assert evaluates failingAggregate;
  assert lib.assertMsg (builtins.attrNames checks == lib.sort lib.lessThan (["module-subject"] ++ map (name: "module-${name}") (builtins.attrNames failingModules)))
  "Exactly the modules with test cases must yield a check";
  assert lib.assertMsg (evaluates checks.module-subject)
  "A module whose cases hold must yield a check that evaluates";
  assert lib.assertMsg (lib.all (name: !(evaluates checks."module-${name}")) (builtins.attrNames failingModules))
  "A case that does not hold must fail its module's check";
    checks.module-subject;
}
