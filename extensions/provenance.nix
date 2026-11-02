# Owns the origin labels of module and host sections and the source priorities
# of their `myconfig` definitions.
#
# Every `always`, `ifEnabled`, and `ifDisabled` section of every module system
# is labelled `<module|host> <name> (<system>.<section>)`. The module system
# reports the label as the location of each definition the section makes, in
# error messages and in `definitionsWithLocations`. Mechanisms that need to
# tell definitions apart by origin rely on these labels.
#
# The definitions of `myconfig` sections also receive their source's priority
# from `mylib.sources`, pushed down along the declared option types: a module
# defines below a rice (`extensions/rices.nix`), which defines below a host.
# Sections of other module systems keep their own merge rules.
{
  delib,
  lib,
  config,
  mylib,
  ...
}: let
  sections = ["always" "ifEnabled" "ifDisabled"];

  # Transforms the module an entry yields for its Denix arguments, keeping
  # whether the entry is a function and which arguments it requests.
  transform = f: entry: let
    transformed = delib.toDenixArgs (args: delib.processModule (f args) (delib.callIfDenixArgs entry args));
  in
    if lib.isFunction entry
    then delib.inheritFunctionArgs entry transformed
    else transformed;

  # Denix keeps an entry's `_file`, but coercion has already set it to
  # <unknown-file>, so the label replaces it.
  label = kind: name: moduleSystem: section:
    transform (_: module: module // {_file = "${kind} ${name} (${moduleSystem}.${section})";});

  prioritize = kind:
  # Denix also calls entries with mock arguments to read their shape.
    transform (args: mylib.sources.prioritize mylib.sources.priorities.${kind} (args.myoptions or {}));

  labelSections = kind: {name, ...}: {
    options = lib.genAttrs (builtins.attrNames config.moduleSystems) (moduleSystem:
      lib.genAttrs sections (section:
        lib.mkOption {
          apply = map (entry:
            (
              if moduleSystem == "myconfig"
              then prioritize kind
              else lib.id
            ) (label kind name moduleSystem section entry));
        }));
  };
in {
  settings.modules.extraSubmodules = labelSections "module";
  settings.hosts.extraSubmodules = labelSections "host";
}
