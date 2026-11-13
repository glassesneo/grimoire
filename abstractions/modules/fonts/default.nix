{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "fonts";
  meta.description = "Install the user's font packages as real files in the platform's font directory.";
  tests.fixture = ["imprynt"];

  options = {pkgs, ...}: {
    enable = delib.boolOption true;
    packages = delib.listOfOption delib.types.package (with pkgs; [
      udev-gothic-nf
      plemoljp-nf
      noto-fonts-cjk-serif
      noto-fonts-cjk-sans
      hackgen-nf-font
    ]);
  };

  # The empty declaration remains when disabled, so its next apply removes
  # the previous files rather than abandoning their journal.
  hjem.always = {
    config,
    pkgs,
    ...
  }: {
    imprynt.deployments.fonts = {
      root =
        if pkgs.stdenv.hostPlatform.isDarwin
        then "${config.directory}/Library/Fonts"
        else "${config.xdg.data.directory}/fonts";
      trees = lib.optionals cfg.enable (map (package: {
        source = "${package}/share/fonts";
        prefix = "imprynt/${lib.getName package}";
        extensions = [".ttf" ".otf" ".ttc" ".otc"];
      }) (lib.unique cfg.packages));
    };
  };

  tests.cases = {
    pkgs,
    home,
    ...
  }: {
    linux-uses-user-font-directory = {
      protects = "font deployment uses the user data font directory on Linux rather than a Darwin-only path";
      host.system = "aarch64-linux";
      expr = result: result.apply.steps.imprynt.deployments.fonts.root;
      expected = "${home}/.local/share/fonts";
    };
    disabling-retains-removal = {
      protects = "disabling fonts leaves its deployment registered with no files, so a later switch reconciles previous ownership";
      host.myconfig.ifEnabled.fonts.enable = false;
      build = result:
        pkgs.runCommand "fonts-disabled" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.version == 1 and (.files | length == 0)' ${result.apply.steps.imprynt.deployments.fonts.manifest}
          touch "$out"
        '';
    };
  };
})
