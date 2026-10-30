{
  delib,
  config,
  lib,
  ...
}: let
  inherit (config) host;
in
  delib.module {
    name = "host";
    meta.description = "Expose the selected host's information to modules and reflect its identity in OS host names.";

    options = with delib; {
      name = readOnly (strOption host.name);
      # The reference evaluates a real system, so it names the source instead.
      system = readOnly (strOption host.system {defaultText = lib.literalMD "the host's `system`";});
      user = readOnly (attrsOption host.user {
        defaultText = lib.literalMD "the host's `user`";
        description = "The sole user of the host being built: `name`, `homeDirectory` and `uid`.";
      });
    };

    # Host-less operator commands find the host through `hostname -s`, so the OS names follow the Denix host name.
    darwin.always.networking = {
      hostName = host.name;
      computerName = host.name;
      localHostName = host.name;
    };
  }
