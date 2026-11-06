{
  configuration,
  pkgs,
  ...
}: let
  inherit (pkgs) lib;

  # The real composition must enforce modules' constraints in the Hjem guard
  # and in nix-darwin's assertions: `always` whatever the module's enable,
  # `ifEnabled` only while it is enabled. Adapter-only checks cannot detect
  # missing wiring. Hosts share that wiring, so one real host, a nix-darwin one
  # where there is one, is evaluated per module system with an enabled and a
  # disabled probe whose constraints all fail, reading which messages fail;
  # tests/hjem covers the guard that blocks outputs on them, and each host's
  # own check covers that its configuration has no failed assertion.
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
    # nix-darwin refuses its system build on any failed assertion; the
    # assertions themselves are read instead.
    else map (assertion: assertion.message) (lib.filter (assertion: !assertion.assertion) result.config.assertions);

  expected = ["probe-off (always)" "probe-on (always)" "probe-on (ifEnabled)"];
  probes = messages: lib.sort lib.lessThan (lib.filter (lib.hasPrefix "probe-") messages);

  inherit (configuration.config) hosts;
  darwinHosts = lib.filterAttrs (_: host: (lib.systems.elaborate host.system).isDarwin) hosts;
  representative = lib.head (builtins.attrNames darwinHosts ++ builtins.attrNames hosts);

  verify = moduleSystem: hostName: probes (failed moduleSystem hostName hosts.${hostName}.user) == expected;

  hjemResults = [(verify "hjem" representative)];
  darwinResults = lib.optional (darwinHosts != {}) (verify "darwin" representative);
in {
  check = assert lib.assertMsg (hjemResults != [] && lib.all lib.id hjemResults)
  "Real Hjem configurations must enforce `always` constraints and enabled modules' `ifEnabled` constraints";
  assert lib.assertMsg (lib.all lib.id darwinResults)
  "Real nix-darwin configurations must enforce `always` constraints and enabled modules' `ifEnabled` constraints";
    pkgs.runCommand "constraint-forwarding-test" {} ''
      mkdir "$out"
    '';
}
