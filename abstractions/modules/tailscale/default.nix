{delib, ...}:
delib.module {
  name = "tailscale";
  meta.description = "Join the host to the person's tailnet through Tailscale's daemon, which runs from boot without a login session.";

  options = with delib; {
    enable = boolOption false;
    tailnet = readOnly (strOption "marten-pierce.ts.net" "DNS name of the tailnet these hosts join. MagicDNS resolves a joined host as `<host name>.<tailnet>` from any other.");
  };

  # The daemon rather than the GUI app: launchd starts it at boot, and its node
  # key keeps the host joined after one interactive `tailscale up`.
  darwin.ifEnabled = {
    services.tailscale.enable = true;
    launchd.daemons.tailscaled.serviceConfig.KeepAlive = true;
    # tailscaled writes /etc/resolver itself and refuses to write through a
    # store link ("path escapes from parent").
    environment.etc."resolver/ts.net".enable = false;
  };
}
