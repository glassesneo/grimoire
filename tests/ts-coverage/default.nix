# Every tracked JS or TS file lies under a directory that some check type-checks
# and lints, so a new directory cannot leave files unchecked. A check that
# covers TS exposes those directories as `passthru.tsRoots` and is listed in
# `covering`; `unchecked` names the directories nothing covers yet, each with
# its reason.
{
  inputs,
  pkgs,
  system,
}: let
  inherit (pkgs) lib;
  root = ../..;
  covering = ["quin" "harness"];
  unchecked = {
    # Pi loads these extensions itself; no check installs their dependencies.
    "abstractions/modules/agents/shield/runtime" = "no type check or lint";
  };
  roots =
    # Read from the definitions, so a check omitted on this platform still counts.
    lib.concatMap (name: (import (./.. + "/${name}") {inherit inputs pkgs system;}).tsRoots) covering
    ++ builtins.attrNames unchecked;
  files =
    map (file: lib.removePrefix (toString root + "/") (toString file))
    (lib.fileset.toList (lib.fileset.fileFilter
      (file: lib.any file.hasExt ["ts" "tsx" "js" "jsx" "mjs" "cjs"])
      root));
  uncovered = lib.filter (file: !lib.any (dir: lib.hasPrefix "${dir}/" file) roots) files;
in
  pkgs.runCommand "ts-coverage" {} ''
    ${lib.optionalString (uncovered != []) ''
      echo "JS/TS files outside every checked directory:" >&2
      printf '  %s\n' ${lib.escapeShellArgs uncovered} >&2
      echo "Cover them in a check's tsRoots, or name the directory in tests/ts-coverage's unchecked." >&2
      exit 1
    ''}
    touch "$out"
  ''
