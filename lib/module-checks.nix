# Evaluate applicable inline cases declared by `extensions/module-checks.nix`.
# Returns one module-<name> aggregate per module with applicable cases. Evaluation
# mismatches throw with module/case context; build results are realized as actual
# dependencies, so a failed builder fails the aggregate.
{lib}: {
  # Composes a Denix configuration from abstractions on top of the repository's
  # adapters and extensions.
  compose,
  # Names of modules that the adapters and extensions contribute to, included in
  # every fixture.
  infrastructure,
  configuration,
  pkgs,
  system,
}: let
  home = "/tmp/module-checks";
  fields = ["host" "modules" "uses" "moduleSystem" "expr" "expected" "fails" "build" "platforms" "tsRoots"];

  info = configuration.config.moduleCheckInfo {
    inherit pkgs system home infrastructure;
    oxlintConfig = ../.oxlintrc.json;
    root = ../.;
  };
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
        meta.description = "Contribute to a module check fixture.";
      }
      // attrs);

  generate = name: case:
    (compose (
      [(fileOf name) (host (case.host or {}))]
      ++ map fileOf (lib.remove name (lib.unique (infrastructure ++ case.uses or [])))
      ++ lib.mapAttrsToList contributor (case.modules or {})
    )).genSystem {
      moduleSystem = case.moduleSystem or "hjem";
      host = "fixture";
      # The arguments `flake.nix` passes when publishing each module system.
      extraArgs =
        {
          hjem = {
            inherit system;
            username = "fixture";
            homeDirectory = home;
          };
          bundles = {inherit system;};
        }
        .${
          case.moduleSystem or "hjem"
        }
        or {
        };
    };

  failedAssertions = moduleSystem: result:
    if moduleSystem == "darwin"
    then map (assertion: assertion.message) (lib.filter (assertion: !assertion.assertion) result.config.assertions)
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
  run = name: caseName: case: let
    result = generate name case;
    unknown = lib.subtractLists fields (builtins.attrNames case);
    fails = case.fails or null;
    pretty = lib.generators.toPretty {};
  in
    builtins.addErrorContext "while evaluating check case '${caseName}' of module '${name}'" (
      if unknown != []
      then "unknown fields: ${lib.concatStringsSep ", " unknown}"
      else if builtins.length (lib.filter (field: builtins.hasAttr field case) ["expected" "fails" "build"]) != 1
      then "exactly one of expected/fails/build must be set"
      else if case ? fails && !(fails == true || builtins.isString fails)
      then "fails must be true or a string"
      else if case ? build && case ? expr
      then "build and expr cannot be combined"
      else if case ? build
      then
        if lib.isDerivation (case.build result)
        then null
        else "build must return a derivation"
      else if !(case ? expr) && !(builtins.isString fails)
      then "evaluation case requires expr"
      else if fails == true
      then
        if (builtins.tryEval (force (case.expr result))).success
        then "expected evaluation to fail, but it succeeded"
        else null
      else if builtins.isString fails
      then let
        messages = failedAssertions (case.moduleSystem or "hjem") result;
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
    failures = lib.filterAttrs (_: reason: reason != null) (lib.mapAttrs (run name) cases);
  in
    if failures == {}
    then
      pkgs.runCommand "module-${name}-check" {
        builds = lib.mapAttrsToList (_: case: case.build (generate name case)) (lib.filterAttrs (_: case: case ? build) cases);
      } ''
        mkdir "$out"
        for build in $builds; do test -e "$build"; done
      ''
    else
      throw "module '${name}' failed ${toString (builtins.length (builtins.attrNames failures))} check case(s):\n${
        lib.concatStringsSep "\n" (lib.mapAttrsToList (caseName: reason: "- ${caseName}: ${reason}") failures)
      }";
in
  lib.mapAttrs' (name: module: lib.nameValuePair "module-${name}" (check name module.applicableCases))
  (lib.filterAttrs (_: module: module.applicableCases != {}) info)
