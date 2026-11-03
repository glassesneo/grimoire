# Owns inline tests, declaration ownership, and the conservative reverse uses
# closure. tests {pkgs, lib, system, home, oxlintConfig} returns named cases,
# whose fields are the options declared below. Each case has exactly one mode:
# expected, fails or build. Unknown fields and unknown uses are errors when the
# cases are discovered. Coverage retains all cases.
# moduleTestInfo takes {pkgs,system,home,oxlintConfig,root,infrastructure} and
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
}: let
  inherit (lib) mkOption types;
  supportedSystems = ["aarch64-darwin" "aarch64-linux" "x86_64-linux"];
  modes = ["expected" "fails" "build"];

  case = {options, ...}: {
    options = {
      uses = mkOption {
        type = types.listOf types.str;
        default = [];
        description = "Modules added to this case's fixture beside the module, infrastructure and contributors. Their own uses are not followed; each must name a module.";
      };
      host = mkOption {
        type = types.attrs;
        default = {};
        description = "Attributes merged into the fixture's `delib.host` declaration, such as `myconfig.ifEnabled` choices or `system`. The fixture's module system is evaluated for that `system`.";
      };
      modules = mkOption {
        type = types.attrsOf types.attrs;
        default = {};
        description = "Contributor modules by name: `delib.module` attributes without `name` or `meta.description`.";
      };
      moduleSystem = mkOption {
        type = types.enum (lib.subtractLists ["myconfig" "constraints"] (builtins.attrNames config.moduleSystems));
        default = "hjem";
        description = "Module system whose result the case observes.";
      };
      expr = mkOption {
        type = types.functionTo types.raw;
        description = "Maps the fixture's result to the value compared with `expected`, or that must fail to evaluate when `fails = true`. Required unless the mode is `build` or `fails` is a string.";
      };
      expected = mkOption {
        type = types.raw;
        description = "Value that `expr` must return. One of the modes.";
      };
      fails = mkOption {
        type = types.either (types.enum [true]) types.str;
        description = "One of the modes: `true` requires `expr` to fail evaluation; a string requires a failed constraint or module-system assertion containing it.";
      };
      build = mkOption {
        type = types.functionTo types.package;
        description = "One of the modes: maps the fixture's result to a derivation that the module's check builds. Cannot be combined with `expr`.";
      };
      platforms = mkOption {
        type = types.listOf types.str;
        default = supportedSystems;
        description = "Systems on which the case runs. Read before any fixture is generated.";
      };
      tsRoots = mkOption {
        type =
          types.listOf (types.addCheck types.str (path: !lib.hasPrefix "/" path && !lib.elem ".." (lib.splitString "/" path))
            // {description = "module-relative path without `..` segments";});
        default = [];
        description = "TypeScript roots whose coverage this case provides, relative to the module directory; `.` is the module directory.";
      };
      defined = mkOption {
        type = types.listOf (types.enum (["expr"] ++ modes));
        internal = true;
        readOnly = true;
        description = "The fields among `expr` and the modes that the case defines.";
      };
    };
    config.defined = lib.filter (field: options.${field}.isDefined) (["expr"] ++ modes);
  };
in {
  config.settings.modules.extraSubmodules.options.tests = lib.mkOption {
    type = lib.types.functionTo (lib.types.attrsOf (lib.types.submodule case));
    default = _: {};
    defaultText = lib.literalExpression "_: { }";
    description = "Inline cases of this module's contract, by name. A function of `{pkgs, lib, system, home, oxlintConfig}`, where `home` is the fixture user's home directory and `oxlintConfig` the repository's oxlint configuration.";
  };

  options.moduleTestInfo = lib.mkOption {
    type = lib.types.raw;
    description = "Internal function returning module declarations, applicable cases, coverage roots and reverse uses check closure without generating fixtures.";
  };
  config.moduleTestInfo = {
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
      else throw "module-tests: module '${name}' must be declared in exactly one file, found: ${toString files}";
    declarations = lib.genAttrs names (name: let
      file = fileOf name;
      directory = lib.removePrefix "${toString root}/" (builtins.dirOf file);
      cases = config.modules.${name}.tests {inherit pkgs lib system home oxlintConfig;};
      uses = lib.unique (lib.concatMap (case: case.uses) (builtins.attrValues cases));
      unknown = lib.subtractLists names uses;
      normalize = path: lib.concatStringsSep "/" ([directory] ++ lib.filter (part: part != "." && part != "") (lib.splitString "/" path));
    in
      assert lib.assertMsg (unknown == []) "module-tests: unknown uses in '${name}': ${toString unknown}"; {
        inherit file directory cases uses;
        infrastructure = lib.elem name infrastructure;
        applicableCases = lib.filterAttrs (_: case: lib.elem system case.platforms) cases;
        tsRoots = lib.sort lib.lessThan (lib.unique (lib.concatMap (case: map normalize case.tsRoots) (builtins.attrValues cases)));
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
