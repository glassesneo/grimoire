{
  configuration,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # The real composition must enforce modules' constraints in every
  # host's Hjem guard and in nix-darwin's assertions: `always` whatever the
  # module's enable, `ifEnabled` only while it is enabled. Adapter-only checks
  # cannot detect missing wiring.
  probe = moduleSystem: hostName: user: {
    enable,
    always ? true,
    ifEnabled ? true,
  }:
    (configuration.extendModules {
      modules = [
        ({delib, ...}:
          delib.module {
            name = "constraint-probe";
            meta.description = "Declare common constraints.";
            options.enable = delib.boolOption enable;
            constraints = {
              always = [
                {
                  assertion = always;
                  message = "Constraint probe (always)";
                }
              ];
              ifEnabled = [
                ({cfg, ...}: {
                  assertion = ifEnabled && cfg.enable;
                  message = "Constraint probe (ifEnabled)";
                })
              ];
            };
          })
      ];
    }).genSystem ({
        inherit moduleSystem;
        host = hostName;
      }
      // lib.optionalAttrs (moduleSystem == "hjem") {
        extraArgs = {
          system = configuration.config.hosts.${hostName}.system;
          username = user.name;
          inherit (user) homeDirectory;
        };
      });

  # nix-darwin refuses its system build on any failed assertion; evaluating
  # that build for every case would cost a full system evaluation each.
  acceptance = {
    hjem = result: (builtins.tryEval result.manifest).success;
    darwin = result: lib.all (assertion: assertion.assertion) result.config.assertions;
  };

  darwinHosts = lib.filterAttrs (_: host: (lib.systems.elaborate host.system).isDarwin) configuration.config.hosts;

  verify = moduleSystem: hosts:
    lib.mapAttrsToList (hostName: host: let
      run = probe moduleSystem hostName host.user;
      accepts = acceptance.${moduleSystem};
    in
      accepts (run {enable = true;})
      && !(accepts (run {
        enable = true;
        always = false;
      }))
      && !(accepts (run {
        enable = false;
        always = false;
      }))
      && !(accepts (run {
        enable = true;
        ifEnabled = false;
      }))
      && accepts (run {
        enable = false;
        ifEnabled = false;
      }))
    hosts;

  hjemResults = verify "hjem" configuration.config.hosts;
  darwinResults = verify "darwin" darwinHosts;
in {
  check = assert lib.assertMsg (hjemResults != [] && lib.all lib.id hjemResults)
  "Real Hjem configurations must enforce `always` constraints and enabled modules' `ifEnabled` constraints";
  assert lib.assertMsg (lib.all lib.id darwinResults)
  "Real nix-darwin configurations must enforce `always` constraints and enabled modules' `ifEnabled` constraints";
    pkgs.runCommand "constraint-forwarding-test" {} ''
      mkdir "$out"
    '';
}
