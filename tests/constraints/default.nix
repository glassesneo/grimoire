{
  configuration,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # The real composition must enforce modules' constraints in every
  # host's Hjem guard and in nix-darwin's assertions: `always` whatever the
  # module's enable, `ifEnabled` only while it is enabled. Adapter-only checks
  # cannot detect missing wiring. One evaluation per host declares an enabled
  # and a disabled probe whose constraints all fail, and reads which messages
  # fail; tests/hjem covers the guard that blocks outputs on them.
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

  darwinHosts = lib.filterAttrs (_: host: (lib.systems.elaborate host.system).isDarwin) configuration.config.hosts;

  verify = moduleSystem: hosts:
    lib.mapAttrsToList (hostName: host: probes (failed moduleSystem hostName host.user) == expected) hosts;

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
