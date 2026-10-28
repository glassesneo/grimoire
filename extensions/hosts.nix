# Owns the host attributes: system and its sole user.
# `flake.nix` publishes configurations from these attributes; the host module
# exposes them to other modules through the read-only view `myconfig.host`.
{
  delib,
  lib,
  ...
}: {
  settings.hosts.extraSubmodules = {config, ...}: let
    isDarwin = (lib.systems.elaborate config.system).isDarwin;
  in
    with delib; {
      options = {
        system = description strOption "Nix system of this host.";

        user = lib.mkOption {
          type = submodule ({config, ...}: {
            options = {
              name = description strOption "Unix account name of the person using this host.";
              homeDirectory =
                description
                (defaultText (strOption (
                  if isDarwin
                  then "/Users/${config.name}"
                  else "/home/${config.name}"
                )) (lib.literalMD "`/Users/<name>` on Darwin, otherwise `/home/<name>`"))
                "Home directory of the user on this host.";
              uid =
                description
                (defaultText (intOption (
                  if isDarwin
                  then 501
                  else 1000
                )) (lib.literalMD "501 on Darwin, otherwise 1000"))
                "Numeric user ID of the user's account on this host.";
            };
          });
          description = "The sole user of this host.";
        };
      };
    };
}
