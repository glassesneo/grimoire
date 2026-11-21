{
  delib,
  mylib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "ghostty.colorscheme";
  tests.fixture = ["ghostty" "roles.colorscheme"];
  meta = {
    description = "Give Ghostty the colors of the held color scheme's palette.";
    follows = ["colorscheme"];
  };

  options.enable = delib.boolOption true;

  myconfig.ifEnabled.ghostty.settings = mylib.colorschemes.ghosttyTheme myconfig.roles.colorscheme.resolved.palette;
})
