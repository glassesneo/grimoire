{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: let
  settingsFile = "keel/settings.json";
  modelsFile = "keel/models.json";
  extensionsFile = "keel/extensions.json";
  build = pkgs:
    pkgs.callPackage ./package.nix {
      bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      inherit (cfg) defaultModel extraPackages settings;
      models = baseModels;
    };
  # models.json needs `providers` even when empty. Hjem adds its secret default
  # on top; that path never reaches the bundles.
  baseModels = lib.recursiveUpdate {providers = {};} cfg.models;
in {
  name = "shield";
  meta.description = "Provide the SHIELD process hub and the keel agent screens it attaches.";
  options = {pkgs, ...}:
    with delib; let
      json = (pkgs.formats.json {}).type;
    in {
      enable = boolOption true;
      settings = lib.mkOption {
        type = lib.types.addCheck (lib.types.attrsOf json) (settings: !(settings ? apiKeys)) // {description = "attribute set of JSON values without apiKeys";};
        default = {};
        description = "Pi settings, deployed read-only as keel/settings.json under the XDG config directory, keel's default configuration directory. Pi's own keys pass through unchanged; the key `apiKeys` is rejected, because Pi would migrate it into auth.json by rewriting the file and its values would enter the Nix store. Give credentials through `models` as a runtime reference or through Pi's auth.json. Changing the model or thinking level in keel is stored in the conversation, never here.";
      };
      models = lib.mkOption {
        type = lib.types.attrsOf json;
        default = {};
        description = "Pi models.json content (providers and their models), deployed read-only as keel/models.json; an empty set is deployed as {\"providers\": {}}, the form Pi requires. A value written here is stored in the world-readable Nix store, so write a credential as a runtime reference such as `!<absolute command> <quoted secret path>` that Pi runs when it needs the key. When the Hjem configuration declares the secret command-code-api-key, providers.command-code.apiKey defaults to such a reference; a value written here takes precedence.";
      };
      extraPackages = lib.mkOption {
        type = lib.types.listOf lib.types.package;
        default = [];
        description = "Packages whose bin directories lead the PATH of a new agent, ahead of the PATH inherited from the keel screen that starts it, and which are not installed for the user.";
      };
      extensions = lib.mkOption {
        type = lib.types.nullOr (lib.types.listOf lib.types.nonEmptyStr);
        default = ["commands" "model" "timeline" "markdown" "tools" "codemode" "queue" "commandcode"];
        description = "Extensions keel loads, deployed read-only as keel/extensions.json. An entry of lowercase letters, digits, and hyphens names an extension keel ships; any other entry, such as `mine.ts` or `/abs/ext.ts`, is the path of an extension file, absolute or relative to the configuration directory. keel loads no other Pi extension. null leaves extensions.json unmanaged.";
      };
      defaultModel = lib.mkOption {
        type = lib.types.nullOr (lib.types.strMatching "[^/]+/.+");
        default = "openai/gpt-6.1-sol";
        description = "Model, as provider/id, that a new keel agent uses when `settings` names neither defaultProvider nor defaultModel; it is written into the deployed settings.json. null leaves the choice to Pi.";
      };
    };

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    packages = build pkgs;
    secrets = config.security.nix-secrets.secrets;
    # The secret's content is read by Pi at run time, never at evaluation.
    secretModels = lib.optionalAttrs (secrets ? command-code-api-key) {
      providers.command-code.apiKey = "!${lib.getExe' pkgs.coreutils "cat"} ${lib.escapeShellArg secrets.command-code-api-key.path}";
    };
    models = lib.recursiveUpdate secretModels baseModels;
  in {
    packages = [packages.shield packages.keel];

    # Every file below is owned here; auth.json, models-store.json, keel's
    # keybindings.json, and the lock files beside them stay unmanaged.
    xdg.config.files =
      {
        ${settingsFile} = {
          exclusive = true;
          source = packages.shield.piConfig.settings;
        };
      }
      // {
        ${modelsFile} = {
          exclusive = true;
          text = builtins.toJSON models;
        };
      }
      // lib.optionalAttrs (cfg.extensions != null) {
        ${extensionsFile} = {
          exclusive = true;
          text = builtins.toJSON {inherit (cfg) extensions;};
        };
      };
  };

  bundles.ifEnabled = {pkgs, ...}: let
    packages = build pkgs;
  in {
    shield.package = packages.shield;
    keel.package = packages.keel;
  };

  # The module's Hjem output and the options of its package are checked; the
  # package's build and Pi's reading of the files belong to the checks that run
  # them.
  tests = {
    pkgs,
    home,
    ...
  }: let
    tool = pkgs.writeShellScriptBin "fixture-tool" "";
    target = name: "${home}/.config/${name}";
    deployed = name: result: let
      matches = lib.filter (file: file.target == target name) result.manifest.files;
    in
      if matches == []
      then null
      else builtins.fromJSON (builtins.unsafeDiscardStringContext (builtins.readFile (builtins.head matches).source));
    # A bundle is built for publication only when something publishes it.
    publishKeel.bundles.always.keel.publish = true;
    declared = {
      settings = {
        defaultProvider = "fixture";
        defaultModel = "fixture-model";
      };
      models.providers.fixture.baseUrl = "http://localhost:1/v1";
    };
  in {
    deploys-declared-pi-files = {
      host.myconfig.ifEnabled.shield = declared;
      expr = result: {
        settings = deployed settingsFile result;
        models = deployed modelsFile result;
      };
      expected = {
        inherit (declared) settings models;
      };
    };
    deploys-valid-empty-models = {
      expr = result: {
        settings = deployed settingsFile result;
        models = deployed modelsFile result;
      };
      expected = {
        settings = {};
        models.providers = {};
      };
      host.myconfig.ifEnabled.shield.defaultModel = null;
    };
    default-model-fills-undeclared-settings = {
      host.myconfig.ifEnabled.shield.defaultModel = "fixture/nested/model";
      expr = result: deployed settingsFile result;
      expected = {
        defaultProvider = "fixture";
        defaultModel = "nested/model";
      };
    };
    declared-settings-model-wins = {
      host.myconfig.ifEnabled.shield = declared // {defaultModel = "other/model";};
      expr = result: deployed settingsFile result;
      expected = declared.settings;
    };
    deploys-extensions = {
      host.myconfig.ifEnabled.shield.extensions = ["markdown" "/opt/keel/mine.ts"];
      expr = result: deployed extensionsFile result;
      expected.extensions = ["markdown" "/opt/keel/mine.ts"];
    };
    null-extensions-leave-file-unmanaged = {
      host.myconfig.ifEnabled.shield.extensions = null;
      expr = result: deployed extensionsFile result;
      expected = null;
    };
    rejects-empty-extension-entry = {
      host.myconfig.ifEnabled.shield.extensions = [""];
      expr = result: result.manifest.files;
      fails = true;
    };
    disabled-deploys-nothing = {
      host.myconfig.ifEnabled.shield.enable = false;
      expr = result: lib.filter (file: lib.hasInfix "/keel/" file.target) result.manifest.files;
      expected = [];
    };
    models-override-secret-default = {
      host.myconfig.ifEnabled.shield.models.providers.command-code.apiKey = "explicit";
      modules.secret.hjem.always.security.nix-secrets.secrets.command-code-api-key = {};
      expr = result: (deployed modelsFile result).providers.command-code.apiKey;
      expected = "explicit";
    };
    secret-default-is-runtime-reference = {
      modules.secret.hjem.always.security.nix-secrets.secrets.command-code-api-key = {};
      expr = result: lib.hasPrefix "!" (deployed modelsFile result).providers.command-code.apiKey;
      expected = true;
    };
    rejects-api-keys = {
      host.myconfig.ifEnabled.shield.settings.apiKeys.fixture = "synthetic";
      expr = result: result.manifest.files;
      fails = true;
    };
    extra-packages-reach-keel-only = {
      host.myconfig.ifEnabled.shield.extraPackages = [tool];
      modules.publish = publishKeel;
      expr = result: {
        installed = lib.any (path: path == toString tool) result.packages;
      };
      expected.installed = false;
    };
    keel-receives-tools-path = {
      host.myconfig.ifEnabled.shield.extraPackages = [tool];
      modules.publish = publishKeel;
      moduleSystem = "bundles";
      expr = result: lib.hasInfix (builtins.unsafeDiscardStringContext "--set SHIELD_TOOLS_PATH ${tool}/bin") result.keel.installPhase;
      expected = true;
    };
    keel-without-extra-packages-has-no-tools-path = {
      modules.publish = publishKeel;
      moduleSystem = "bundles";
      expr = result: lib.hasInfix "SHIELD_TOOLS_PATH" result.keel.installPhase;
      expected = false;
    };
    bundle-package-exposes-declared-config = {
      host.myconfig.ifEnabled.shield = declared;
      modules.publish = publishKeel;
      moduleSystem = "bundles";
      expr = result: let
        read = file: builtins.fromJSON (builtins.unsafeDiscardStringContext (builtins.readFile file));
      in {
        settings = read result.keel.piConfig.settings;
        models = read result.keel.piConfig.models;
      };
      expected = {
        inherit (declared) settings models;
      };
    };
  };
})
