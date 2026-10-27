{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "users";
  meta.description = "Apply the host's declared user information to OS user configuration.";

  darwin.always = {
    system.primaryUser = myconfig.host.user.name;
    users = {
      knownUsers = [myconfig.host.user.name];
      users.${myconfig.host.user.name} = {
        inherit (myconfig.host.user) uid;
        home = myconfig.host.user.homeDirectory;
      };
    };
    system.defaults.smb.NetBIOSName = myconfig.host.user.name;
  };

  checks = _: {
    known-user = {
      uses = ["host" "nixpkgs"];
      host.user.uid = 502;
      moduleSystem = "darwin";
      expr = result: {
        inherit (result.config.users.users.fixture) uid;
        known = lib.elem "fixture" result.config.users.knownUsers;
      };
      expected = {
        uid = 502;
        known = true;
      };
    };
  };
})
