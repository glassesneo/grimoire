{
  delib,
  lib,
  config,
  mylib,
  ...
}: let
  sections = ["always" "ifEnabled" "ifDisabled"];

  transform = f: entry: let
    transformed = delib.toDenixArgs (args: delib.processModule (f args) (delib.callIfDenixArgs entry args));
  in
    if lib.isFunction entry
    then delib.inheritFunctionArgs entry transformed
    else transformed;

  label = kind: name: moduleSystem: section:
    transform (_: module: module // {_file = "${kind} ${name} (${moduleSystem}.${section})";});

  prioritize = kind:
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
