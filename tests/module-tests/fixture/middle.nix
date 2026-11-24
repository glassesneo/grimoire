{delib, ...}:
delib.module {
  name = "middle";
  tests.fixture = ["dependency"];
  meta.description = "Load the dependency in the fixtures that load this module.";
}
