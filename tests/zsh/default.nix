{
  inputs,
  pkgs,
  ...
}: let
  lib = pkgs.lib;

  # Every published Hjem configuration that renders zsh startup files. Their
  # text joins fragments from several modules, so only the built files show
  # whether the result parses.
  zshFiles = lib.concatLists (lib.mapAttrsToList
    (_: configuration:
      lib.filter
      (file: lib.hasSuffix "/.zshenv" file.target || lib.hasSuffix "/.zshrc" file.target)
      configuration.manifest.files)
    inputs.self.hjemConfigurations);
in
  pkgs.runCommand "zsh-test" {
    sources = map (file: file.source) zshFiles;
    nativeBuildInputs = [pkgs.zsh];
  } ''
    set -eu

    for source in $sources; do
      zsh -n "$source"
    done

    mkdir "$out"
  ''
