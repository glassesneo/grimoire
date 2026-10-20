# Descriptor discovery must not force check bodies or derivation metadata.
{lib}: {
  descriptors,
  moduleChecks ? {},
  extraChecks ? {},
  system,
}: let
  groups = [descriptors moduleChecks extraChecks];
  names = lib.concatMap builtins.attrNames groups;
  collisions = lib.filter (name: builtins.length (lib.filter (other: other == name) names) > 1) (lib.unique names);
  available = lib.filterAttrs (_: descriptor: lib.elem system (descriptor.platforms or lib.platforms.all)) descriptors;
in
  assert lib.assertMsg (collisions == []) "Check name collisions: ${toString collisions}"; {
    directoryNames = builtins.attrNames available;
    checks = builtins.mapAttrs (_: descriptor: descriptor.check) available // moduleChecks // extraChecks;
    checkNames = lib.sort lib.lessThan (builtins.attrNames available ++ builtins.attrNames moduleChecks ++ builtins.attrNames extraChecks);
  }
