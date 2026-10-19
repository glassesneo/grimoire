{
  delib,
  lib,
  ...
}:
delib.module {
  name = "publication";
  meta.description = "Centralize publication choices for feature-owned bundles.";
  options.enable = delib.boolOption true;

  bundles.ifEnabled = {
    pkgs,
    config,
    ...
  }: {
    harness.publish = true;
    neovim.publish = true;
    skills.publish = true;
    shield.publish = (config.myconfig.shield.enable or false) && lib.meta.availableOn pkgs.stdenv.hostPlatform config.bundles.shield.package;
    keel.publish = (config.myconfig.shield.enable or false) && lib.meta.availableOn pkgs.stdenv.hostPlatform config.bundles.keel.package;
  };
}
