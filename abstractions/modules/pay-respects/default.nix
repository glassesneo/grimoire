{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "pay-respects";
  tests.fixture = ["zsh.interactive"];
  meta.description = "Provide command typo recovery with pay-respects.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}:
    lib.mkIf (!cfg.disrespectful.enable) {
      packages = [pkgs.pay-respects];

      zsh.zshrc.pay-respects.text = ''
        source ${pkgs.runCommand "pay-respects-init.zsh" {} "${lib.getExe pkgs.pay-respects} zsh > $out"}
      '';
    };
})
