# Owns an application's table of scheme-specific themes, such as official
# ports, which exist for some schemes only.
#
# `schemeThemes { name, themes }` takes the application's module name and its
# table by scheme name; what an entry holds is the application's own. `of`
# returns the entry for a resolved scheme, or null for none or an absent
# scheme. `select` returns the entry the module follows: null while its
# `useColorscheme` is false or no scheme is selected. A followed scheme absent
# from the table cannot be realized, so `assertion` rejects it and names
# `<name>.useColorscheme = false`, which leaves the application's colors
# unmanaged. Bundles published per combination keep those `of` finds.
# `unsupportedCase` is a module check case whose host follows a scheme absent
# from every table, a copy of Rosé Pine registered as "fixture", and expects
# that rejection.
{lib}: {
  name,
  themes,
}: let
  of = resolved:
    if resolved == null
    then null
    else themes.${resolved.name} or null;
in {
  inherit of;

  select = cfg: resolved:
    if cfg.useColorscheme
    then of resolved
    else null;

  assertion = cfg: resolved: {
    assertion = !cfg.useColorscheme || resolved == null || of resolved != null;
    message = "${name} has no theme for colorscheme \"${resolved.name or ""}\"; set ${name}.useColorscheme = false to leave its colors unmanaged";
  };

  unsupportedCase = {
    modules.fixture.myconfig.always = {config, ...}: {
      colorscheme.schemes.fixture.palette = config.myconfig.colorscheme.schemes.rose-pine.palette;
    };
    host.myconfig.ifEnabled.colorscheme.selection.name = "fixture";
    fails = "${name} has no theme for colorscheme \"fixture\"";
  };
}
