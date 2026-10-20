# Nix types cannot protect discovery laziness: poison bodies must remain dormant
# until selected, while names, platform filtering and collisions stay observable.
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
    moduleChecks.module-poison = poison;
    extraChecks.formatting = poison;
  };
  collision = extra:
    (builtins.tryEval (builtins.deepSeq
      (discover ({
          inherit system;
          descriptors.same = {
            platforms = [];
            check = poison;
          };
        }
        // extra)).checkNames
      true)).success;
in {
  check = assert found.checkNames == ["formatting" "module-poison" "poison" "selected"];
  assert found.directoryNames == ["poison" "selected"];
  assert !(builtins.tryEval found.checks.poison).success;
  assert !(collision {moduleChecks.same = poison;});
  assert !(collision {extraChecks.same = poison;});
    found.checks.selected;
}
