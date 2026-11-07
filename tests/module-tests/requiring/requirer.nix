# Reaches the dependency through a module it requires.
{delib, ...}:
delib.module {
  name = "requirer";
  requires = ["subject" "middle"];
  meta.description = "Read the dependency through a required module.";
  tests = {home, ...}: {case = import ./reads-dependency.nix home;};
}
