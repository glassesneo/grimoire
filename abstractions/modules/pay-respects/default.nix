{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: {
  name = "pay-respects";
  meta.description = "Provide command typo recovery with pay-respects.";

  options.enable = delib.boolOption true;

  # pay-respects.disrespectful replaces this module's recovery when enabled.
  hjem.ifEnabled = {pkgs, ...}:
    lib.mkIf (!cfg.disrespectful.enable) {
      packages = [pkgs.pay-respects];

      zsh.zshrc.pay-respects.text = ''
        source ${pkgs.runCommand "pay-respects-init.zsh" {} "${lib.getExe pkgs.pay-respects} zsh > $out"}
      '';
    };
})
