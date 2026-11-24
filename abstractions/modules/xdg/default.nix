{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  kinds = {
    cache = "XDG_CACHE_HOME";
    config = "XDG_CONFIG_HOME";
    data = "XDG_DATA_HOME";
    state = "XDG_STATE_HOME";
  };
in {
  name = "xdg";
  tests.fixture = ["host"];
  meta.description = "Define the user's XDG base directories and export them to the user's environment.";

  options = with delib; let
    home = myconfig.host.user.homeDirectory;
  in {
    enable = boolOption true;
    cache = readOnly (strOption "${home}/.cache");
    config = readOnly (strOption "${home}/.config");
    data = readOnly (strOption "${home}/.local/share");
    state = readOnly (strOption "${home}/.local/state");
  };

  hjem.ifEnabled = {
    xdg = lib.mapAttrs (kind: _: {directory = cfg.${kind};}) kinds;
    environment.sessionVariables = lib.mapAttrs' (kind: variable: lib.nameValuePair variable cfg.${kind}) kinds;
  };
})
