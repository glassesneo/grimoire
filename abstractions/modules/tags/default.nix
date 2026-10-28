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
      enabled = listOfOption (types.enum knownTags) [];
    };

    # A default only, so a host's own `enable = false` excludes a tagged module.
    myconfig.always = lib.foldl' lib.recursiveUpdate {} (map (name:
      lib.setAttrByPath (lib.splitString "." name ++ ["enable"])
      (lib.mkIf (lib.any (tag: lib.elem tag cfg.enabled) (tagsOf name)) (lib.mkDefault true)))
    tagged);

    checks = _: let
      app = tags: {
        meta = {
          description = "Stand in for a tagged application.";
          inherit tags;
        };
        options.enable = delib.boolOption false;
      };
      modules = {
        gui-app = app ["gui"];
        excluded-app = app ["gui"];
        cli-app = app ["cli"];
      };
      enables = result: lib.genAttrs (builtins.attrNames modules) (name: result.config.myconfig.${name}.enable);
    in {
      enable-selected = {
        inherit modules;
        moduleSystem = "darwin";
        host.myconfig.ifEnabled = {
          tags.enabled = ["gui"];
          excluded-app.enable = false;
        };
        expr = enables;
        expected = {
          gui-app = true;
          excluded-app = false;
          cli-app = false;
        };
      };
      unknown-tag = {
        inherit modules;
        moduleSystem = "darwin";
        host.myconfig.ifEnabled.tags.enabled = ["missing"];
        expr = result: result.config.myconfig.tags.enabled;
        fails = true;
      };
    };
  })
