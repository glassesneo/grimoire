# Descriptor discovery must not force check bodies or derivation metadata.
# `descriptors` come from `checks/` and `testDescriptors` from `tests/`; a name
# may appear in only one group.
{lib}: {
  descriptors,
  testDescriptors ? {},
  moduleChecks ? {},
  extraChecks ? {},
  system,
}: let
  groups = [descriptors testDescriptors moduleChecks extraChecks];
  names = lib.concatMap builtins.attrNames groups;
  collisions = lib.filter (name: builtins.length (lib.filter (other: other == name) names) > 1) (lib.unique names);
  availableIn = lib.filterAttrs (_: descriptor: lib.elem system (descriptor.platforms or lib.platforms.all));
  available = availableIn descriptors;
  availableTests = availableIn testDescriptors;
in
  assert lib.assertMsg (collisions == []) "Check name collisions: ${toString collisions}"; {
    directoryNames = builtins.attrNames available;
    testNames = builtins.attrNames availableTests;
    checks = builtins.mapAttrs (_: descriptor: descriptor.check) (available // availableTests) // moduleChecks // extraChecks;
    checkNames = lib.sort lib.lessThan (builtins.attrNames available ++ builtins.attrNames availableTests ++ builtins.attrNames moduleChecks ++ builtins.attrNames extraChecks);
  }
