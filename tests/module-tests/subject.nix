{
  delib,
  lib,
  ...
}:
delib.module {
  name = "subject";
  meta.description = "Exercise the module test runner.";
  options.enable = delib.boolOption true;

  hjem.always.options.marker = lib.mkOption {
    type = lib.types.str;
    default = "default";
  };

  hjem.ifEnabled = {config, ...}: {
    assertions = [
      {
        assertion = config.marker != "bad";
        message = "subject: marker must not be bad";
      }
    ];
    files.${config.marker}.text = config.marker;
  };

  tests = {
    home,
    pkgs,
    ...
  }: let
    targets = result: map (file: file.target) result.manifest.files;
  in {
    build = {
      build = result:
        pkgs.runCommand "fixture-build" {
          target = builtins.head (targets result);
        } ''
          test "$target" = "${home}/default"
          printf '%s' "$target" > "$out"
        '';
    };
    excluded = {
      platforms = [];
      tsRoots = ["." "sub/./nested"];
      build = _: throw "excluded builder forced";
      expr = throw "excluded expression forced";
    };
    default = {
      expr = targets;
      expected = ["${home}/default"];
    };
    contributor = {
      modules.contributor.hjem.always.marker = "contributed";
      expr = targets;
      expected = ["${home}/contributed"];
    };
    host = {
      host.myconfig.ifEnabled.subject.enable = false;
      expr = targets;
      expected = [];
    };
    uses = {
      uses = ["dependency"];
      modules.reader.hjem.always = {config, ...}: {marker = config.myconfig.dependency.value;};
      expr = targets;
      expected = ["${home}/from-dependency"];
    };
    assertion = {
      modules.contributor.hjem.always.marker = "bad";
      fails = "must not be bad";
    };
    throws = {
      expr = _: throw "expected";
      fails = true;
    };
    # Forcing must not descend into a derivation's build graph.
    throws-beside-derivation = {
      expr = _: [pkgs.hello (throw "expected")];
      fails = true;
    };
  };
}
