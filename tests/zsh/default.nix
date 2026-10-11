{
  inputs,
  pkgs,
  system,
  configuration,
  ...
}: let
  lib = pkgs.lib;

  # Every published Hjem configuration of this system that renders zsh startup
  # files. Their text joins fragments from several modules, so only the built
  # files show whether the result parses.
  published =
    lib.mapAttrsToList (name: host: inputs.self.hjemConfigurations."${host.user.name}@${name}")
    (lib.filterAttrs (_: host: host.system == system) configuration.config.hosts);
  filesOf = configuration: suffix: lib.filter (file: lib.hasSuffix suffix file.target) configuration.manifest.files;
  zshFiles = lib.concatMap (configuration: filesOf configuration "/.zshenv" ++ filesOf configuration "/.zshrc") published;

  # fsh downloads a theme at startup unless one exists under FAST_WORK_DIR, so
  # each .zshrc that sets it must have the theme deployed there.
  themes = lib.concatMap (configuration:
    map (zshrc: "${zshrc.source} ${toString (map (file: dirOf file.target) (filesOf configuration "/secondary_theme.zsh"))}")
    (filesOf configuration "/.zshrc"))
  published;
in
  pkgs.runCommand "zsh-test" {
    sources = map (file: file.source) zshFiles;
    themes = lib.concatStringsSep "\n" themes;
    nativeBuildInputs = [pkgs.zsh];
  } ''
    set -eu

    for source in $sources; do
      zsh -n "$source"
    done

    printf '%s\n' "$themes" | while read -r zshrc directories; do
      [ -n "$zshrc" ] || continue
      workDir="$(sed -n 's/^FAST_WORK_DIR="\(.*\)"$/\1/p' "$zshrc")"
      if [ -z "$workDir" ]; then
        if grep -q fast-syntax-highlighting "$zshrc"; then
          echo "$zshrc: loads fsh without FAST_WORK_DIR" >&2
          exit 1
        fi
        continue
      fi
      case " $directories " in
        *" $workDir "*) ;;
        *)
          echo "$zshrc: no theme under FAST_WORK_DIR $workDir" >&2
          exit 1
          ;;
      esac
    done

    mkdir "$out"
  ''
