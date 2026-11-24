{pkgs, ...}: let
  inherit (pkgs) lib;
  cases = import ../../lib/cases.nix {inherit lib;};
  check = set:
    (cases.check {
      inherit pkgs;
      name = "probe";
      cases = set;
    }).drvPath;
in {
  cases = {
    holding-cases-yield-a-check = {
      protects = "cases whose expressions, failures and builds hold yield a check";
      expr = builtins.isString (check {
        equal = {
          protects = "probe";
          expr = 1;
          expected = 1;
        };
        failing = {
          protects = "probe";
          expr = throw "expected";
          fails = true;
        };
        built = {
          protects = "probe";
          build = pkgs.emptyFile;
        };
      });
      expected = true;
    };
    missing-protects-fails = {
      protects = "a case that does not state what it protects fails its check";
      expr = check {
        a = {
          expr = 1;
          expected = 1;
        };
      };
      fails = true;
    };
    mismatch-fails = {
      protects = "a case whose expression differs from the expected value fails its check";
      expr = check {
        a = {
          protects = "probe";
          expr = 1;
          expected = 2;
        };
      };
      fails = true;
    };
    unexpected-success-fails = {
      protects = "a case that expects a failure fails its check when the expression evaluates";
      expr = check {
        a = {
          protects = "probe";
          expr = 1;
          fails = true;
        };
      };
      fails = true;
    };
    several-modes-fail = {
      protects = "a case with more or fewer than one mode fails its check";
      expr = check {
        a = {
          protects = "probe";
          expr = 1;
          expected = 1;
          fails = true;
        };
      };
      fails = true;
    };
  };
}
