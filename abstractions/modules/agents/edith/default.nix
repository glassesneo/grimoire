{
  delib,
  inputs,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  aiMopKey = {
    secret = "ai-mop-api-key";
    variable = "AI_MOP_API_KEY";
  };
  providers = {
    openai.login = true;
    ai-mop-responses = aiMopKey;
    ai-mop-chat = aiMopKey;
    ai-mop-anthropic = aiMopKey;
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
    lib.unique (lib.mapAttrsToList (_: persona: persona.model.provider) cfg.personas ++ cfg.providers)
  );
  servers = lib.unique (lib.concatMap (access: access.mcpServers) (lib.attrValues cfg.access));
  toolNames = ["read" "write" "edit" "bash"];
  toolUser = cfg.toolUser.name;
  toolHome = "/Users/${toolUser}";
  hasToolUser = cfg.toolUser.loginKey != null;
  persona = lib.types.submodule {
    options = {
      model = lib.mkOption {
        type = lib.types.submodule {
          options = {
            provider = lib.mkOption {type = lib.types.enum (builtins.attrNames providers);};
            modelId = lib.mkOption {type = lib.types.nonEmptyStr;};
          };
        };
        description = "Model of the persona's conversations unless one sets its own.";
      };
      thinkingLevel = lib.mkOption {
        type = lib.types.enum thinkingLevels;
        description = "Thinking level of the persona's conversations unless one sets its own.";
      };
    };
  };
  access = lib.types.submodule {
    options = {
      tools = lib.mkOption {
        type = lib.types.listOf (lib.types.enum toolNames);
        description = "pi-durable's tools the conversations' code mode scripts may call, by name; they run as `edith.toolUser`.";
      };
      mcpServers = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        description = "Registered MCP servers whose tools the conversations' code mode scripts may call; with neither tools nor servers, the model gets no tools.";
      };
      maxTurns = lib.mkOption {
        type = lib.types.nullOr lib.types.ints.positive;
        description = "Tool rounds one run takes at most; `null` sets no limit.";
      };
    };
  };
  namespace = lib.types.submodule ({config, ...}: {
    options = {
      access = lib.mkOption {
        type = lib.types.str;
        default = "restricted";
        description = "Access of the namespace's conversations that choose none.";
      };
      ceiling = lib.mkOption {
        type = lib.types.str;
        default = config.access;
        defaultText = lib.literalExpression "access";
        description = "Greatest access the namespace's conversations may choose: those within it, granting no tool or server it lacks and no more tool rounds.";
      };
      persona = lib.mkOption {
        type = lib.types.str;
        default = "edith";
        description = "Persona of the namespace's conversations that choose none.";
      };
    };
  });
  within = a: b:
    lib.all (tool: lib.elem tool b.tools) a.tools
    && lib.all (server: lib.elem server b.mcpServers) a.mcpServers
    && (b.maxTurns == null || (a.maxTurns != null && a.maxTurns <= b.maxTurns));
  choiceNames = lib.attrNames cfg.access ++ lib.attrNames cfg.personas;
  program = pkgs: aiMop:
    import ./package.nix {
      inherit lib aiMop;
      bun2nix = inputs.bun2nix.packages.${pkgs.stdenv.hostPlatform.system}.default;
    };
  node = pkgs: [(lib.getExe pkgs.nodejs) "--experimental-strip-types" "--disable-warning=ExperimentalWarning"];
