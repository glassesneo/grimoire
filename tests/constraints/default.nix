{
  configuration,
  pkgs,
  ...
}: let
  inherit (pkgs) lib;

  probe = name: enable: {delib, ...}:
    delib.module {
      inherit name;
      meta.description = "Declare failing constraints.";
      options.enable = delib.boolOption enable;
      constraints = {
        always = [
          {
            assertion = false;
            message = "${name} (always)";
          }
        ];
        ifEnabled = [
          {
            assertion = false;
            message = "${name} (ifEnabled)";
          }
        ];
      };
    };

  probed = configuration.extendModules {
    modules = [(probe "probe-on" true) (probe "probe-off" false)];
  };

  failed = moduleSystem: hostName: user: let
    result = probed.genSystem ({
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
  in
    if moduleSystem == "hjem"
    then result.failedAssertions
    else map (assertion: assertion.message) (lib.filter (assertion: !assertion.assertion) result.config.assertions);

  expected = ["probe-off (always)" "probe-on (always)" "probe-on (ifEnabled)"];
  probes = messages: lib.sort lib.lessThan (lib.filter (lib.hasPrefix "probe-") messages);

  inherit (configuration.config) hosts;
  darwinHosts = lib.filterAttrs (_: host: (lib.systems.elaborate host.system).isDarwin) hosts;
  representative = lib.head (builtins.attrNames darwinHosts ++ builtins.attrNames hosts);

  observed = moduleSystem: probes (failed moduleSystem representative hosts.${representative}.user);
in {
  cases =
    {
      hjem-enforces-constraints = {
        protects = "the real Hjem composition forwards every module's always constraints and enabled modules' ifEnabled constraints to its failed assertions";
        expr = observed "hjem";
        inherit expected;
      };
    }
    // lib.optionalAttrs (darwinHosts != {}) {
      darwin-enforces-constraints = {
        protects = "the real nix-darwin composition forwards every module's always constraints and enabled modules' ifEnabled constraints to its assertions";
        expr = observed "darwin";
        inherit expected;
      };
    };
}
