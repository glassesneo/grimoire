{
  delib,
  lib,
  ...
}:
delib.module {
  name = "fzf";
  tests.fixture = ["zsh.interactive"];
  meta.description = "Provide and configure fzf, including its Zsh integration.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled = {pkgs, ...}: let
    # fd applies the global Git ignore file outside repositories too.
    fileCommand = "${lib.getExe pkgs.fd} -H -E .git --type f --strip-cwd-prefix --no-require-git";
  in {
    packages = [pkgs.fzf];

    environment.sessionVariables = {
      FZF_DEFAULT_COMMAND = fileCommand;
      FZF_CTRL_T_COMMAND = fileCommand;
      FZF_ALT_C_COMMAND = "";
      FZF_DEFAULT_OPTS = lib.concatStringsSep " " [
        "--border=sharp"
        "--no-separator"
        "--no-scrollbar"
        # SKK input mode switching keys.
        "--bind=ctrl-j:ignore,ctrl-l:ignore"
      ];
      FZF_CTRL_T_OPTS = "--popup=center,80%,50%";
      FZF_CTRL_R_OPTS = "--popup=center,80%,50%";
    };

    zsh.zshrc.fzf = {
      after = ["compinit"];
      text = ''
        if [[ $options[zle] = on ]]; then
          source ${pkgs.runCommand "fzf-init.zsh" {} "${lib.getExe pkgs.fzf} --zsh > $out"}
        fi
      '';
    };
  };
}
