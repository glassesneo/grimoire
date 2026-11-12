{
  delib,
  lib,
  ...
}:
delib.module ({myconfig, ...}: let
  # Each provider reads its key from the nix-secrets file of that name at call time.
  keys = {
    parallel = "parallel-api-key";
    brave = "brave-api-key";
    braveFree = "brave-free-api-key";
    exa = "exa-api-key";
  };
  backend = keyFile: {
    schemaVersion = 2;
    providers = [
      {
        id = "parallel-search";
        kind = "parallel-search";
        endpoint = "https://api.parallel.ai/v1/search";
        apiKeyFile = keyFile keys.parallel;
      }
      {
        id = "brave-llm-context";
        kind = "brave-llm-context";
        endpoint = "https://api.search.brave.com/res/v1/llm/context";
        apiKeyFile = keyFile keys.brave;
      }
      {
        id = "brave-web-search";
        kind = "brave-web-search";
        endpoint = "https://api.search.brave.com/res/v1/web/search";
        apiKeyFile = keyFile keys.braveFree;
      }
      {
        id = "exa-search";
        kind = "exa-search";
        endpoint = "https://api.exa.ai/search";
        apiKeyFile = keyFile keys.exa;
      }
      {
        id = "parallel-extract";
        kind = "parallel-extract";
        endpoint = "https://api.parallel.ai/v1beta/extract";
        apiKeyFile = keyFile keys.parallel;
      }
      {
        id = "exa-contents";
        kind = "exa-contents";
        endpoint = "https://api.exa.ai/contents";
        apiKeyFile = keyFile keys.exa;
      }
    ];
    routing = {
      generalFamilies = {
        parallel = 5;
        brave = 1;
      };
      braveProviders = {
        "brave-llm-context" = 2;
        "brave-web-search" = 1;
      };
    };
    deadlinesMs = {
      search = 30000;
      fetch = 60000;
    };
    retry = {
      maxRetries = 1;
      defaultWaitMs = 1000;
    };
  };
in {
  name = "web";
  tests.fixture = ["exclusive" "mcp" "secrets"];
  meta.description = "Provide the web retrieval MCP server and its backend configuration.";

  options.enable = delib.boolOption false;

  constraints.ifEnabled = [
    {
      assertion = myconfig.secrets.enable;
      message = "web requires secrets.enable = true to decrypt its provider keys";
    }
  ];

  myconfig.ifEnabled.secrets.required = builtins.attrValues keys;

  hjem.ifEnabled = {
    config,
    pkgs,
    ...
  }: {
    mcp.servers.web = {
      command = lib.getExe pkgs.nodejs;
      args = ["--experimental-strip-types" "${./src}/server.ts"];
      env.WEB_RETRIEVAL_CONFIG = "${config.directory}/.config/web-retrieval/backend.json";
    };
    files.".config/web-retrieval/backend.json" = {
      exclusive = true;
      generator = lib.generators.toJSON {};
      value = backend (name: config.security.nix-secrets.secrets.${name}.path);
    };
  };

  tests.cases = {
    lib,
    pkgs,
    typescriptCheck,
    ...
  }: {
    keys-come-from-nix-secrets = {
      protects = "each provider reads the nix-secrets key of its own name, which enabling web decrypts";
      host.myconfig.ifEnabled.web.enable = true;
      build = result: let
        path = name: result.options.security.nix-secrets.secrets.value.${name}.path;
        expected = {
          parallel-search = path "parallel-api-key";
          parallel-extract = path "parallel-api-key";
          brave-llm-context = path "brave-api-key";
          brave-web-search = path "brave-free-api-key";
          exa-search = path "exa-api-key";
          exa-contents = path "exa-api-key";
        };
        backend = lib.findFirst (entry: lib.hasSuffix "/web-retrieval/backend.json" entry.target) (throw "missing backend.json") result.manifest.files;
      in
        pkgs.runCommand "web-keys" {nativeBuildInputs = [pkgs.jq];} ''
          jq -e --argjson expected ${lib.escapeShellArg (builtins.toJSON expected)} \
            '[.providers[] | {(.id): .apiKeyFile}] | add == $expected' ${backend.source}
          touch "$out"
        '';
    };
    typescript = {
      protects = "the web server and its tests type-check and lint against the Node.js that runs them";
      tsRoots = ["src"];
      build = _:
        typescriptCheck {
          name = "web";
          src = ./src;
          types = ./types;
        };
    };
    retrieval-contracts = {
      protects = "Web callers receive bounded, cancellable retrieval with stable routing, budgets and MCP protocol error boundaries";
      tsRoots = ["src"];
      build = _:
        pkgs.runCommand "web-retrieval" {nativeBuildInputs = [pkgs.nodejs];} ''
          node --experimental-strip-types --test ${./src}/retrieval.test.ts ${./src}/server.test.ts
          touch "$out"
        '';
    };
  };
})
