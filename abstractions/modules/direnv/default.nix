{
  delib,
  lib,
  ...
}:
delib.module {
  name = "direnv";
  meta.description = "Provide and configure direnv, including its Zsh integration.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.direnv];

    xdg.config.files."direnv/lib/nix-direnv.sh" = {
      exclusive = true;
      source = "${pkgs.nix-direnv}/share/nix-direnv/direnvrc";
    };

    zsh.zshrc.direnv.text = ''
      eval "$(${lib.getExe pkgs.direnv} hook zsh)"
    '';
  };
}
