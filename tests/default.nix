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
      (root + "/${name}/default.nix")
      && (pkgs.stdenv.hostPlatform.isDarwin || !(builtins.elem name ["nix-secrets" "zsh"])))
    entries;

  directoryChecks =
    builtins.mapAttrs
    (name: _:
      pkgs.lib.callPackageWith {
        inherit inputs denix pkgs system configuration compose;
      } (root + "/${name}/default.nix") {})
    tests;

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
