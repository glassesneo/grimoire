# Immediate directories of `checks/` and `tests/` return lazy
# {platforms?, check} descriptors. `outputs` checks that the current system's
# packages, development shells and formatter evaluate to derivations; each
# `host-<name>` checks that a host of the current system has no failed
# assertion and that its published Hjem preflight and nix-darwin system
# evaluate. Neither builds what it evaluates.
{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
  compose,
  authoringDocs,
  formatting,
  outputs,
  hosts,
}: let
  inherit (pkgs) lib;
  home = "/tmp/module-tests";
  moduleTestInfo = configuration.config.moduleTestInfo {
    inherit pkgs system home;
    oxlintConfig = ../.oxlintrc.json;
    root = ../.;
  };
  directoriesOf = root: lib.filterAttrs (name: type: type == "directory" && builtins.pathExists (root + "/${name}/default.nix")) (builtins.readDir root);
  descriptorsOf = root:
    builtins.mapAttrs (name: _:
      lib.callPackageWith {
        inherit inputs denix pkgs system configuration compose moduleTestInfo authoringDocs;
      } (root + "/${name}/default.nix") {})
    (directoriesOf root);
  moduleChecks = import ../lib/module-tests.nix {inherit lib;} {
    inherit compose pkgs system home;
    info = moduleTestInfo;
  };
  # Instantiating a derivation evaluates it; depending on the .drv file alone
  # keeps the check from building it.
  evaluated = name: derivations:
    pkgs.runCommand "${name}-check" {
      derivations = map (derivation: builtins.unsafeDiscardOutputDependency derivation.drvPath) derivations;
    } ''
      touch "$out"
    '';
  hostDirectory = name: "abstractions/hosts/${name}";
  hostChecks = lib.mapAttrs' (name: host:
    lib.nameValuePair "host-${name}" (
      assert lib.assertMsg (builtins.pathExists (../. + "/${hostDirectory name}")) "Host ${name} is not declared in ${hostDirectory name}";
      assert lib.assertMsg (host.hjem.failedAssertions == []) "Host ${name} fails assertions:\n${lib.concatStringsSep "\n" host.hjem.failedAssertions}";
        evaluated "host-${name}" ([host.hjem.preflight] ++ lib.optional (host.darwin != null) host.darwin.config.system.build.toplevel)
    ))
  hosts;
  discovered = import ../lib/checks.nix {inherit lib;} {
    inherit moduleChecks system;
    descriptors = descriptorsOf ./.;
    testDescriptors = descriptorsOf ../tests;
    extraChecks =
      {
        inherit formatting;
        outputs = evaluated "outputs" (builtins.attrValues outputs.packages ++ builtins.attrValues outputs.devShells ++ [outputs.formatter]);
      }
      // hostChecks;
  };
in {
  inherit (discovered) checks;
  metadata = {
    moduleRoots =
      lib.mapAttrsToList (name: module: {
        inherit name;
        inherit (module) directory infrastructure affectedChecks;
      })
      moduleTestInfo;
    directoryChecks =
      map (name: {
        inherit name;
        directory = "checks/${name}";
      })
      discovered.directoryNames
      ++ map (name: {
        inherit name;
        directory = "tests/${name}";
      })
      discovered.testNames;
    hostChecks =
      lib.mapAttrsToList (name: _: {
        name = "host-${name}";
        directory = hostDirectory name;
      })
      hosts;
    inherit (discovered) checkNames;
  };
}
