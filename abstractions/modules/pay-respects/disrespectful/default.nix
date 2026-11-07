{
  delib,
  lib,
  ...
}:
delib.module {
  name = "pay-respects.disrespectful";
  tests.fixture = ["zsh.interactive"];
  meta.description = "Replace command typo recovery with a playful response.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [pkgs.sl];

    zsh.zshrc.sl.text = ''
      command_not_found_handler() {
        command ${lib.getExe pkgs.sl} -a -F
        return 127
      }
    '';
  };
}
