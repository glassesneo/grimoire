# Reaches the dependency through a module its case uses.
{delib, ...}:
delib.module {
  name = "case-user";
  meta.description = "Read the dependency through a module a case uses.";
  tests.cases = {home, ...}: {case = import ./reads-dependency.nix home // {uses = ["subject" "middle"];};};
}
