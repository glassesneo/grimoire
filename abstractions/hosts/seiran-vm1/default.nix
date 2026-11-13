{delib, ...}:
delib.host {
  name = "seiran-vm1";
  system = "aarch64-darwin";
  user.name = "neo";
  rice = "default";

  myconfig.ifEnabled = {
    zoom.enable = false;
    web.enable = true;
    pi.mcpServers = ["web"];
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

    nix = {
      distributedBuilds = true;
      settings = {
        max-jobs = 0;
        builders-use-substitutes = true;
      };
      buildMachines = [
        {
          hostName = "192.168.64.1";
          protocol = "ssh-ng";
          sshUser = "neo";
          sshKey = "/var/root/.ssh/nix-host-builder";
          system = "aarch64-darwin";
          maxJobs = 4;
          speedFactor = 2;
          supportedFeatures = [
            "benchmark"
            "big-parallel"
          ];
          mandatoryFeatures = [];
        }
      ];
    };
  };
}
