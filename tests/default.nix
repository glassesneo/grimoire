{
  inputs,
  denix,
  pkgs,
  system,
  configuration,
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
in
  builtins.mapAttrs
  (name: _:
    pkgs.lib.callPackageWith {
      inherit inputs denix pkgs system configuration;
    } (root + "/${name}/default.nix") {})
  tests
