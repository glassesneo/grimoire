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
          text = packages.shield.piConfig.settings.text;
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

  # Published where the packages build; whether they are available is read
  # from their metadata without building them.
  bundles.ifEnabled = {pkgs, ...}: let
    packages = build pkgs;
    bundle = package: {
      inherit package;
      publish = lib.meta.availableOn pkgs.stdenv.hostPlatform package;
    };
  in {
    shield = bundle packages.shield;
    keel = bundle packages.keel;
  };

  tests = {
    pkgs,
    home,
    system,
    oxlintConfig,
    ...
  }: let
    target = name: "${home}/.config/${name}";
    deployed = name: result: lib.any (file: file.target == target name) result.manifest.files;
    # The module publishes only where the packages build; these cases publish
    # them anyway to inspect their derivations on every platform.
    publishBoth.bundles.always = {
      shield.publish = lib.mkForce true;
      keel.publish = lib.mkForce true;
    };
  in
    # The Hjem configuration reads the secrets that nix-secrets declares.
    lib.mapAttrs (_: case: {uses = ["nix-secrets"];} // case) {
      keel = {
        protects = "keel's own tests, type checks and lints pass on the published package";
        moduleSystem = "bundles";
        modules.publish = publishBoth;
        platforms = import ./platforms.nix;
        tsRoots = ["."];
        build = result:
          import ./checks/keel.nix {
            inherit pkgs oxlintConfig;
            bun2nix = inputs.bun2nix.packages.${system}.default;
            inherit (result.packages) keel;
          };
      };
      # The committed generated contracts are what the TypeSpec sources generate.
      contracts = {
        protects = "the committed generated contracts are what the TypeSpec sources generate";
        moduleSystem = "bundles";
        modules.publish = publishBoth;
        platforms = import ./platforms.nix;
        build = result:
          pkgs.runCommand "shield-contracts-current" {} ''
            if ! diff -ru ${result.packages.shield.contracts} ${./contracts/generated}; then
              echo "contracts/generated is stale; run just shield-contracts" >&2
              exit 1
            fi
            touch "$out"
          '';
      };
      process = {
        protects = "keel and shield run together as published, without credentials";
        moduleSystem = "bundles";
        modules.publish = publishBoth;
        platforms = import ./platforms.nix;
        build = result:
          import ./checks/process.nix {
            inherit pkgs;
            inherit (result.packages) keel shield;
          };
      };
      secret-default-is-runtime-reference = {
        protects = "a provider's API key reaches models.json only as a runtime reference to its secret";
        modules.secret.hjem.always = {config, ...}: {
          security.nix-secrets.secrets.command-code-api-key = {};
          assertions = [
            {
              assertion = lib.hasPrefix "!" (builtins.fromJSON (builtins.unsafeDiscardStringContext config.xdg.config.files.${modelsFile}.text)).providers.command-code.apiKey;
              message = "shield fixture: secret must be a runtime reference";
            }
          ];
        };
        expr = result: deployed modelsFile result;
        expected = true;
      };
      rejects-api-keys = {
        protects = "API keys cannot be declared in plaintext settings";
        host.myconfig.ifEnabled.shield.settings.apiKeys.fixture = "synthetic";
        expr = result: result.manifest.files;
        fails = true;
      };
    };
})
