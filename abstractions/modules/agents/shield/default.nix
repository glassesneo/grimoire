{
  delib,
  inputs,
  lib,
  ...
}:
delib.module ({cfg, ...}: let
  settingsFile = "shield/pi/settings.json";
  modelsFile = "shield/pi/models.json";
  build = pkgs:
    pkgs.callPackage ./package.nix {
      bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
      inherit (cfg) defaultModel keys extraPackages settings;
      models = baseModels;
    };
  # models.json needs `providers` even when empty. Hjem adds its secret default
  # on top; that path never reaches the bundles.
  baseModels = lib.recursiveUpdate {providers = {};} cfg.models;
in {
  name = "shield";
  meta.description = "Provide the SHIELD process hub and quin attachable Pi client.";
  options = {pkgs, ...}:
    with delib; let
      json = (pkgs.formats.json {}).type;
    in {
      enable = boolOption true;
      settings = lib.mkOption {
        type = lib.types.addCheck (lib.types.attrsOf json) (settings: !(settings ? apiKeys)) // {description = "attribute set of JSON values without apiKeys";};
        default = {};
        description = "Pi settings, deployed read-only as shield/pi/settings.json under the XDG config directory. Pi's own keys pass through unchanged; the key `apiKeys` is rejected, because Pi would migrate it into auth.json by rewriting the file and its values would enter the Nix store. Give credentials through `models` as a runtime reference or through Pi's auth.json. Changing the model or thinking level in quin is stored in the conversation, never here.";
      };
      models = lib.mkOption {
        type = lib.types.attrsOf json;
        default = {};
        description = "Pi models.json content (providers and their models), deployed read-only as shield/pi/models.json; an empty set is deployed as {\"providers\": {}}, the form Pi requires. A value written here is stored in the world-readable Nix store, so write a credential as a runtime reference such as `!<absolute command> <quoted secret path>` that Pi runs when it needs the key. When the Hjem configuration declares the secret command-code-api-key, providers.command-code.apiKey defaults to such a reference; a value written here takes precedence.";
      };
      extraPackages = lib.mkOption {
        type = lib.types.listOf lib.types.package;
        default = [];
        description = "Packages whose bin directories lead the PATH of a new live agent, ahead of the PATH inherited from quin, and which are not installed for the user.";
      };
      defaultModel = lib.mkOption {
        type = lib.types.nullOr (lib.types.strMatching "[^/]+/.+");
        default = "openai/gpt-6.1-sol";
        description = "Model, as provider/id, that quin uses for a new live agent when neither --model nor the dedicated Pi settings name one; null leaves quin without one.";
      };
      keys = description (attrsOfOption (lib.types.listOf lib.types.str) {}) "quin key bindings by action id (<layer>.<name>, such as timeline.cursor-down or global.detach). Each listed action's chords, such as ctrl+f or shift+tab, replace its defaults; an empty list unbinds it. A key is one character or a name OpenTUI reports, such as return, escape, or space; a capital letter is written shift+<letter>. A character chord, including space, passes through to text input, except for the palette's argument action. The editor layer cannot bind a character chord. Building quin rejects unknown actions, unknown key names, such bindings, and chords bound twice in one layer.";
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
    packages = [packages.shield packages.quin];

    # Every file below is owned here; auth.json, models-store.json and the
    # lock files beside them stay unmanaged so Pi can write them.
    xdg.config.files =
      {
        ${settingsFile} = {
          exclusive = true;
          text = builtins.toJSON cfg.settings;
        };
      }
      // {
        ${modelsFile} = {
          exclusive = true;
          text = builtins.toJSON models;
        };
      };
  };

  bundles.ifEnabled = {pkgs, ...}: let
    packages = build pkgs;
  in {
    shield.package = packages.shield;
    quin.package = packages.quin;
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
    publishQuin.bundles.always.quin.publish = true;
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
    };
    disabled-deploys-nothing = {
      host.myconfig.ifEnabled.shield.enable = false;
      expr = result: lib.filter (file: lib.hasInfix "/shield/" file.target) result.manifest.files;
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
    extra-packages-reach-quin-only = {
      host.myconfig.ifEnabled.shield.extraPackages = [tool];
      modules.publish = publishQuin;
      expr = result: {
        installed = lib.any (path: path == toString tool) result.packages;
      };
      expected.installed = false;
    };
    quin-receives-tools-path = {
      host.myconfig.ifEnabled.shield.extraPackages = [tool];
      modules.publish = publishQuin;
      moduleSystem = "bundles";
      expr = result: lib.hasInfix (builtins.unsafeDiscardStringContext "--set SHIELD_TOOLS_PATH ${tool}/bin") result.quin.installPhase;
      expected = true;
    };
    quin-without-extra-packages-has-no-tools-path = {
      modules.publish = publishQuin;
      moduleSystem = "bundles";
      expr = result: lib.hasInfix "SHIELD_TOOLS_PATH" result.quin.installPhase;
      expected = false;
    };
    bundle-package-exposes-declared-config = {
      host.myconfig.ifEnabled.shield = declared;
      modules.publish = publishQuin;
      moduleSystem = "bundles";
      expr = result: let
        read = file: builtins.fromJSON (builtins.unsafeDiscardStringContext (builtins.readFile file));
      in {
        settings = read result.quin.piConfig.settings;
        models = read result.quin.piConfig.models;
      };
      expected = {
        inherit (declared) settings models;
      };
    };
    quin-receives-session-resolver = {
      modules.publish = publishQuin;
      moduleSystem = "bundles";
      expr = result: lib.hasInfix "--set SHIELD_SESSION_RESOLVER " result.quin.installPhase;
      expected = true;
    };
  };
})
