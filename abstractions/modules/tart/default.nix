# Tart keeps its machines under ~/.tart/vms, and SSH reaches any of them by
# its name without a declaration of its own: machines come and go, and the
# configuration says only what to trust, such as the hosts
# `ssh.keyholder.remoteHosts` lends the person's keys to.
{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "tart";
  tests.fixture = ["ssh"];
  meta.description = "Provide Tart and reach each of its virtual machines over SSH by name, starting one that is not running.";

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      package = packageOption pkgs.tart;
    };

  constraints.ifEnabled = [
    {
      assertion = lib.hasSuffix "-darwin" myconfig.host.system;
      message = "tart.enable = true requires a Darwin host";
    }
  ];

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    tart = lib.getExe cfg.package;
    logDirectory = "${config.xdg.cache.directory}/tart";
    # Connects SSH to port $2 of machine $1, starting the machine first if it is
    # not running. `tart ip` answers from the DHCP lease, which outlives the
    # machine, and a booting machine accepts connections before its sshd answers
    # them, so the address counts only once the port greets with `SSH-`. A
    # machine that had to boot greets about a second before it accepts keys,
    # so a connection that waited also waits a little after the greeting.
    proxy = pkgs.writeShellScript "tart-proxy" ''
      set -eu
      name=$1 port=$2
      if ! ${tart} get "$name" | /usr/bin/grep -qw running; then
        mkdir -p ${lib.escapeShellArg logDirectory}
        nohup ${tart} run --no-graphics "$name" \
          </dev/null >>${lib.escapeShellArg logDirectory}/"$name".log 2>&1 &
      fi
      deadline=$((SECONDS + 120))
      greets() {
        [ "$(/usr/bin/nc -G 2 -w 2 "$1" "$port" </dev/null 2>/dev/null | head -c 4)" = SSH- ]
      }
      waited=false
      until address=$(${tart} ip "$name" 2>/dev/null) && greets "$address"; do
        waited=true
        if [ "$SECONDS" -ge "$deadline" ]; then
          echo "tart: $name did not answer SSH on port $port within 120 s" >&2
          exit 1
        fi
        sleep 1
      done
      if [ "$waited" = true ]; then sleep 3; fi
      exec /usr/bin/nc "$address" "$port"
    '';
  in {
    nixpkgs.config.allowUnfreePackages = ["tart"];
    packages = [cfg.package];

    # %n is the name as given, before any HostName applies.
    ssh.matches.tart = {
      criteria = ''exec "test -d ~/.tart/vms/'%n'"'';
      parameters.ProxyCommand = "${proxy} %n %p";
    };
  };
})
