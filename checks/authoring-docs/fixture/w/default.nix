{delib, ...}:
delib.module {
  name = "w";
  meta.description = "Writes a value of a.";

  options.enable = delib.boolOption false;

  myconfig.ifEnabled.a.value = "w";
}
