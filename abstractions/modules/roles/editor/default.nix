{
  delib,
  lib,
  ...
}:
delib.role ({cfg, ...}: let
  inherit (cfg.held) package;
in {
  name = "editor";
  enable = true;
  meta.description = "Seat the editor that programs open through `EDITOR`.";

  hjem.ifEnabled.environment.sessionVariables.EDITOR = package.meta.mainProgram or (lib.getName package);
})
