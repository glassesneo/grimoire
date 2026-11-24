{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "nix";
  meta.description = "Configure Nix itself.";

  options = with delib; {
    minFree = intOption 50 "GiB of free space below which the daemon collects garbage during builds and copies; it must stay below what the host's disk can keep free, or every addition to the store runs a collection.";
    maxFree = intOption 150 "GiB of free space at which such a collection stops.";
  };

  darwin.always = {pkgs, ...}: {
    nix.package = pkgs.nix.appendPatches [./nix-skip-root-chmod-darwin.patch];

    nix.settings = {
      experimental-features = ["nix-command" "flakes"];
      trusted-users = ["root" "@admin" myconfig.host.user.name];
      min-free = cfg.minFree * 1024 * 1024 * 1024;
      max-free = cfg.maxFree * 1024 * 1024 * 1024;
    };

    nix.gc = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 0;
        Minute = 0;
      };
      options = "--delete-older-than 3d";
    };

    nix.optimise = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 1;
        Minute = 0;
      };
    };

    launchd.daemons = {
      nix-gc.serviceConfig = {
        StandardOutPath = "/var/log/nix-gc.log";
        StandardErrorPath = "/var/log/nix-gc.log";
      };
      nix-optimise.serviceConfig = {
        StandardOutPath = "/var/log/nix-optimise.log";
        StandardErrorPath = "/var/log/nix-optimise.log";
      };
    };
  };
})
