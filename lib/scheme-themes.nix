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
