{
  delib,
  lib,
  ...
}:
delib.role ({
  cfg,
  myconfig,
  ...
}: let
  # A candidate provides the editor as `package`. EDITOR names its program
  # rather than a store path: the session keeps the value it logged in with,
  # and a path would go stale when the package is rebuilt.
  package = lib.getAttrFromPath (lib.splitString "." cfg.holder ++ ["package"]) myconfig;
in {
  name = "editor";
  enable = true;
  meta.description = "Seat the editor that programs open through `EDITOR`.";

  hjem.ifEnabled.environment.sessionVariables.EDITOR = package.meta.mainProgram or (lib.getName package);
})
