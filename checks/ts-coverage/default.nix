# Every tracked JS/TS file must lie in an unfiltered module case's declared
# type/lint roots, or an unchecked directory with an explicit reason.
{
  pkgs,
  moduleTestInfo,
  ...
}: let
  inherit (pkgs) lib;
  root = ../..;
  unchecked = {};
  roots = lib.concatMap (info: info.tsRoots) (builtins.attrValues moduleTestInfo) ++ builtins.attrNames unchecked;
  covered = declared: file: lib.any (dir: dir == "." || lib.hasPrefix "${dir}/" file) declared;
  uncoveredFiles = declared: lib.filter (file: !covered declared file);
  files =
    map (file: lib.removePrefix (toString root + "/") (toString file))
    (lib.fileset.toList (lib.fileset.fileFilter
      (file: lib.any file.hasExt ["ts" "tsx" "js" "jsx" "mjs" "cjs"])
      root));
  uncovered = uncoveredFiles roots files;
  # Segment boundaries matter: a sibling with the same prefix is not covered.
  synthetic = uncoveredFiles ["feature"] ["feature/build.ts" "feature/nested/a.tsx" "feature-other/a.js" "new/file.ts"];
in {
  check = assert synthetic == ["feature-other/a.js" "new/file.ts"];
    pkgs.runCommand "ts-coverage" {} ''
      ${lib.optionalString (uncovered != []) ''
        echo "JS/TS files outside every checked directory:" >&2
        printf '  %s\n' ${lib.escapeShellArgs uncovered} >&2
        echo "Cover them in a module case's tsRoots, or name the directory in checks/ts-coverage's unchecked." >&2
        exit 1
      ''}
      touch "$out"
    '';
}
