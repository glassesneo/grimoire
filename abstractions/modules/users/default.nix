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
})
