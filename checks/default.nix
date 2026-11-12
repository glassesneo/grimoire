# Immediate directories of `checks/` and `tests/` return lazy
# {platforms?, check} descriptors. `outputs` checks that the current system's
# packages, development shells and formatter evaluate to derivations; for each
# host of the current system, `host-<name>-hjem` checks that its Hjem
# configuration has no failed assertion and its manifest and preflight
# evaluate, and
# `host-<name>-darwin`, for a nix-darwin host, that its system evaluates. None
# builds what it evaluates.
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
  oxlintConfig = ../.oxlintrc.json;
  moduleTestInfo = configuration.config.moduleTestInfo {
    inherit pkgs system home oxlintConfig;
    typescriptCheck = import ../lib/typescript-check.nix {
      inherit pkgs oxlintConfig;
      bun2nix = inputs.bun2nix.packages.${system}.default;
    };
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
    pkgs.runCommandLocal "${name}-check" {
      derivations = map (derivation: builtins.unsafeDiscardOutputDependency derivation.drvPath) derivations;
    } ''
      touch "$out"
    '';
  hostDirectory = name: "abstractions/hosts/${name}";
  # One check per published configuration, so a host's Hjem and nix-darwin
  # evaluations run in parallel. nix-darwin fails its own evaluation on a
  # failed assertion; Hjem reports them in `failedAssertions`.
  hostCheckSets = lib.mapAttrs (name: host:
    assert lib.assertMsg (builtins.pathExists (../. + "/${hostDirectory name}")) "Host ${name} is not declared in ${hostDirectory name}";
      {
        "host-${name}-hjem" = assert lib.assertMsg (host.hjem.failedAssertions == []) "Host ${name} fails Hjem assertions:\n${lib.concatStringsSep "\n" host.hjem.failedAssertions}";
        # The Hjem CLI reads the manifest as JSON; preflight does not force it.
          builtins.seq (builtins.toJSON host.hjem.manifest) (evaluated "host-${name}-hjem" [host.hjem.preflight]);
      }
      // lib.optionalAttrs (host.darwin != null) {
        "host-${name}-darwin" = evaluated "host-${name}-darwin" [host.darwin.config.system.build.toplevel];
      })
  hosts;
  hostChecks = lib.concatMapAttrs (_: checks: checks) hostCheckSets;
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
        inherit (module) directory affectedChecks;
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
    hostChecks = lib.concatLists (lib.mapAttrsToList (name: checks:
      map (check: {
        name = check;
        directory = hostDirectory name;
      }) (builtins.attrNames checks))
    hostCheckSets);
    inherit (discovered) checkNames;
  };
}
