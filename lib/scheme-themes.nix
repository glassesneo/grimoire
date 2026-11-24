{documented}:
documented {
  description = "An application's table of scheme-specific themes, such as official ports. `of` returns the entry for a resolved scheme, or null for a scheme absent from the table, and `constraint` rejects a held scheme absent from it, naming `<name>.colorscheme.enable = false`, which leaves the application's colors unmanaged.";
  arguments = {
    name = "The application's module name.";
    themes = "The table by scheme name; what an entry holds is the application's own.";
  };
} ({
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
})
