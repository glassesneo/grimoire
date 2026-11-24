{
  delib,
  config,
  lib,
  ...
}: let
  tagsOf = name: config.modules.${name}.meta.tags;
  # Module names come from metadata alone and enabled tags are read only inside
  # conditions, so `myconfig` does not depend on itself.
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

    tests.cases = _: let
      tagged = meta: {
        meta = meta // {description = "Carry a tag.";};
        options.enable = delib.boolOption false;
      };
    in {
      tagged-module-enabled = {
        protects = "a module carrying a selected tag is enabled by default";
        modules.probe = tagged {tags = ["probe"];};
        host.myconfig.ifEnabled.tags.enabled = ["probe"];
        expr = result: result.options.myconfig.probe.enable.value;
        expected = true;
      };
      unselected-tag-leaves-module = {
        protects = "a module carrying only tags that are not selected keeps its own default";
        modules.probe = tagged {tags = ["probe"];};
        expr = result: result.options.myconfig.probe.enable.value;
        expected = false;
      };
      seated-candidate-left-to-its-seat = {
        protects = "a candidate of a seated-only role is not enabled by its tags, since the seat decides its enable";
        uses = ["roles.launcher"];
        modules.probe = tagged {
          tags = ["probe"];
          role = "launcher";
        };
        host.myconfig.ifEnabled.tags.enabled = ["probe"];
        expr = result: result.options.myconfig.probe.enable.value;
        expected = false;
      };
    };

    myconfig.always = lib.foldl' lib.recursiveUpdate {} (map (name:
      lib.setAttrByPath (lib.splitString "." name ++ ["enable"])
      (lib.mkIf (lib.any (tag: lib.elem tag cfg.enabled) (tagsOf name)) true))
    (lib.filter (name: !seatedOnly name) tagged));
  })
