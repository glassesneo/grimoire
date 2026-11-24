{delib, ...}:
delib.role ({
  cfg,
  myconfig,
  ...
}: let
  inherit (cfg.held) package;
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
