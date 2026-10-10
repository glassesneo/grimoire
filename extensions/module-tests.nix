# Owns the inline tests of modules: the contract of one feature, kept beside it.
#
# A module's `tests` is a function of `{pkgs, lib, system, home}` returning test
# cases by name. `lib/module-tests.nix` evaluates each case in a fixture holding
# only the repository's adapters and extensions, the module itself, the modules
# named in `uses`, a host named `fixture` whose user's home is `home`, and the
# case's contributor modules. Mechanisms and checks spanning the published
# configurations stay under `tests/`.
#
# A case has these fields:
# - `host`: delib.host attributes added to the fixture host.
# - `modules`: contributor modules by name, as delib.module attributes; the name
#   and description are filled in.
# - `uses`: names of further repository modules to include.
# - `moduleSystem`: the module system to generate, `hjem` by default.
# - `expr` and `expected`: `expr` applied to the generated result must equal
#   `expected`.
# - `fails`: instead of `expected`, a string that a failed assertion message must
#   contain, or `true` when forcing `expr` must throw.
{lib, ...}: {
  settings.modules.extraSubmodules = {
    options.tests = lib.mkOption {
      type = lib.types.functionTo (lib.types.attrsOf lib.types.raw);
      default = _: {};
      description = "Test cases of this module's own contract, by name.";
    };
  };
}
