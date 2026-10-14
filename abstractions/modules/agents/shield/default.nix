{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "shield";
  meta.description = "Provide the SHIELD process hub and quin attachable Pi client.";
  options = with delib; {
    enable = boolOption true;
    defaultModel = description (strOption "openai/gpt-6.1-sol") "Model, as provider/id, that quin uses for a new live agent when neither --model nor the dedicated Pi settings name one.";
  };
  bundles.ifEnabled = {pkgs, ...}:
    lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "aarch64-darwin") (
      let
        packages = pkgs.callPackage ./package.nix {
          bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
          inherit (cfg) defaultModel;
        };
      in {
        shield.package = packages.shield;
        quin.package = packages.quin;
      }
    );
})
