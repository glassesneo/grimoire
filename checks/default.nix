{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
  compose,
  authoring,
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
  cases = import ../lib/cases.nix {inherit lib;};
  checkOf = name: descriptor:
    if descriptor ? cases
    then
      cases.check {
        inherit pkgs name;
        inherit (descriptor) cases;
      }
    else
      assert lib.assertMsg (builtins.isString (descriptor.protects or null) && descriptor.protects != "") "${name} must state what it protects";
        descriptor.check;
  descriptorsOf = root:
    builtins.mapAttrs (name: _: let
      descriptor = lib.callPackageWith {
        inherit inputs denix pkgs system configuration compose moduleTestInfo authoring;
      } (root + "/${name}/default.nix") {};
    in
      lib.optionalAttrs (descriptor ? platforms) {inherit (descriptor) platforms;}
      // {check = checkOf name descriptor;})
    (directoriesOf root);
  moduleChecks = import ../lib/module-tests.nix {inherit lib;} {
    inherit compose pkgs system home;
    info = moduleTestInfo;
  };
  # Depending on the .drv file alone evaluates the derivation without building
  # it.
  evaluated = name: derivations:
    pkgs.runCommandLocal "${name}-check" {
      derivations = map (derivation: builtins.unsafeDiscardOutputDependency derivation.drvPath) derivations;
    } ''
      touch "$out"
    '';
  hostDirectory = name: "abstractions/hosts/${name}";
  # One check per configuration, so a host's Hjem and nix-darwin evaluations run
  # in parallel.
  hostCheckSets = lib.mapAttrs (name: host:
    assert lib.assertMsg (builtins.pathExists (../. + "/${hostDirectory name}")) "Host ${name} is not declared in ${hostDirectory name}";
      {
        "host-${name}-hjem" = assert lib.assertMsg (host.hjem.failedAssertions == []) "Host ${name} fails Hjem assertions:\n${lib.concatStringsSep "\n" host.hjem.failedAssertions}";
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
