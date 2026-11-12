# Owns the stdio MCP server registry and each consumer's selection from it.
# Registration does not start a server or select it for an agent; each
# consumer names the servers it wants in `mcp.selections.<consumer>` and reads
# them from `mcp.selected.<consumer>`.
{
  delib,
  lib,
  ...
}: let
  server = lib.types.submodule {
    options = {
      command = lib.mkOption {type = lib.types.str;};
      args = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
      };
      env = lib.mkOption {
        type = lib.types.attrsOf lib.types.str;
        default = {};
      };
    };
  };
in
  delib.module {
    name = "mcp";
    meta.description = "Declare stdio MCP servers and resolve each agent consumer's selection of them.";

    options.enable = delib.boolOption true;

    hjem.always = {config, ...}: {
      options.mcp = {
        servers = lib.mkOption {
          type = lib.types.attrsOf server;
          default = {};
          description = "stdio MCP servers by name. Registering a server does not start it or select it for a consumer.";
        };
        selections = lib.mkOption {
          type = lib.types.attrsOf (lib.types.listOf lib.types.str);
          default = {};
          description = "Names of registered servers each consumer selects, by consumer. An unknown name is rejected.";
        };
        selected = lib.mkOption {
          type = lib.types.attrsOf (lib.types.attrsOf server);
          readOnly = true;
          description = "The registered servers each consumer selected, by consumer.";
        };
      };
      config = {
        mcp.selected = lib.mapAttrs (_: names: lib.filterAttrs (name: _: lib.elem name names) config.mcp.servers) config.mcp.selections;
        assertions = lib.concatLists (lib.mapAttrsToList (consumer: names:
          map (name: {
            assertion = config.mcp.servers ? ${name};
            message = "The MCP selection of ${consumer} contains unknown server `${name}`; register it with mcp.servers.";
          })
          names)
        config.mcp.selections);
      };
    };

    tests.cases = {lib, ...}: {
      selection-is-by-name = {
        protects = "a consumer receives exactly the registered servers it selects";
        modules.example.hjem.always.mcp = {
          servers = {
            chosen.command = "/synthetic/chosen";
            other.command = "/synthetic/other";
          };
          selections.consumer = ["chosen"];
        };
        expr = result: lib.attrNames result.options.mcp.selected.value.consumer;
        expected = ["chosen"];
      };
      unknown-server-is-rejected = {
        protects = "a consumer's selection of a server the registry does not declare is rejected";
        modules.example.hjem.always.mcp.selections.consumer = ["missing"];
        fails = "unknown server";
      };
    };
  }
