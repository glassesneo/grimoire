{delib, ...}:
delib.module {
  name = "tailscale";
  meta.description = "Join the host to the person's tailnet through Tailscale's daemon, which runs from boot without a login session.";

  options = with delib; {
    enable = boolOption false;
    tailnet = readOnly (strOption "marten-pierce.ts.net" "DNS name of the tailnet these hosts join. MagicDNS resolves a joined host as `<host name>.<tailnet>` from any other.");
  };

  # The daemon variant rather than the GUI app: launchd starts it at boot, and
  # the node key in /var/lib/tailscale keeps the host joined after the one
  # interactive `tailscale up`. No credential is declared here.
  darwin.ifEnabled = {
    services.tailscale.enable = true;
    # nix-darwin starts the daemon only at load, and a host reached only over
    # the tailnet has no other way in to start it again.
    launchd.daemons.tailscaled.serviceConfig.KeepAlive = true;
    # tailscaled writes /etc/resolver itself and refuses to write through
    # nix-darwin's link into the store ("path escapes from parent"), which
    # leaves its DNS configuration reported as failed.
    environment.etc."resolver/ts.net".enable = false;
  };
}
