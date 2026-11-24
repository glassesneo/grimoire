{lib}: let
  modes = ["expected" "fails" "build"];
  pretty = lib.generators.toPretty {};

  # Forces a derivation only to its output path: deepSeq would descend into its
  # whole build graph.
  force = value:
    if lib.isDerivation value
    then builtins.seq value.outPath true
    else if builtins.isAttrs value
    then lib.all force (builtins.attrValues value)
    else if builtins.isList value
    then lib.all force value
    else builtins.seq value true;

  failure = case: let
    has = field: case ? ${field};
  in
    if !(builtins.isString (case.protects or null)) || case.protects == ""
    then "a case must state what it protects"
    else if builtins.length (lib.filter has modes) != 1
    then "exactly one of expected/fails/build must be set"
    else if has "build"
    then
      if has "expr"
      then "build and expr cannot be combined"
      else null
    else if !(has "expr")
    then "an evaluation case requires expr"
    else if has "fails"
    then
      if (builtins.tryEval (force case.expr)).success
      then "expected evaluation to fail, but it succeeded"
      else null
    else if case.expr == case.expected
    then null
    else "expected:\n${pretty case.expected}\nactual:\n${pretty case.expr}";
in {
  inherit force;

  check = {
    pkgs,
    name,
    cases,
  }: let
    failures = lib.filterAttrs (_: reason: reason != null) (lib.mapAttrs (caseName: case: builtins.addErrorContext "while evaluating case '${caseName}' of '${name}'" (failure case)) cases);
  in
    if failures == {}
    then
      pkgs.runCommand "${name}-check" {
        builds = lib.mapAttrsToList (_: case: case.build) (lib.filterAttrs (_: case: case ? build) cases);
      } ''
        mkdir "$out"
        for build in $builds; do test -e "$build"; done
      ''
    else
      throw "'${name}' failed ${toString (builtins.length (builtins.attrNames failures))} case(s):\n${
        lib.concatStringsSep "\n" (lib.mapAttrsToList (caseName: reason: "- ${caseName}: ${reason}") failures)
      }";
}
