{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # The ports are scripts exporting FZF_DEFAULT_OPTS; an entry is an options
  # file holding the quoted value.
  themes = mylib.schemeThemes {
    name = "fzf";
    themes.rose-pine = pkgs:
      pkgs.runCommandLocal "fzf-rose-pine" {
        src = rose-pine;
      } ''
        sed -e '1s/^export FZF_DEFAULT_OPTS="//' -e '$s/"$//' "$src/dist/rose-pine.sh" > "$out"
      '';
  };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "fzf";
    tests.fixture = ["zsh.interactive"];
    meta.description = "Provide and configure fzf, including its Zsh integration.";

    options = with delib; {
      enable = boolOption true;
      useColorscheme = boolOption true "Whether fzf takes its colors from `colorscheme.resolved`.";
    };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.ifEnabled = {pkgs, ...}: let
      # fd applies the global Git ignore file outside repositories too.
      fileCommand = "${lib.getExe pkgs.fd} -H -E .git --type f --strip-cwd-prefix --no-require-git";
    in {
      packages = [pkgs.fzf];

      environment.sessionVariables =
        {
          FZF_DEFAULT_COMMAND = fileCommand;
          FZF_CTRL_T_COMMAND = fileCommand;
          FZF_ALT_C_COMMAND = "";
          FZF_DEFAULT_OPTS = lib.concatStringsSep " " [
            "--border=sharp"
            "--no-separator"
            "--no-scrollbar"
          ];
          FZF_CTRL_T_OPTS = "--popup=center,80%,50%";
          FZF_CTRL_R_OPTS = "--popup=center,80%,50%";
        }
        // lib.optionalAttrs (theme != null) {
          # fzf reads the file before FZF_DEFAULT_OPTS.
          FZF_DEFAULT_OPTS_FILE = theme pkgs;
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
  })
