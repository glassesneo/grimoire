# Owns inline checks, declaration ownership, and the conservative reverse uses
# closure. checks {pkgs, lib, system, home, oxlintConfig} returns named cases.
# Each case has exactly one mode: expected compares expr result; fails=true
# requires expr to throw; fails="text" matches a failed assertion; build maps the
# generated fixture result to a derivation and cannot coexist with expr.
# host augments the fixture host; modules supplies contributor modules;
# moduleSystem defaults to hjem. uses adds only the named modules to that fixture
# (not their recursive dependencies). Unknown fields and unknown uses are errors.
# platforms defaults to supported systems and is read before fixture generation.
# tsRoots defaults to []; paths are module-relative, '.' means the module root,
# and absolute paths and '..' segments are rejected. Coverage retains all cases.
# moduleCheckInfo takes {pkgs,system,home,oxlintConfig,root,infrastructure} and
# returns a module-name attrset with file, directory, cases, applicableCases,
# tsRoots, uses, infrastructure and affectedChecks. Declaration files must be
# unique. Reverse closure unions uses from all cases, including excluded ones;
# duplicates, self edges and cycles terminate. Only applicable check names enter
# affectedChecks. Discovery never generates fixtures or forces check builders.
{
  lib,
  config,
  options,
  ...
}: {
  config.settings.modules.extraSubmodules.options.checks = lib.mkOption {
    type = lib.types.functionTo (lib.types.attrsOf lib.types.raw);
    default = _: {};
    description = "Inline expected/fails/build cases of this module's contract, with optional platforms and module-relative tsRoots.";
  };

  options.moduleCheckInfo = lib.mkOption {
    type = lib.types.raw;
    description = "Internal function returning module declarations, applicable cases, coverage roots and reverse uses check closure without generating fixtures.";
  };
  config.moduleCheckInfo = {
    pkgs,
    system,
    home,
    oxlintConfig,
    root,
    infrastructure,
  }: let
    names = builtins.attrNames config.modules;
    fileOf = name: let
      files = lib.unique (map (definition: definition.file)
        (lib.filter (definition: builtins.hasAttr name definition.value)
          options.modules.definitionsWithLocations));
    in
      if builtins.length files == 1
      then builtins.head files
      else throw "module-checks: module '${name}' must be declared in exactly one file, found: ${toString files}";
    declarations = lib.genAttrs names (name: let
      file = fileOf name;
      directory = lib.removePrefix "${toString root}/" (builtins.dirOf file);
      cases = config.modules.${name}.checks {inherit pkgs lib system home oxlintConfig;};
      uses = lib.unique (lib.concatMap (case: case.uses or []) (builtins.attrValues cases));
      unknown = lib.subtractLists names uses;
      normalize = path:
        if !builtins.isString path || lib.hasPrefix "/" path || lib.elem ".." (lib.splitString "/" path)
        then throw "module-checks: invalid tsRoots path in '${name}'"
        else lib.concatStringsSep "/" ([directory] ++ lib.filter (part: part != "." && part != "") (lib.splitString "/" path));
    in
      assert lib.assertMsg (unknown == []) "module-checks: unknown uses in '${name}': ${toString unknown}"; {
        inherit file directory cases uses;
        infrastructure = lib.elem name infrastructure;
        applicableCases = lib.filterAttrs (_: case: lib.elem system (case.platforms or ["aarch64-darwin" "aarch64-linux" "x86_64-linux"])) cases;
        tsRoots = lib.sort lib.lessThan (lib.unique (lib.concatMap (case: map normalize (case.tsRoots or [])) (builtins.attrValues cases)));
      });
    closure = selected: let
      next = lib.unique (selected ++ lib.filter (name: lib.any (used: lib.elem used selected) declarations.${name}.uses) names);
    in
      if builtins.length next == builtins.length selected
      then next
      else closure next;
  in
    lib.mapAttrs (name: declaration:
      declaration
      // {
        affectedChecks = map (affected: "module-${affected}") (lib.sort lib.lessThan (lib.filter (affected: declarations.${affected}.applicableCases != {}) (closure [name])));
      })
    declarations;
}
