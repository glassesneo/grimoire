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
    keys = description (attrsOfOption (lib.types.listOf lib.types.str) {}) "quin key bindings by action id (<layer>.<name>, such as timeline.cursor-down or global.detach). Each listed action's chords, such as ctrl+f or shift+tab, replace its defaults; an empty list unbinds it. Unknown actions and chords bound twice in one layer stop quin at startup.";
  };
  bundles.ifEnabled = {pkgs, ...}:
    lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "aarch64-darwin") (
      let
        packages = pkgs.callPackage ./package.nix {
          bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
          inherit (cfg) defaultModel keys;
        };
      in {
        shield.package = packages.shield;
        quin.package = packages.quin;
      }
    );
})
