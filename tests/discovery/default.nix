{
  pkgs,
  system,
  ...
}: let
  inherit (pkgs) lib;
  discover = import ../../lib/checks.nix {inherit lib;};
  poison = throw "unselected check body";
  found = discover {
    inherit system;
    descriptors = {
      selected.check = pkgs.runCommand "discovery-selected" {} ''touch "$out"'';
      poison.check = poison;
      unsupported = {
        platforms = [];
        check = poison;
      };
    };
    testDescriptors.tested.check = poison;
    moduleChecks.module-poison = poison;
    extraChecks.formatting = poison;
  };
  collision = extra:
    (discover ({
        inherit system;
        descriptors.same = {
          platforms = [];
          check = poison;
        };
      }
      // extra)).checkNames;
in {
  cases = {
    check-names-without-bodies = {
      protects = "discovery lists every supported check name from all sources without evaluating any check body";
      expr = found.checkNames;
      expected = ["formatting" "module-poison" "poison" "selected" "tested"];
    };
    directory-names-filter-platforms = {
      protects = "discovery lists the check directories supported on the system without evaluating their bodies";
      expr = found.directoryNames;
      expected = ["poison" "selected"];
    };
    test-names-without-bodies = {
      protects = "discovery lists the test directories without evaluating their bodies";
      expr = found.testNames;
      expected = ["tested"];
    };
    selected-body-evaluated-on-selection = {
      protects = "a check's body stays dormant in discovery and is evaluated only when that check is selected";
      expr = found.checks.poison;
      fails = true;
    };
    module-check-collision-fails = {
      protects = "a module check named like a check directory, even an unsupported one, fails discovery";
      expr = collision {moduleChecks.same = poison;};
      fails = true;
    };
    test-collision-fails = {
      protects = "a test directory named like a check directory, even an unsupported one, fails discovery";
      expr = collision {testDescriptors.same.check = poison;};
      fails = true;
    };
    extra-check-collision-fails = {
      protects = "an extra check named like a check directory, even an unsupported one, fails discovery";
      expr = collision {extraChecks.same = poison;};
      fails = true;
    };
    selected-check-builds = {
      protects = "a selected check yields its own derivation, which builds";
      build = found.checks.selected;
    };
  };
}
