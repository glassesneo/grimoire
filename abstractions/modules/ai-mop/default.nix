{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: {
  name = "ai-mop";
  tests.fixture = ["agents" "nix-secrets" "secrets"];
  meta.description = "Provide an isolated Pi workbench for trying INIAD AI MOP models and tool calls.";

  options = {
    enable = delib.boolOption false;
    providerSources = delib.readOnly (lib.mkOption {
      type = lib.types.path;
      default = lib.fileset.toSource {
        root = ./src;
        fileset = ./src/providers.ts;
      };
      defaultText = lib.literalExpression "./src/providers.ts";
      description = "Directory holding `providers.ts`, which defines AI MOP's routes as pi-ai providers for agents built on pi-ai, which supply the `@earendil-works/pi-ai` it imports.";
    });
  };

  constraints.ifEnabled = [
    {
      assertion = myconfig.secrets.enable;
      message = "ai-mop.enable = true requires secrets.enable = true to decrypt ai-mop-api-key";
    }
  ];

  myconfig.ifEnabled.secrets.required = ["ai-mop-api-key"];

  hjem.always = {config, ...}: let
    secrets = config.security.nix-secrets.secrets;
  in
    lib.mkIf (secrets ? ai-mop-api-key) {
      environment.sessionVariables.AI_MOP_API_KEY_FILE = secrets.ai-mop-api-key.path;
    };

  hjem.ifEnabled = {pkgs, ...}: {
    packages = [
      (import ./package.nix {
        inherit pkgs lib;
        pi = myconfig.agents.packages.pi;
      })
    ];
  };

  bundles.always = {pkgs, ...}: {
    ai-mop = {
      package = import ./package.nix {
        inherit pkgs lib;
        pi = myconfig.agents.packages.pi;
      };
      publish = true;
    };
  };

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: {
    typescript = {
      protects = "the AI MOP extension and its launcher check type-check and lint against the SDK of the Pi that loads them";
      uses = ["pi"];
      tsRoots = ["src"];
      build = result:
        typescriptCheck {
          name = "ai-mop";
          src = ./src;
          types = result.options.myconfig.pi.sdkTypes.value;
        };
    };
    diagnostics = {
      protects = "request diagnostics distinguish proxy schema and stream-framing failures from unrelated errors without logging tool schemas or contents";
      build = _:
        pkgs.runCommand "ai-mop-diagnostics" {nativeBuildInputs = [pkgs.nodejs];} ''
          node --experimental-strip-types ${./src}/diagnostics.test.ts
          touch "$out"
        '';
    };
    isolated-launch = {
      protects = "the launcher excludes inherited resources, defaults to only the test tools and permits explicit tool disablement; tool results reach the next model request";
      moduleSystem = "bundles";
      build = result:
        pkgs.runCommand "ai-mop-isolated-launch" {nativeBuildInputs = [pkgs.nodejs];} ''
          export HOME=$TMPDIR/home
          mkdir -p "$HOME"
          node --experimental-strip-types ${./src/launcher.test.ts} ${lib.getExe result.packages.ai-mop}
          touch "$out"
        '';
    };
  };
})
