{delib, ...}:
delib.module {
  name = "dependency";
  meta.description = "Supply a value to the module test runner fixture.";
  options.value = delib.strOption "from-dependency";
}
