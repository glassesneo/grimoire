# Evaluate applicable inline test cases declared by `extensions/module-tests.nix`.
# Returns one module-<name> aggregate per module with applicable cases. Evaluation
# mismatches throw with module/case context; build results are realized as actual
# dependencies, so a failed builder fails the aggregate.
{lib}: {
  # Composes a Denix configuration from abstractions on top of the repository's
  # adapters and extensions.
  compose,
  # The configuration's `moduleTestInfo`, computed with the same `home`.
  info,
  # The fixture user's home directory.
  home,
  pkgs,
  system,
}: let
  assertions = import ./assertions.nix {inherit lib;};
  defines = case: field: lib.elem field case.defined;
  # NAMES and their fixture modules, transitively.
  loaded = names:
    map (item: item.key) (builtins.genericClosure {
      startSet = map (key: {inherit key;}) names;
      operator = item: map (key: {inherit key;}) info.${item.key}.fixture;
    });

  fileOf = name: info.${name}.file;

  host = attrs: {delib, ...}:
    delib.host (lib.recursiveUpdate {
        name = "fixture";
        inherit system;
        user = {
          name = "fixture";
          homeDirectory = home;
        };
      }
      attrs);

  contributor = name: attrs: {delib, ...}:
    delib.module ({
        inherit name;
        meta.description = "Contribute to a module test fixture.";
      }
      // attrs);

  generate = name: case: let
    fixtureSystem = case.host.system or system;
    # The arguments `flake.nix` passes when publishing each module system.
    extraArgs = {
      hjem = {
        system = fixtureSystem;
        username = "fixture";
        homeDirectory = home;
      };
      bundles.system = fixtureSystem;
    };
  in
    (compose (
      [(fileOf name) (host case.host)]
      ++ map fileOf (lib.remove name (loaded ([name] ++ case.uses)))
      ++ lib.mapAttrsToList contributor case.modules
    )).genSystem {
      inherit (case) moduleSystem;
      host = "fixture";
      extraArgs = extraArgs.${case.moduleSystem} or {};
    };

  failedAssertions = moduleSystem: result:
    if moduleSystem == "darwin"
    then assertions.failed result.config.assertions
    else result.failedAssertions;

  # Forces a value deeply, but a derivation only to its output path: deepSeq would
  # descend into its whole build graph.
  force = value:
    if lib.isDerivation value
    then builtins.seq value.outPath true
    else if builtins.isAttrs value
    then lib.all force (builtins.attrValues value)
    else if builtins.isList value
    then lib.all force value
    else builtins.seq value true;

  # Returns null when the case passes, otherwise the reason it failed.
  run = name: caseName: case: result: let
    has = defines case;
    fails =
      if has "fails"
      then case.fails
      else null;
    pretty = lib.generators.toPretty {};
  in
    builtins.addErrorContext "while evaluating test case '${caseName}' of module '${name}'" (
      if builtins.length (lib.filter has ["expected" "fails" "build"]) != 1
      then "exactly one of expected/fails/build must be set"
      else if has "build" && has "expr"
      then "build and expr cannot be combined"
      else if has "build"
      then builtins.seq (case.build result) null
      else if !(has "expr") && !(builtins.isString fails)
      then "evaluation case requires expr"
      else if fails == true
      then
        if (builtins.tryEval (force (case.expr result))).success
        then "expected evaluation to fail, but it succeeded"
        else null
      else if builtins.isString fails
      then let
        messages = failedAssertions case.moduleSystem result;
      in
        if lib.any (lib.hasInfix fails) messages
        then null
        else "expected a failed assertion containing ${pretty fails}, failed assertions:\n${pretty messages}"
      else let
        actual = case.expr result;
      in
        if actual == case.expected
        then null
        else "expected:\n${pretty case.expected}\nactual:\n${pretty actual}"
    );

  check = name: cases: let
    # Generated once per case: `run` and the aggregate's `builds` share them.
    results = lib.mapAttrs (_: generate name) cases;
    failures = lib.filterAttrs (_: reason: reason != null) (lib.mapAttrs (caseName: case: run name caseName case results.${caseName}) cases);
  in
    if failures == {}
    then
      pkgs.runCommand "module-${name}-check" {
        builds = lib.mapAttrsToList (caseName: case: case.build results.${caseName}) (lib.filterAttrs (_: case: defines case "build") cases);
      } ''
        mkdir "$out"
        for build in $builds; do test -e "$build"; done
      ''
    else
      throw "module '${name}' failed ${toString (builtins.length (builtins.attrNames failures))} test case(s):\n${
        lib.concatStringsSep "\n" (lib.mapAttrsToList (caseName: reason: "- ${caseName}: ${reason}") failures)
      }";
in
  lib.mapAttrs' (name: module: lib.nameValuePair "module-${name}" (check name module.applicableCases))
  (lib.filterAttrs (_: module: module.applicableCases != {}) info)
