{
  delib,
  lib,
  mylib,
  ...
}:
delib.module {
  name = "zsh.interactive";
  tests.fixture = ["exclusive" "zsh" "zsh.interactive.zabrze"];
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
    completionProfiles = [
      "${config.xdg.state.directory}/hjem/standalone/current-profile"
      "/nix/var/nix/profiles/default"
    ];
    compdumpDir = "${config.xdg.cache.directory}/zsh";
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
        () {
          local dump=${lib.escapeShellArg compdumpDir}/zcompdump
          local entry
          for entry in ''${(%):-%x} ${lib.escapeShellArgs completionProfiles}; do
            dump+=-''${''${''${(s:/:)entry:A}[3]}[1,32]}
          done
          if [[ ! -e $dump ]]; then
            mkdir -p ${lib.escapeShellArg compdumpDir}
            local stale=(${lib.escapeShellArg compdumpDir}/zcompdump-*(N))
            zmodload -F zsh/files b:zf_rm
            (( $#stale )) && zf_rm -f $stale
          fi
          autoload -Uz compinit && compinit -C -d $dump
          [[ ! -e $dump.zwc || $dump -nt $dump.zwc ]] && zcompile $dump
        }
      '';
      pure.text = ''
        fpath+=(${pkgs.pure-prompt}/share/zsh/site-functions)
        zstyle :prompt:pure:git:stash show yes
        autoload -Uz prompt_pure_setup && prompt_pure_setup
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
          ZSH_AUTOSUGGEST_MANUAL_REBIND=1
          source ${autosuggestions}/share/zsh-autosuggestions/zsh-autosuggestions.zsh
        ''
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

    # Without secondary_theme.zsh, fsh downloads the upstream theme at startup.
    xdg.data.files."fsh/secondary_theme.zsh".source = "${fsh.src}/share/free_theme.zsh";
  };
}
