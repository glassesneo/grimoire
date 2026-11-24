{
  inputs,
  denix,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;

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

  failing = name: case:
    builtins.toFile "${name}.nix" ''
      {delib, ...}:
      delib.module {
        name = "${name}";
        meta.description = "Hold a test case that must not hold.";
        tests.cases = _: {case = {protects = "fixture";} // ${case};};
      }
    '';

  failingModules = {
    mismatch = "{expr = _: 1; expected = 2;}";
    unmatched-constraint = ''{fails = "no such constraint";}'';
    no-throw = "{expr = _: 1; fails = true;}";
    ambiguous = ''{expr = _: 1; expected = 1; fails = "x";}'';
    neither = "{expr = _: 1;}";
    no-expr = "{expected = 1;}";
    false-fails = "{expr = _: 1; fails = false;}";
    null-fails = "{expr = _: 1; fails = null;}";
    non-derivation = "{build = _: 1;}";
    build-expr = "{build = _: throw \"not forced\"; expr = _: 1;}";
    build-expected = "{build = _: throw \"not forced\"; expected = 1;}";
    missing-use = "{modules.reader.hjem.always = {config, ...}: {files.reader.text = config.myconfig.dependency.value or (throw \"missing\");}; expr = result: map (file: file.target) result.manifest.files; expected = [];}";
  };

  configuration = compose ([
      ./subject.nix
      ./dependency.nix
    ]
    ++ lib.mapAttrsToList failing failingModules);

  home = "/tmp/module-tests";
  infoFor = configuration:
    configuration.config.moduleTestInfo {
      inherit pkgs system home;
      root = ../..;
      oxlintConfig = ../../.oxlintrc.json;
      typescriptCheck = _: throw "module-tests fixtures do not type-check TypeScript";
    };
  checksFor = configuration: compose:
    import ../../lib/module-tests.nix {inherit lib;} {
      inherit compose pkgs system home;
      info = infoFor configuration;
    };
  checks = checksFor configuration compose;

  evaluates = check: (builtins.tryEval (builtins.deepSeq check.drvPath true)).success;
  graphModule = name: uses: platforms: {delib, ...}:
    delib.module {
      inherit name;
      meta.description = "Exercise conservative dependency closure.";
      tests.cases = _: {
        edge = {
          protects = "fixture";
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
  graphChecks = checksFor graphConfiguration (_: throw "fixture generated during graph discovery");
  unknownGraph = infoFor (compose [(graphModule "unknown" ["absent"] [system])]);
  unknownField = infoFor (compose [(failing "unknown-field" "{expr = _: 1; expected = 1; expectd = 1;}")]);
  undocumented = infoFor (compose [
    ({delib, ...}:
      delib.module {
        name = "undocumented";
        meta.description = "Hold a case without protects.";
        tests.cases = _: {
          case = {
            expr = _: 1;
            expected = 1;
          };
        };
      })
  ]);
  fixtureConfiguration = compose [
    ./subject.nix
    ./dependency.nix
    ./fixture/middle.nix
    ./fixture/requirer.nix
    ./fixture/case-user.nix
  ];
  fixtures = infoFor fixtureConfiguration;
  fixtureChecks = checksFor fixtureConfiguration compose;
  unknownFixture = infoFor (compose [
    ({delib, ...}:
      delib.module {
        name = "unknown-fixture";
        tests.fixture = ["absent"];
        meta.description = "Name a fixture module that does not exist.";
      })
  ]);
  coverage = (infoFor configuration).subject.tsRoots;
  lazyChecks = checksFor configuration (_: throw "fixture generated while discovering names");
  coverageRoots = path:
    (infoFor (compose [
      ({delib, ...}:
        delib.module {
          name = "coverage";
          meta.description = "Exercise invalid coverage roots.";
          tests.cases = _: {
            case = {
              protects = "fixture";
              tsRoots = [path];
              platforms = [];
              build = _: throw "excluded";
            };
          };
        })
    ])).coverage.tsRoots;
  failingConfiguration = compose [
    (builtins.toFile "failing-build.nix" ''
      {delib, ...}: delib.module {
        name = "build-failure";
        meta.description = "Exercise aggregate builder failure.";
        tests.cases = {pkgs, ...}: {
          failure = {
            protects = "fixture";
            build = _: pkgs.runCommand "intentional-module-failure" {} "exit 1";
          };
        };
      }
    '')
  ];
  failingAggregate = (checksFor failingConfiguration compose).module-build-failure;
in {
  inherit failingAggregate;
  cases = {
    platform-excluded-module-yields-no-check = {
      protects = "a module none of whose cases applies to the system yields no check, and check discovery does not generate fixtures";
      expr = graphChecks ? module-branch;
      expected = false;
    };
    affected-checks-close-over-uses = {
      protects = "a change to a module selects every module that uses it, through cycles, duplicates and modules without an applicable case";
      expr = graph.c.affectedChecks;
      expected = ["module-a" "module-b" "module-c" "module-leaf"];
    };
    unknown-use-fails = {
      protects = "a case that uses a module that does not exist fails discovery";
      expr = unknownGraph.unknown.affectedChecks;
      fails = true;
    };
    unknown-fixture-module-fails = {
      protects = "a module that names a fixture module that does not exist fails discovery";
      expr = unknownFixture.unknown-fixture.affectedChecks;
      fails = true;
    };
    fixture-holds-transitive-modules = {
      protects = "a fixture holds the module's fixture modules and its case's uses, with their own fixture modules, transitively";
      expr = {
        requirer = evaluates fixtureChecks.module-requirer;
        case-user = evaluates fixtureChecks.module-case-user;
      };
      expected = {
        requirer = true;
        case-user = true;
      };
    };
    change-selects-transitive-fixture-users = {
      protects = "a change to a module selects the modules whose fixtures load it, transitively";
      expr = fixtures.dependency.affectedChecks;
      expected = ["module-case-user" "module-requirer" "module-subject"];
    };
    unknown-case-field-fails = {
      protects = "a case with an unknown field is a declaration error rejected when the cases are discovered";
      expr = builtins.attrNames unknownField.unknown-field.applicableCases;
      fails = true;
    };
    case-without-protects-fails = {
      protects = "a case that does not state what it protects is rejected when the cases are discovered";
      expr = builtins.attrNames undocumented.undocumented.applicableCases;
      fails = true;
    };
    check-names-need-no-fixture = {
      protects = "module check names are discovered from declarations alone, without generating any fixture";
      expr = builtins.attrNames lazyChecks;
      expected = builtins.attrNames checks;
    };
    coverage-roots-normalized = {
      protects = "a case's coverage roots are normalized to repository-relative paths";
      expr = coverage;
      expected = ["tests/module-tests" "tests/module-tests/sub/nested"];
    };
    coverage-root-outside-repository-fails = {
      protects = "a coverage root that leaves the module's directory is rejected";
      expr = coverageRoots "../outside";
      fails = true;
    };
    absolute-coverage-root-fails = {
      protects = "an absolute coverage root is rejected";
      expr = coverageRoots "/absolute";
      fails = true;
    };
    failing-builder-aggregate-evaluates = {
      protects = "a module whose builder fails still yields an aggregate check that evaluates, so the failure surfaces when it is built";
      expr = evaluates failingAggregate;
      expected = true;
    };
    modules-with-cases-yield-checks = {
      protects = "exactly the modules with test cases yield a check";
      expr = builtins.attrNames checks;
      expected = lib.sort lib.lessThan (["module-subject"] ++ map (name: "module-${name}") (builtins.attrNames failingModules));
    };
    holding-cases-check-evaluates = {
      protects = "a module whose cases hold yields a check that evaluates";
      expr = evaluates checks.module-subject;
      expected = true;
    };
    non-holding-case-fails-check = {
      protects = "a case that does not hold, has an invalid mode, a non-derivation build or a missing use fails its module's check";
      expr = lib.filter (name: evaluates checks."module-${name}") (builtins.attrNames failingModules);
      expected = [];
    };
    holding-cases-check-builds = {
      protects = "successful fixture values and builds reach one aggregate check that builds";
      build = checks.module-subject;
    };
  };
}
