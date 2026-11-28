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

    ssh.matches.tart = let
      excluded = builtins.attrNames (lib.filterAttrs (_: params: params ? HostName) config.ssh.hosts);
    in {
      criteria = ''${lib.optionalString (excluded != []) "!host ${lib.concatStringsSep "," excluded} "}exec "test -d ~/.tart/vms/'%n'"'';
      parameters.ProxyCommand = "${proxy} %n %p";
    };
  };
})
