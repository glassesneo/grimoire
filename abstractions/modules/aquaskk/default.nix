{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "aquaskk";
  meta.description = "Install AquaSKK and configure its keymap, dictionaries and user preferences.";
  tests.fixture = ["casks" "defaults" "exclusive" "imprynt" "input-methods" "xdg"];

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.packages.aquaskk;
    directClients = listOfOption lib.types.str [] "Bundle IDs of applications in which AquaSKK uses direct input instead of Japanese conversion.";
    userDictionaryPath = strOption "${myconfig.xdg.data}/skk/jisyo" "Writable learning dictionary, which AquaSKK writes and no deployment replaces.";
  };

  myconfig.ifEnabled.input-methods.enable = true;

  hjem.always = {
    config,
    pkgs,
    ...
  }: let
    app = "${cfg.package}/Library/Input Methods/AquaSKK.app";
    trees = import ./app-trees.nix {
      inherit pkgs lib;
      source = app;
    };
  in {
    imprynt.deployments.aquaskk = {
      root = "${config.directory}/Library/Input Methods";
      trees = lib.optionals cfg.enable [
        {
          source = "${trees}/regular";
          prefix = "AquaSKK.app";
          mode = 420;
        }
        {
          source = "${trees}/executable";
          prefix = "AquaSKK.app";
          mode = 493;
        }
      ];
    };
  };

  hjem.ifEnabled = {pkgs, ...}: let
    kanaRule = pkgs.runCommand "aquaskk-kana-rule.conf" {nativeBuildInputs = [pkgs.libiconv];} ''
      iconv -f UTF-8 -t EUC-JP ${./kana-rule.conf} > "$out"
    '';
    inputMethod = {
      "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
      InputSourceKind = "Keyboard Input Method";
    };
    inputMode = {
      "Bundle ID" = "jp.sourceforge.inputmethod.aquaskk";
      "Input Mode" = "com.apple.inputmethod.Japanese";
      InputSourceKind = "Input Mode";
    };
  in {
    files = {
      "Library/Application Support/AquaSKK/keymap.conf" = {
        exclusive = true;
        source = ./keymap.conf;
      };
      "Library/Application Support/AquaSKK/kana-rule.conf" = {
        exclusive = true;
        source = kanaRule;
      };
      "Library/Application Support/AquaSKK/DictionarySet.plist" = {
        exclusive = true;
        text = mylib.plist.toPlist [
          {
            active = true;
            location = "${pkgs.skkDictionaries.l}/share/skk/SKK-JISYO.L";
            type = 0;
          }
          {
            active = true;
            location = cfg.userDictionaryPath;
            type = 5;
          }
        ];
      };
    };

    inputMethods = {
      enabled = [inputMethod];
      selected = [inputMode];
      history = [inputMode];
    };

    platform.darwin.defaults."jp.sourceforge.inputmethod.aquaskk".settings = {
      user_dictionary_path = cfg.userDictionaryPath;
      keyboard_layout = "com.apple.keylayout.US";
      enable_skkserv = 1;
      skkserv_port = 1178;
      skkserv_localonly = 1;
      suppress_newline_on_commit = 1;
      fix_intermediate_conversion = 1;
      use_numeric_conversion = 1;
      show_input_mode_icon = 1;
      delete_okuri_when_quit = 1;
      enable_annotation = 1;
      enable_dynamic_completion = 1;
      enable_extended_completion = 1;
      dynamic_completion_range = 2;
      max_count_of_inline_candidates = 3;
      candidate_window_font_name = "Trebuchet MS";
      candidate_window_font_size = 18;
      candidate_window_labels = "ASDFJKL";
      put_candidate_window_upward = 1;
      use_individual_input_mode = 1;
      direct_clients = cfg.directClients;
    };

    applySteps.aquaskk = {
      before = ["defaults" "imprynt"];
      package = pkgs.writeShellScriptBin "apply" ''
        set -eu
        ${pkgs.coreutils}/bin/mkdir -p -- ${lib.escapeShellArg (dirOf cfg.userDictionaryPath)}
      '';
    };
    applySteps.imprynt.after = ["defaults"];
  };

  tests.cases = {pkgs, ...}: let
    fixtureApp = pkgs.runCommand "aquaskk-fixture" {} ''
      app="$out/Library/Input Methods/AquaSKK.app/Contents"
      mkdir -p "$app/MacOS" "$app/Resources"
      printf executable > "$app/MacOS/AquaSKK"
      chmod +x "$app/MacOS/AquaSKK"
      printf resource > "$app/Resources/with space"
    '';
    enabled = {
      aquaskk = {
        enable = true;
        package = fixtureApp;
      };
    };
  in {
    declared-preferences = {
      protects = "AquaSKK forwards a nonempty direct-client selection and a custom learning dictionary to its preferences";
      host.myconfig.ifEnabled = lib.recursiveUpdate enabled {
        aquaskk = {
          directClients = ["org.example.editor"];
          userDictionaryPath = "/synthetic/dictionaries/learning";
        };
      };
      expr = result: let
        settings = result.options.platform.darwin.defaults.value."jp.sourceforge.inputmethod.aquaskk".settings;
      in {inherit (settings) direct_clients user_dictionary_path;};
      expected = {
        direct_clients = ["org.example.editor"];
        user_dictionary_path = "/synthetic/dictionaries/learning";
      };
    };
    app-file-modes = {
      protects = "AquaSKK app deployment keeps executables executable and resources non-executable, including paths with spaces";
      host.myconfig.ifEnabled = enabled;
      build = result:
        pkgs.runCommand "aquaskk-app-modes" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.files | map({path, mode}) == [
            {path:"AquaSKK.app/Contents/MacOS/AquaSKK",mode:493},
            {path:"AquaSKK.app/Contents/Resources/with space",mode:420}
          ]' ${result.apply.steps.imprynt.deployments.aquaskk.manifest}
          touch "$out"
        '';
    };
    disabling-retains-removal = {
      protects = "disabling AquaSKK leaves an empty app deployment so its next switch retires the installed files";
      host.myconfig.ifEnabled.aquaskk.enable = false;
      build = result:
        pkgs.runCommand "aquaskk-disabled" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e '.version == 1 and (.files | length == 0)' ${result.apply.steps.imprynt.deployments.aquaskk.manifest}
          touch "$out"
        '';
    };
  };
})
