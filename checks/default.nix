# Immediate directories of `checks/` and `tests/` return lazy
# {platforms?, check} descriptors.
{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
  compose,
  authoringDocs,
  formatting,
}: let
  inherit (pkgs) lib;
  infrastructure = ["defaults" "exclusive" "services"];
  home = "/tmp/module-tests";
  moduleTestInfo = configuration.config.moduleTestInfo {
    inherit pkgs system home;
    oxlintConfig = ../.oxlintrc.json;
    root = ../.;
    inherit infrastructure;
  };
  directoriesOf = root: lib.filterAttrs (name: type: type == "directory" && builtins.pathExists (root + "/${name}/default.nix")) (builtins.readDir root);
  descriptorsOf = root:
    builtins.mapAttrs (name: _:
      lib.callPackageWith {
        inherit inputs denix pkgs system configuration compose moduleTestInfo authoringDocs;
      } (root + "/${name}/default.nix") {})
    (directoriesOf root);
  moduleChecks = import ../lib/module-tests.nix {inherit lib;} {
    inherit compose pkgs system infrastructure home;
    info = moduleTestInfo;
  };
  discovered = import ../lib/checks.nix {inherit lib;} {
    inherit moduleChecks system;
    descriptors = descriptorsOf ./.;
    testDescriptors = descriptorsOf ../tests;
    extraChecks = {inherit formatting;};
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
    inherit (discovered) checkNames;
  };
}
