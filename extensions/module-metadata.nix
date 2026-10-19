# Owns module responsibility descriptions and classification tags, not host metadata.
# Every module must declare a non-blank meta.description, even when disabled.
# Force descriptions when generating modules so lazy evaluation cannot skip them.
# meta.tags describes only the declaring module; tags are not inherited and do not
# affect enablement. Consumers read them through config.modules.<name>.meta.tags.
{
  lib,
  config,
  ...
}: {
  config.settings.modules.extraSubmodules = {
    options.meta = {
      description = lib.mkOption {
        type = lib.types.addCheck lib.types.str (value: builtins.match "[[:space:]]*" value == null);
        description = "One-sentence responsibility of this module, not an inventory of its current settings.";
      };
      tags = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Classification labels declared for this module.";
      };
    };
  };

  options.rawModules = lib.mapAttrs (_: _:
    lib.mkOption {
      apply = rawModules:
        builtins.deepSeq
        (lib.mapAttrs (_: module: module.meta.description) config.modules)
        rawModules;
    })
  config.moduleSystems;
}
