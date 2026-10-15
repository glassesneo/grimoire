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
    defaultModel = lib.mkOption {
      type = lib.types.nullOr (lib.types.strMatching "[^/]+/.+");
      default = "openai/gpt-6.1-sol";
      description = "Model, as provider/id, that quin uses for a new live agent when neither --model nor the dedicated Pi settings name one; null leaves quin without one.";
    };
    keys = description (attrsOfOption (lib.types.listOf lib.types.str) {}) "quin key bindings by action id (<layer>.<name>, such as timeline.cursor-down or global.detach). Each listed action's chords, such as ctrl+f or shift+tab, replace its defaults; an empty list unbinds it. A key is one character or a name OpenTUI reports, such as return, escape, or space; a capital letter is written shift+<letter>. A character chord, including space, passes through to text input, except for the palette's argument action. The editor layer cannot bind a character chord. Building quin rejects unknown actions, unknown key names, such bindings, and chords bound twice in one layer.";
  };
  bundles.ifEnabled = {pkgs, ...}: let
    packages = pkgs.callPackage ./package.nix {
      bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      inherit (cfg) defaultModel keys;
    };
  in {
    shield.package = packages.shield;
    quin.package = packages.quin;
  };
})
