{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zsh.interactive";
  meta.description = "Build Zsh's interactive environment.";

  options.enable = delib.boolOption true;

  hjem.always.options.zsh.zshrc = mylib.fragments.option;

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    dotDir = "${config.xdg.config.directory}/zsh";
    fsh = pkgs.zsh-fast-syntax-highlighting;
    fshWorkDir = "${config.xdg.data.directory}/fsh";
    autosuggestions = pkgs.zsh-autosuggestions;
    # Profiles whose packages' completions compinit finds: Hjem's packages and the installer's nix.
    completionProfiles = [
      "${config.xdg.state.directory}/hjem/standalone/current-profile"
      "/nix/var/nix/profiles/default"
    ];
  in {
    zsh.zshenv.zdotdir.text = ''
      ZDOTDIR="${dotDir}"
    '';

    zsh.zshrc = {
      compinit.text = ''
        () {
          local profile
          for profile in ${lib.escapeShellArgs completionProfiles}; do
            fpath+=($profile/share/zsh/site-functions $profile/share/zsh/vendor-completions)
          done
        }
        autoload -Uz compinit && compinit
      '';
      pure.text = ''
        fpath+=(${pkgs.pure-prompt}/share/zsh/site-functions)
        autoload -Uz promptinit && promptinit
        zstyle :prompt:pure:git:stash show yes
        prompt pure
      '';
    };

    files.".zshrc" = {
      relativeTo = dotDir;
      exclusive = true;
      text = lib.concatStringsSep "\n" [
        (builtins.readFile ./rc.zsh)
        (mylib.fragments.render config.zsh.zshrc)
        ''
          ZSH_AUTOSUGGEST_STRATEGY=(history)
          source ${autosuggestions}/share/zsh-autosuggestions/zsh-autosuggestions.zsh
        ''
        # fsh wraps the widgets that exist when it loads, so it stays last.
        ''
          FAST_WORK_DIR="${fshWorkDir}"
          source ${fsh}/share/zsh/plugins/fast-syntax-highlighting/fast-syntax-highlighting.plugin.zsh
        ''
      ];
    };

    zsh.zabrze.snippets."cd .." = {
      trigger = "bd";
      snippet = "cd ..";
    };

    # Without secondary_theme.zsh, fsh downloads the upstream free theme at startup.
    xdg.data.files."fsh/secondary_theme.zsh".source = "${fsh.src}/share/free_theme.zsh";
  };

  tests = {
    pkgs,
    home,
    ...
  }: let
    configDir = "${home}/fixture-config";
    dataDir = "${home}/fixture-data";
    stateDir = "${home}/fixture-state";
  in {
    startup = {
      uses = ["zsh" "zsh.interactive.zabrze"];
      modules.fixture.hjem.always = {
        xdg.config.directory = configDir;
        xdg.data.directory = dataDir;
        xdg.state.directory = stateDir;
        zsh.zshrc.fixture.text = "typeset -g FIXTURE=value";
      };
      build = result: let
        source = target:
          (lib.findFirst (file: file.target == target)
            (throw "Missing fixture file ${target}")
            result.manifest.files).source;
      in
        pkgs.runCommand "zsh-interactive-startup" {
          zshrc = source "${configDir}/zsh/.zshrc";
          theme = source "${dataDir}/fsh/secondary_theme.zsh";
          nativeBuildInputs = [pkgs.zsh];
        } ''
          zsh -n "$zshrc"
          grep -Fx 'FAST_WORK_DIR="${dataDir}/fsh"' "$zshrc"
          test -f "$theme"
          grep -F '${stateDir}/hjem/standalone/current-profile' "$zshrc"
          grep -Fx 'source ${pkgs.zsh-autosuggestions}/share/zsh-autosuggestions/zsh-autosuggestions.zsh' "$zshrc"
          HOME="$PWD" EDITOR=nvim zsh -fic "source $zshrc; bindkey -lL main" > keymap
          grep -Fx 'bindkey -A emacs main' keymap
          touch "$out"
        '';
    };
  };
}
