# Evaluate the inline tests declared by `extensions/module-tests.nix`.
#
# Returns one check `module-<name>` per module with test cases. Every case is
# evaluated, and a failing module throws at evaluation with each failing case's
# name and its expected and actual values, so a check never builds red.
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
  home = "/tmp/module-tests";
  fields = ["host" "modules" "uses" "moduleSystem" "expr" "expected" "fails"];

  fileOf = name: let
    files = lib.unique (map (definition: definition.file)
      (lib.filter (definition: builtins.hasAttr name definition.value)
        configuration.options.modules.definitionsWithLocations));
  in
    if builtins.length files == 1
    then builtins.head files
    else throw "module-tests: module '${name}' must be declared in exactly one file, found: ${toString files}";

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
    builtins.addErrorContext "while evaluating test case '${caseName}' of module '${name}'" (
      if unknown != []
      then "unknown fields: ${lib.concatStringsSep ", " unknown}"
      else if (case ? expected) == (fails != null)
      then "exactly one of 'expected' and 'fails' must be set"
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
    then pkgs.runCommand "module-${name}-test" {} ''mkdir "$out"''
    else
      throw "module '${name}' failed ${toString (builtins.length (builtins.attrNames failures))} test case(s):\n${
        lib.concatStringsSep "\n" (lib.mapAttrsToList (caseName: reason: "- ${caseName}: ${reason}") failures)
      }";

  casesOf = module: module.tests {inherit pkgs lib system home;};
in
  lib.mapAttrs' (name: module: lib.nameValuePair "module-${name}" (check name (casesOf module)))
  (lib.filterAttrs (_: module: casesOf module != {}) configuration.config.modules)
