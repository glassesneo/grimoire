{
  delib,
  config,
  lib,
  ...
}: let
  guiModules = builtins.filter (name: lib.elem "gui" config.modules.${name}.meta.tags) (builtins.attrNames config.modules);
in
  delib.host {
    name = "kurogane";
    system = "aarch64-darwin";
    user.name = "neo";

    myconfig.ifEnabled = lib.mkMerge [
      (lib.mkMerge (map (name: lib.setAttrByPath (lib.splitString "." name ++ ["enable"]) true) guiModules))
      {
        shell.loginShell = "zsh";
        secrets.names = [
          "vercel-ai-gateway-api-key"
          "openrouter-api-key"
          "opencode-api-key"
          "mistral-api-key"
          "zai-api-key"
          "cohere-api-key"
          "brave-api-key"
          "brave-free-api-key"
          "parallel-api-key"
          "exa-api-key"
          "command-code-api-key"
        ];
      }
    ];

    darwin.ifEnabled = {
      system.stateVersion = 7;
      ids.gids.nixbld = 350;
    };
  }
