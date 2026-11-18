{
  delib,
  lib,
  ...
}:
delib.module {
  name = "input-methods";
  meta.description = "Register user input sources and own the shared HIToolbox input-source preferences.";
  tests.fixture = ["defaults"];

  options.enable = delib.boolOption false;

  hjem.always.options.inputMethods = lib.genAttrs ["enabled" "selected" "history"] (name:
    lib.mkOption {
      type = lib.types.listOf (lib.types.attrsOf lib.types.anything);
      default = [];
      description = "HIToolbox input-source entries contributed to the `${name}` list.";
    });

  hjem.ifEnabled = {config, ...}: let
    nonKeyboard = bundle: {
      "Bundle ID" = bundle;
      InputSourceKind = "Non Keyboard Input Method";
    };
    abc = {
      InputSourceKind = "Keyboard Layout";
      "KeyboardLayout ID" = 252;
      "KeyboardLayout Name" = "ABC";
    };
  in {
    platform.darwin.defaults."com.apple.HIToolbox".settings = {
      AppleGlobalTextInputProperties.TextInputGlobalPropertyPerContextInput = true;
      AppleEnabledInputSources =
        [
          (nonKeyboard "com.apple.CharacterPaletteIM")
          (nonKeyboard "com.apple.PressAndHold")
          abc
          (nonKeyboard "com.apple.50onPaletteIM")
        ]
        ++ config.inputMethods.enabled;
      AppleSelectedInputSources = [(nonKeyboard "com.apple.PressAndHold")] ++ config.inputMethods.selected;
      AppleInputSourceHistory = config.inputMethods.history ++ [abc];
    };
  };

  tests.cases = _: {
    independent-contributions = {
      protects = "independent input-method features retain all their enabled input-source entries";
      host.myconfig.ifEnabled.input-methods.enable = true;
      modules = lib.genAttrs ["first" "second"] (name: {
        hjem.always.inputMethods.enabled = [{"Bundle ID" = "fixture-${name}";}];
      });
      expr = result:
        lib.sort lib.lessThan (map (entry: entry."Bundle ID")
          (lib.filter (entry: lib.hasPrefix "fixture-" (entry."Bundle ID" or ""))
            result.options.platform.darwin.defaults.value."com.apple.HIToolbox".settings.AppleEnabledInputSources));
      expected = ["fixture-first" "fixture-second"];
    };
  };
}
