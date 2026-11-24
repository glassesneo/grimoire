{
  delib,
  lib,
  ...
}:
delib.role ({cfg, ...}: let
  # EDITOR names the program: a session keeps its login value, and a store path
  # would go stale after a rebuild.
  inherit (cfg.held) package;
in {
  name = "editor";
  enable = true;
  meta.description = "Seat the editor that programs open through `EDITOR`.";

  hjem.ifEnabled.environment.sessionVariables.EDITOR = package.meta.mainProgram or (lib.getName package);
})
