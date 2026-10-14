{
  delib,
  lib,
  ...
}:
delib.module {
  name = "publication";
  meta.description = "Centralize publication choices for feature-owned bundles.";
  options.enable = delib.boolOption true;

  bundles.ifEnabled = {pkgs, ...}:
    {
      harness.publish = true;
      neovim.publish = true;
      skills.publish = true;
    }
    // lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "aarch64-darwin") {
      shield.publish = true;
      quin.publish = true;
    };
}
