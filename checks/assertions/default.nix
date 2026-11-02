{
  configuration,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # The real composition must enforce modules' common assertions in Hjem's
  # guard: `always` whatever the module's enable, `ifEnabled` only while it is
  # enabled. Adapter-only checks cannot detect missing wiring.
  probe = hostName: user: {
    enable,
    always ? true,
    ifEnabled ? true,
  }:
    (configuration.extendModules {
      modules = [
        ({delib, ...}:
          delib.module {
            name = "assertion-probe";
            meta.description = "Declare common assertions.";
            options.enable = delib.boolOption enable;
            assertions = {
              always = [
                {
                  assertion = always;
                  message = "Assertion probe (always)";
                }
              ];
              ifEnabled = [
                ({cfg, ...}: {
                  assertion = ifEnabled && cfg.enable;
                  message = "Assertion probe (ifEnabled)";
                })
              ];
            };
          })
      ];
    }).genSystem {
      moduleSystem = "hjem";
      host = hostName;
      extraArgs = {
        system = configuration.config.hosts.${hostName}.system;
        username = user.name;
        inherit (user) homeDirectory;
      };
    };

  accepts = result: (builtins.tryEval result.manifest).success;

  results = lib.mapAttrsToList (hostName: host: let
    run = probe hostName host.user;
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
  configuration.config.hosts;
in {
  check = assert lib.assertMsg (results != [] && lib.all (result: result) results)
  "Real host configurations must enforce `always` assertions and enabled modules' `ifEnabled` assertions";
    pkgs.runCommand "assertion-forwarding-test" {} ''
      mkdir "$out"
    '';
}
