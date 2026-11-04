{
  delib,
  config,
  lib,
  ...
}: let
  tagsOf = name: config.modules.${name}.meta.tags;
  # The enabled tags are read only inside conditions: the module names receiving
  # definitions come from metadata alone, so `myconfig` does not depend on itself.
  tagged = lib.filter (name: tagsOf name != []) (builtins.attrNames config.modules);
  knownTags = lib.unique (lib.concatMap tagsOf tagged);
in
  delib.module ({cfg, ...}: {
    name = "tags";
    meta.description = "Enable by default the modules that carry a tag selected for the host.";

    options = with delib; {
      enabled = listOfOption (types.enum knownTags) [] "Tags whose modules are enabled by default.";
    };

    # A module's definition, so a host's own `enable = false` excludes a tagged module.
    myconfig.always = lib.foldl' lib.recursiveUpdate {} (map (name:
      lib.setAttrByPath (lib.splitString "." name ++ ["enable"])
      (lib.mkIf (lib.any (tag: lib.elem tag cfg.enabled) (tagsOf name)) true))
    tagged);
  })
