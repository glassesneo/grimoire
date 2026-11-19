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
  # A candidate provides the shell as `package`.
  package = lib.getAttrFromPath (lib.splitString "." cfg.holder ++ ["package"]) myconfig;
in {
  name = "login-shell";
  meta.description = "Seat the user's login shell and register it with the system.";

  darwin.ifEnabled = {
    environment.shells = [package];

    users.users.${myconfig.host.user.name} = {
      ignoreShellProgramCheck = true;
      shell = package;
    };
  };
})
