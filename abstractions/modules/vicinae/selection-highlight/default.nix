{delib, ...}:
delib.module {
  name = "vicinae.selection-highlight";
  tests.fixture = ["vicinae"];
  meta.description = "Animate the Vicinae selection highlight as it moves between list items.";

  options.enable = delib.boolOption false;

  myconfig.ifEnabled.vicinae.patches = [./selection-highlight.patch];
}
