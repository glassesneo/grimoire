{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) rose-pine;

  # Official ports by scheme name, as an options file. The ports are scripts
  # exporting FZF_DEFAULT_OPTS, whose quoted value is the file's content.
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
      fileCommand = "${lib.getExe pkgs.fd} -H -E .git --type f --strip-cwd-prefix -E .agents -E .DS_Store -E .direnv -E .envrc -E var/";
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
