# Reaches the dependency through one of its fixture modules.
{delib, ...}:
delib.module {
  name = "requirer";
  meta.description = "Read the dependency through a fixture module.";
  tests.fixture = ["middle" "subject"];
  tests.cases = {home, ...}: {case = import ./reads-dependency.nix home;};
}
