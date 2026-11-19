# Owns an application's table of scheme-specific themes, such as official
# ports, which exist for some schemes only.
#
# `schemeThemes { name, themes }` takes the application's module name and its
# table by scheme name; what an entry holds is the application's own. `of`
# returns the entry for a resolved scheme, or null for a scheme absent from
# the table. The application's `<name>.colorscheme` module follows the role
# `roles.colorscheme`; a held scheme absent from the table cannot be realized,
# so `constraint` rejects it and names `<name>.colorscheme.enable = false`,
# which leaves the application's colors unmanaged. Bundles published per
# combination keep those `of` finds.
{
  name,
  themes,
}: let
  of = resolved: themes.${resolved.name} or null;
in {
  inherit of;

  constraint = resolved: {
    assertion = of resolved != null;
    message = "${name} has no theme for colorscheme \"${resolved.name}\"; set ${name}.colorscheme.enable = false to leave its colors unmanaged";
  };
}
