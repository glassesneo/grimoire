{
  delib,
  inputs,
  lib,
  mylib,
  ...
}:
delib.module ({cfg, ...}: let
  # Providers EDITH can use: by the stored secret holding an API key and the variable pi-ai
  # reads it from, or, with `login`, by a credential placed in EDITH's credentials file.
  providers = {
    openai.login = true;
    openrouter = {
      secret = "openrouter-api-key";
      variable = "OPENROUTER_API_KEY";
    };
    vercel-ai-gateway = {
      secret = "vercel-ai-gateway-api-key";
      variable = "AI_GATEWAY_API_KEY";
    };
    opencode = {
      secret = "opencode-api-key";
      variable = "OPENCODE_API_KEY";
    };
    zai = {
      secret = "zai-api-key";
      variable = "ZAI_API_KEY";
    };
  };
  thinkingLevels = ["off" "minimal" "low" "medium" "high" "xhigh" "max"];
  discordToken = "discord-bot-token";
  keyed = lib.filter (name: providers.${name} ? secret) (
    lib.unique (lib.optional (cfg.defaults.model != null) cfg.defaults.model.provider ++ cfg.providers)
  );
  program = pkgs:
    import ./package.nix {
      inherit lib;
      bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
    };
  node = pkgs: [(lib.getExe pkgs.nodejs) "--experimental-strip-types" "--disable-warning=ExperimentalWarning"];
in {
  name = "edith";
  tests.fixture = ["secrets" "services"];
  meta.description = "Run EDITH, a resident agent on pi-durable whose conversations clients such as Discord reach by address.";

  options = {
    enable = delib.boolOption false;
    defaults = {
      model = mylib.atomicOption (lib.mkOption {
        type = lib.types.nullOr (lib.types.submodule {
          options = {
            provider = lib.mkOption {type = lib.types.enum (builtins.attrNames providers);};
            modelId = lib.mkOption {type = lib.types.nonEmptyStr;};
          };
        });
        default = null;
        description = "Model of every conversation that does not set its own; an `openai` model authenticates with the login in EDITH's credentials file, `$XDG_STATE_HOME/edith/auth.json`, placed there by hand. A higher source replaces it whole.";
      });
      thinkingLevel = delib.allowNull (delib.enumOption thinkingLevels null) "Thinking level of every conversation that does not set its own; `null` leaves it to pi-durable.";
    };
    providers = delib.listOfOption (lib.types.enum (builtins.attrNames providers)) [] "Providers besides the default model's whose API keys EDITH loads, so that a conversation can switch to their models.";
    discord = {
      enable = delib.boolOption false;
      allowedUsers = delib.listOfOption (lib.types.strMatching "[0-9]+") [] "Discord user IDs whose messages EDITH answers; it ignores everyone else.";
    };
  };

  constraints.ifEnabled = [
    {
      assertion = cfg.defaults.model != null;
      message = "edith.enable = true requires edith.defaults.model = { provider; modelId; }";
    }
    {
      assertion = !cfg.discord.enable || cfg.discord.allowedUsers != [];
      message = "edith.discord.enable = true requires a non-empty edith.discord.allowedUsers";
    }
  ];

  myconfig.ifEnabled.secrets.required = map (name: providers.${name}.secret) keyed ++ lib.optional cfg.discord.enable discordToken;

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: let
    secret = name: config.security.nix-secrets.secrets.${name}.path;
    stateDirectory = "${config.xdg.state.directory}/edith";
    socket = "${stateDirectory}/edith.sock";
    settings = pkgs.writeText "edith.json" (builtins.toJSON {
      storage = "${stateDirectory}/session.sqlite";
      # A login, such as a copy of Pi's ChatGPT login in its auth.json, is placed here by hand.
      credentials = "${stateDirectory}/auth.json";
      inherit socket;
      providerKeys = lib.listToAttrs (map (name: lib.nameValuePair providers.${name}.variable (secret providers.${name}.secret)) keyed);
      profiles.default = lib.filterAttrs (_: value: value != null) {
        inherit (cfg.defaults) model thinkingLevel;
      };
      discord =
        if cfg.discord.enable
        then {
          tokenFile = secret discordToken;
          inherit (cfg.discord) allowedUsers;
        }
        else null;
    });
    client = pkgs.writeShellScriptBin "edith" ''
      export EDITH_SOCKET=${lib.escapeShellArg socket}
      exec ${lib.escapeShellArgs (node pkgs)} ${program pkgs}/lib/src/cli.ts "$@"
    '';
  in {
    packages = [client];
    userServices.edith = {
      command = node pkgs ++ ["${program pkgs}/lib/src/main.ts"];
      environment.EDITH_CONFIG = toString settings;
      # Keys and the bot token are in place only once activation has run.
      dependsOn = lib.optional (config.userServices ? nix-secrets-activate) "nix-secrets-activate";
      restart = "always";
      logFile = "${config.directory}/Library/Logs/edith.log";
    };
  };

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: {
    typescript = {
      protects = "EDITH's core, clients and tests type-check and lint against pi-durable, discord.js core and the Node.js that runs them";
      tsRoots = ["src"];
      build = _:
        typescriptCheck {
          name = "edith";
          src = ./src;
          types = ./.;
        };
    };
    contracts = {
      protects = "EDITH keeps one conversation per address that persists across restarts, applies a namespace's profile unless a conversation overrides it, writes refreshed credentials back to its credentials file, parses model arguments and splits answers within a message limit";
      tsRoots = ["src"];
      build = _:
        pkgs.runCommand "edith-contracts" {} ''
          export HOME=$TMPDIR
          ${lib.escapeShellArgs (node pkgs)} --test ${program pkgs}/lib/src/*.test.ts
          touch "$out"
        '';
    };
  };
})
