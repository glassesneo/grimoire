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

  checks = {
    pkgs,
    home,
    system,
    oxlintConfig,
    ...
  }: let
    tool = pkgs.writeShellScriptBin "fixture-tool" "";
    target = name: "${home}/.config/${name}";
    deployed = name: result: lib.any (file: file.target == target name) result.manifest.files;
    # Inspect declared contents before Hjem realizes them; reading manifest sources
    # would require a foreign-platform builder during Linux evaluation on Darwin.
    deployment = expected: {
      modules.deployment.hjem.always = {config, ...}: {
        assertions =
          lib.mapAttrsToList (name: value: {
            assertion = builtins.fromJSON (builtins.unsafeDiscardStringContext config.xdg.config.files.${name}.text) == value;
            message = "shield fixture: unexpected ${name} contents";
          })
          expected;
      };
      expr = result: map (name: deployed name result) (builtins.attrNames expected);
      expected = map (_: true) (builtins.attrNames expected);
    };
    # The module publishes only where the packages build; these cases publish
    # them anyway to inspect their derivations on every platform.
    publishKeel.bundles.always.keel.publish = lib.mkForce true;
    # Publication follows where the packages build, read for a fixture system.
    publication = fixtureSystem: {
      moduleSystem = "bundles";
      host.system = fixtureSystem;
      expr = result: builtins.attrNames result.packages;
      expected = lib.optionals (lib.elem fixtureSystem (import ./platforms.nix)) ["keel" "shield"];
    };
    declared = {
      settings = {
        defaultProvider = "fixture";
        defaultModel = "fixture-model";
      };
      models.providers.fixture.baseUrl = "http://localhost:1/v1";
    };
    publishBoth.bundles.always = {
      shield.publish = lib.mkForce true;
      keel.publish = lib.mkForce true;
    };
  in
    # The Hjem configuration reads the secrets that nix-secrets declares.
    lib.mapAttrs (_: case: {uses = ["nix-secrets"];} // case) {
      published-where-available = publication (builtins.head (import ./platforms.nix));
      unpublished-elsewhere = publication "x86_64-linux";
      keel = {
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
        moduleSystem = "bundles";
        modules.publish = publishBoth;
        platforms = import ./platforms.nix;
        build = result:
          import ./checks/process.nix {
            inherit pkgs;
            inherit (result.packages) keel shield;
          };
      };
      deploys-declared-pi-files =
        deployment {
          ${settingsFile} = declared.settings;
          ${modelsFile} = declared.models;
        }
        // {host.myconfig.ifEnabled.shield = declared;};
      deploys-valid-empty-models =
        deployment {
          ${settingsFile} = {};
          ${modelsFile}.providers = {};
        }
        // {host.myconfig.ifEnabled.shield.defaultModel = null;};
      default-model-fills-undeclared-settings =
        deployment {
          ${settingsFile} = {
            defaultProvider = "fixture";
            defaultModel = "nested/model";
          };
        }
        // {host.myconfig.ifEnabled.shield.defaultModel = "fixture/nested/model";};
      declared-settings-model-wins =
        deployment {
          ${settingsFile} = declared.settings;
        }
        // {host.myconfig.ifEnabled.shield = declared // {defaultModel = "other/model";};};
      deploys-extensions =
        deployment {
          ${extensionsFile}.extensions = ["markdown" "/opt/keel/mine.ts"];
        }
        // {host.myconfig.ifEnabled.shield.extensions = ["markdown" "/opt/keel/mine.ts"];};
      null-extensions-leave-file-unmanaged = {
        host.myconfig.ifEnabled.shield.extensions = null;
        expr = result: deployed extensionsFile result;
        expected = false;
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
      models-override-secret-default =
        lib.recursiveUpdate (deployment {
          ${modelsFile}.providers.command-code.apiKey = "explicit";
        }) {
          host.myconfig.ifEnabled.shield.models.providers.command-code.apiKey = "explicit";
          modules.secret.hjem.always.security.nix-secrets.secrets.command-code-api-key = {};
        };
      secret-default-is-runtime-reference = {
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
        host.myconfig.ifEnabled.shield.settings.apiKeys.fixture = "synthetic";
        expr = result: result.manifest.files;
        fails = true;
      };
      extra-packages-reach-keel-only = {
        platforms = import ./platforms.nix;
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
        expr = result: lib.hasInfix (builtins.unsafeDiscardStringContext "--set SHIELD_TOOLS_PATH ${tool}/bin") result.packages.keel.installPhase;
        expected = true;
      };
      keel-without-extra-packages-has-no-tools-path = {
        modules.publish = publishKeel;
        moduleSystem = "bundles";
        expr = result: lib.hasInfix "SHIELD_TOOLS_PATH" result.packages.keel.installPhase;
        expected = false;
      };
      bundle-package-exposes-declared-config = {
        host.myconfig.ifEnabled.shield = declared;
        modules.publish = publishKeel;
        moduleSystem = "bundles";
        expr = result: let
          read = file: builtins.fromJSON file.text;
        in {
          settings = read result.packages.keel.piConfig.settings;
          models = read result.packages.keel.piConfig.models;
        };
        expected = {
          inherit (declared) settings models;
        };
      };
    };
})
