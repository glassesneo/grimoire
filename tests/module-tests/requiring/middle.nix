# Requires the dependency without test cases of its own.
{delib, ...}:
delib.module {
  name = "middle";
  requires = ["dependency"];
  meta.description = "Require the dependency for the modules that require it.";
}
