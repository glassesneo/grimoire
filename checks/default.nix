# Immediate check directories return lazy {platforms?, check} descriptors.
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
  moduleCheckInfo = configuration.config.moduleCheckInfo {
    inherit pkgs system;
    home = "/tmp/module-checks";
    oxlintConfig = ../.oxlintrc.json;
    root = ../.;
    inherit infrastructure;
  };
  directories = lib.filterAttrs (name: type: type == "directory" && builtins.pathExists (./. + "/${name}/default.nix")) (builtins.readDir ./.);
  descriptors = builtins.mapAttrs (name: _:
    lib.callPackageWith {
      inherit inputs denix pkgs system configuration compose moduleCheckInfo authoringDocs;
    } (./. + "/${name}/default.nix") {})
  directories;
  moduleChecks = import ../lib/module-checks.nix {inherit lib;} {
    inherit compose configuration pkgs system infrastructure;
  };
  discovered = import ../lib/checks.nix {inherit lib;} {
    inherit descriptors moduleChecks system;
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
      moduleCheckInfo;
    directoryChecks =
      map (name: {
        inherit name;
        directory = "checks/${name}";
      })
      discovered.directoryNames;
    inherit (discovered) checkNames;
  };
}
