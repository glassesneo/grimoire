{delib, ...}:
delib.module {
  name = "tailscale";
  meta.description = "Join the host to the person's tailnet through Tailscale's daemon, which runs from boot without a login session.";

  options = with delib; {
    enable = boolOption false;
    tailnet = readOnly (strOption "marten-pierce.ts.net" "DNS name of the tailnet these hosts join. MagicDNS resolves a joined host as `<host name>.<tailnet>` from any other.");
  };

  darwin.ifEnabled = {
    services.tailscale.enable = true;
    launchd.daemons.tailscaled.serviceConfig.KeepAlive = true;
    environment.etc."resolver/ts.net".enable = false;
  };
}