in {
  name = "edith";
  tests.fixture = ["ai-mop" "mcp" "secrets" "services"];
  meta.description = "Provide EDITH, an agent on pi-durable whose conversations clients such as Discord reach by address, as a resident service and as `edith dev` for trying it out.";

  options = {
    enable = delib.boolOption false;
    resident.enable = delib.boolOption false;
    access = mylib.atomicOption (lib.mkOption {
      type = lib.types.attrsOf access;
      default = {};
      description = "What conversations may do, by name; only the configuration defines it, and a conversation chooses one within its namespace's ceiling.";
    });
    personas = mylib.atomicOption (lib.mkOption {
      type = lib.types.attrsOf persona;
      default = {};
      description = "Who answers, by name: the model and thinking level conversations follow unless they set their own.";
    });
    namespaces = delib.attrsOfOption namespace {} "Access, ceiling and persona by address namespace, such as `cli` or `discord`; a namespace not listed has `restricted` as access and ceiling and `edith` as persona.";
    providers = delib.listOfOption (lib.types.enum (builtins.attrNames providers)) [] "Providers besides the personas' models' whose API keys EDITH loads, so that a conversation can switch to their models.";
    toolUser = {
      name = delib.strOption "edith" "User the accesses' tools run as, with its home as their working directory; the host's own user and its files stay out of their reach.";
      uid = delib.intOption 550 "UID, and GID of its group of the same name, of `edith.toolUser.name`.";
      loginKey = delib.allowNull (delib.strOption null) "OpenSSH public key of EDITH's `$XDG_STATE_HOME/edith/tools/id_ed25519`, which may log in as the tool user from this host only; without it no user is created and no access may name tools. Rotate it by replacing the key files and this value in one switch.";
    };
    discord = {
      enable = delib.boolOption false;
      allowedUsers = delib.listOfOption (lib.types.strMatching "[0-9]+") [] "Discord user IDs whose messages EDITH answers; it ignores everyone else.";
    };
  };

  constraints.ifEnabled = [
    {
      assertion = cfg.access ? restricted && cfg.personas ? edith;
      message = "edith.enable = true requires edith.access.restricted and edith.personas.edith, which serve namespaces not listed";
    }
    (let
      undeclared = lib.concatLists (lib.mapAttrsToList (name: namespace:
        lib.optional (!(cfg.access ? ${namespace.access})) "edith.namespaces.${name}.access = \"${namespace.access}\""
        ++ lib.optional (!(cfg.access ? ${namespace.ceiling})) "edith.namespaces.${name}.ceiling = \"${namespace.ceiling}\""
        ++ lib.optional (!(cfg.personas ? ${namespace.persona})) "edith.namespaces.${name}.persona = \"${namespace.persona}\"")
      cfg.namespaces);
    in {
      assertion = undeclared == [];
      message = "${lib.concatStringsSep ", " undeclared} names no entry of edith.access or edith.personas";
    })
    (let
      exceeding = lib.mapAttrsToList (name: namespace: "edith.namespaces.${name}.access = \"${namespace.access}\" exceeds its ceiling \"${namespace.ceiling}\"") (lib.filterAttrs (_: namespace: cfg.access ? ${namespace.access} && cfg.access ? ${namespace.ceiling} && !(within cfg.access.${namespace.access} cfg.access.${namespace.ceiling})) cfg.namespaces);
    in {
      assertion = exceeding == [];
      message = lib.concatStringsSep "; " exceeding;
    })
    {
      assertion = !(lib.elem "default" choiceNames);
      message = "edith.access and edith.personas cannot name one `default`, which clients' commands take to clear a choice";
    }
    {
      assertion = hasToolUser || lib.all (access: access.tools == []) (lib.attrValues cfg.access);
      message = "an access in edith.access names tools, which requires edith.toolUser.loginKey";
    }
    {
      assertion = !cfg.discord.enable || cfg.resident.enable;
      message = "edith.discord.enable = true requires edith.resident.enable = true";
    }
    {
      assertion = !cfg.discord.enable || cfg.discord.allowedUsers != [];
      message = "edith.discord.enable = true requires a non-empty edith.discord.allowedUsers";
    }
  ];

  darwin.ifEnabled = lib.mkIf hasToolUser {
    users = {
      knownUsers = [toolUser];
      knownGroups = [toolUser];
      groups.${toolUser}.gid = cfg.toolUser.uid;
      users.${toolUser} = {
        inherit (cfg.toolUser) uid;
        gid = cfg.toolUser.uid;
        home = toolHome;
        createHome = true;
        isHidden = true;
        shell = "/bin/zsh";
        openssh.authorizedKeys.keys = [''from="127.0.0.1,::1",restrict ${cfg.toolUser.loginKey}''];
      };
    };
    system.activationScripts.postActivation.text = ''
      if /usr/sbin/dseditgroup -o read com.apple.access_ssh >/dev/null 2>&1; then
        /usr/sbin/dseditgroup -o edit -a ${lib.escapeShellArg toolUser} -t user com.apple.access_ssh
      fi
    '';
  };

  myconfig.ifEnabled.secrets.required = lib.unique (map (name: providers.${name}.secret) keyed) ++ lib.optional cfg.discord.enable discordToken;

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
      credentials = "${stateDirectory}/auth.json";
      inherit socket;
      devDirectory = "${config.xdg.state.directory}/edith-dev";
      providerKeys = lib.listToAttrs (map (name: lib.nameValuePair providers.${name}.variable (secret providers.${name}.secret)) keyed);
      inherit (cfg) access personas namespaces;
      mcpServers = config.mcp.selected.edith;
      toolEnvironment =
        if hasToolUser
        then {
          user = toolUser;
          cwd = toolHome;
          identityFile = "${stateDirectory}/tools/id_ed25519";
          knownHostsFile = "${stateDirectory}/tools/known_hosts";
          hostKeyFile = "/etc/ssh/ssh_host_ed25519_key.pub";
        }
        else null;
      discord =
        if cfg.discord.enable
        then {
          tokenFile = secret discordToken;
          inherit (cfg.discord) allowedUsers;
        }
        else null;
    });
    client = pkgs.writeShellScriptBin "edith" ''
      export EDITH_CONFIG=${lib.escapeShellArg (toString settings)}
      export EDITH_SOCKET=${lib.escapeShellArg (lib.optionalString cfg.resident.enable socket)}
      exec ${lib.escapeShellArgs (node pkgs)} ${program pkgs myconfig.ai-mop.providerSources}/lib/src/cli.ts "$@"
    '';
  in {
    packages = [client];
    mcp.selections.edith = servers;

    # The tool user could otherwise read whatever of the home is readable by others.
    applySteps.edith-private-home = lib.mkIf hasToolUser {
      package = pkgs.linkFarm "hjem-edith-private-home" {
        "bin/apply" = pkgs.writeShellScript "edith-private-home" "chmod 700 ${lib.escapeShellArg config.directory}";
      };
    };
    userServices.edith = lib.mkIf cfg.resident.enable {
      command = node pkgs ++ ["${program pkgs myconfig.ai-mop.providerSources}/lib/src/main.ts"];
      environment.EDITH_CONFIG = toString settings;
      dependsOn = lib.optional (config.userServices ? nix-secrets-activate) "nix-secrets-activate";
      restart = "always";
      logFile = "${config.directory}/Library/Logs/edith.log";
    };
  };

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: let
    aiMopOf = result: result.options.myconfig.ai-mop.providerSources.value;
  in {
    typescript = {
      protects = "EDITH's core, clients and tests type-check and lint against pi-durable, discord.js core and the Node.js that runs them";
      tsRoots = ["src"];
      build = result:
        typescriptCheck {
          name = "edith";
          src = pkgs.runCommand "edith-src" {} ''
            cp -r ${./src} "$out"
            chmod -R u+w "$out"
            mkdir "$out/ai-mop"
            cp ${aiMopOf result}/providers.ts "$out/ai-mop/"
          '';
          types = ./.;
        };
    };
    contracts = {
      protects = "EDITH's core and clients keep each behavior their src/*.test.ts tests name";
      tsRoots = ["src"];
      build = result:
        pkgs.runCommand "edith-contracts" {} ''
          export HOME=$TMPDIR
          ${lib.escapeShellArgs (node pkgs)} --test ${program pkgs (aiMopOf result)}/lib/src/*.test.ts
          touch "$out"
        '';
    };
  };
})
