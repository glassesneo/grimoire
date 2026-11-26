{delib, ...}:
delib.host {
  name = "seiran-vm1";
  system = "aarch64-darwin";
  user = {
    name = "neo";
    uid = 502;
  };
  rice = "default";

  myconfig.ifEnabled = {
    zoom.enable = false;
    phi.enable = true;
    ssh.remote.enable = true;
    # The VM's disk keeps about 35 GiB free, below the default min-free, which
    # made every copy into the store run a collection.
    nix = {
      minFree = 5;
      maxFree = 15;
    };
    web.enable = true;
    pi.mcpServers = ["web"];
    claude-code.unattended = true;
    edith = {
      enable = true;
      access.restricted = {
        tools = [];
        mcpServers = ["web"];
        maxTurns = 20;
      };
      personas.edith = {
        model = {
          provider = "openrouter";
          modelId = "nvidia/nemotron-3-ultra-550b-a55b:free";
        };
        thinkingLevel = "medium";
      };
      providers = ["ai-mop-responses"];
    };
    secrets.names = [
      "ai-mop-api-key"
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
