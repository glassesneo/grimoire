{
  delib,
  config,
  lib,
  ...
}: let
  tagsOf = name: config.modules.${name}.meta.tags;
  tagged = lib.filter (name: tagsOf name != []) (builtins.attrNames config.modules);
  knownTags = lib.unique (lib.concatMap tagsOf tagged);
  seatedOnly = name: let
    role = config.modules.${name}.meta.role;
    seat = config.modules."roles.${role}".seat or null;
  in
    role != null && seat != null && seat.seatedOnly;
in
  delib.module ({cfg, ...}: {
    name = "tags";
    meta.description = "Enable by default the modules that carry a tag selected for the host, except candidates whose seat decides their enable.";

    options = with delib; {
      enabled = listOfOption (types.enum knownTags) [] "Tags whose modules are enabled by default.";
    };

    myconfig.always = lib.foldl' lib.recursiveUpdate {} (map (name:
      lib.setAttrByPath (lib.splitString "." name ++ ["enable"])
      (lib.mkIf (lib.any (tag: lib.elem tag cfg.enabled) (tagsOf name)) true))
    (lib.filter (name: !seatedOnly name) tagged));
  })
