# Owns the metadata of roles: the seat `delib.role` (`lib/roles.nix`) marks on
# the module `roles.<name>` it declares, and `meta.role`, by which a module
# becomes a candidate for that seat whatever its enable.
#
# A module whose name starts with `roles.` is a role only when `delib.role`
# declares it, and a module's `meta.role` names a declared role; both are
# rejected otherwise, as constraints of the module.
{
  lib,
  config,
  ...
}: let
  inherit (config) modules;
  isRole = name: modules ? ${name} && modules.${name}.seat != null;
in {
  config.settings.modules.extraSubmodules = {
    name,
    config,
    ...
  }: {
    options = {
      meta.role = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        description = "Role whose seat this module can hold, by the role's name; `roles.<name>.holder` selects the holder.";
      };
      seat = lib.mkOption {
        type = lib.types.nullOr (lib.types.submodule {
          options.seatedOnly = lib.mkOption {
            type = lib.types.bool;
            internal = true;
            description = "Whether the seat decides its candidates' enable.";
          };
        });
        default = null;
        internal = true;
        description = "Set by `delib.role` on the module `roles.<name>` it declares.";
      };
    };

    config.constraints.always =
      lib.optional (lib.hasPrefix "roles." name) {
        assertion = config.seat != null;
        message = "module ${name} is in the roles namespace; declare it with delib.role";
      }
      ++ lib.optional (config.meta.role != null) {
        assertion = isRole "roles.${config.meta.role}";
        message = "${name}: meta.role = \"${config.meta.role}\" names no role declared with delib.role";
      };
  };
}
