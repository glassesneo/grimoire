{delib, ...}:
delib.module {
  name = "eza";
  meta.description = "Provide eza for listing files and directories.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: let
    flags = "--git --icons=auto -a";
  in {
    packages = [pkgs.eza];

    zsh.zabrze.snippets = {
      "eza" = {
        trigger = "ls";
        snippet = "eza ${flags}";
      };
      "eza -l" = {
        trigger = "ll";
        snippet = "eza -l ${flags}";
      };
      "eza -T" = {
        trigger = "tree";
        snippet = "eza -T ${flags}";
      };
    };
  };
}
