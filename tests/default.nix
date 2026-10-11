# Owns the discovery of checks for one system.
#
# Each immediate `<name>/default.nix` is called with the arguments below it
# names and becomes `checks.<system>.<name>`. A check that is meaningful only on
# some platforms declares them in its `meta.platforms`; it is omitted elsewhere.
# Inline module tests join as `module-<name>`, and a name both sources define
# fails evaluation.
{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
  compose,
}: let
  root = ./.;
  entries = builtins.readDir root;

  tests =
    pkgs.lib.filterAttrs
    (name: type:
      type
      == "directory"
      && builtins.pathExists
      (root + "/${name}/default.nix"))
    entries;

  directoryChecks =
    pkgs.lib.filterAttrs (_: pkgs.lib.meta.availableOn pkgs.stdenv.hostPlatform)
    (builtins.mapAttrs
      (name: _:
        pkgs.lib.callPackageWith {
          inherit inputs denix pkgs system configuration compose;
        } (root + "/${name}/default.nix") {})
      tests);

  moduleChecks = import ../lib/module-tests.nix {inherit (pkgs) lib;} {
    inherit compose configuration pkgs system;
    # `extensions/module-dependencies.nix` contributes to `myconfig.assertions`.
    infrastructure = ["assertions"];
  };

  collisions = builtins.attrNames (builtins.intersectAttrs directoryChecks moduleChecks);
in
  if collisions != []
  then throw "Module tests collide with checks under tests/: ${pkgs.lib.concatStringsSep ", " collisions}"
  else directoryChecks // moduleChecks
