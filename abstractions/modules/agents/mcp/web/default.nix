{
  delib,
  lib,
  ...
}:
delib.module ({cfg, ...}: let
  backend = {
    schemaVersion = 2;
    providers = [
      {
        id = "parallel-search";
        kind = "parallel-search";
        endpoint = "https://api.parallel.ai/v1/search";
        apiKeyFile = cfg.credentials.parallel;
      }
      {
        id = "brave-llm-context";
        kind = "brave-llm-context";
        endpoint = "https://api.search.brave.com/res/v1/llm/context";
        apiKeyFile = cfg.credentials.brave;
      }
      {
        id = "brave-web-search";
        kind = "brave-web-search";
        endpoint = "https://api.search.brave.com/res/v1/web/search";
        apiKeyFile = cfg.credentials.braveFree;
      }
      {
        id = "exa-search";
        kind = "exa-search";
        endpoint = "https://api.exa.ai/search";
        apiKeyFile = cfg.credentials.exa;
      }
      {
        id = "parallel-extract";
        kind = "parallel-extract";
        endpoint = "https://api.parallel.ai/v1beta/extract";
        apiKeyFile = cfg.credentials.parallel;
      }
      {
        id = "exa-contents";
        kind = "exa-contents";
        endpoint = "https://api.exa.ai/contents";
        apiKeyFile = cfg.credentials.exa;
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
  tests.fixture = ["exclusive" "mcp"];
  meta.description = "Provide the web retrieval MCP server and its backend configuration.";

  options = with delib; {
    enable = boolOption false;
    credentials = lib.mkOption {
      type = lib.types.submodule {
        options = {
          parallel = allowNull (strOption null) "Runtime path of the Parallel credential file. An unset path leaves that provider unconfigured.";
          brave = allowNull (strOption null) "Runtime path of the Brave LLM Context credential file. An unset path leaves that provider unconfigured.";
          braveFree = allowNull (strOption null) "Runtime path of the Brave web search credential file. An unset path leaves that provider unconfigured.";
          exa = allowNull (strOption null) "Runtime path of the Exa credential file. An unset path leaves that provider unconfigured.";
        };
      };
      default = {};
    };
  };

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
      value = backend;
    };
  };

  tests.cases = {
    pkgs,
    typescriptCheck,
    ...
  }: {
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
