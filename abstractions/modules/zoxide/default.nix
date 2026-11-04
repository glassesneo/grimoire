{
  delib,
  lib,
  ...
}:
delib.module {
  name = "zoxide";
  meta.description = "Provide zoxide and initialize its directory navigation in Zsh.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.zoxide];

    zsh.zshrc.zoxide = {
      after = ["compinit"];
      text = ''
        source ${pkgs.runCommand "zoxide-init.zsh" {} "${lib.getExe pkgs.zoxide} init zsh > $out"}
      '';
    };
  };
}
