{delib, ...}:
delib.host {
  name = "seiran";
  system = "aarch64-darwin";
  user.name = "neo";
  rice = "default";

  myconfig.ifEnabled = {
    tags.enabled = ["gui"];
    vicinae = {
      compact-transition.enable = true;
      selection-highlight.enable = true;
    };
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
  };

  darwin.ifEnabled = {
    system.stateVersion = 4;
    ids.gids.nixbld = 350;
  };
}
