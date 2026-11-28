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
    gcRetention = strOption "14d" "Age threshold passed to `nix-collect-garbage --delete-older-than`.";
    keepOutputs = boolOption true "Whether the garbage collector keeps build-time outputs of derivations still in the store, avoiding rebuilds of development shells.";
  };

  darwin.always = {pkgs, ...}: {
    # Backport of NixOS/nix#16626 (after 2.35.6): App Management denies root's
    # chmod on launched .app bundles, which aborted every GC. Drop it once
    # nixpkgs' Nix includes the fix.
    nix.package = pkgs.nix.appendPatches [./nix-skip-root-chmod-darwin.patch];

    nix.settings = {
      experimental-features = ["nix-command" "flakes"];
      trusted-users = ["root" "@admin" myconfig.host.user.name];
      min-free = cfg.minFree * 1024 * 1024 * 1024;
      max-free = cfg.maxFree * 1024 * 1024 * 1024;
      connect-timeout = 5;
      fallback = true;
      use-xdg-base-directories = true;
      keep-outputs = cfg.keepOutputs;
    };

    nix.gc = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 0;
        Minute = 0;
      };
      options = "--delete-older-than ${cfg.gcRetention}";
    };

    nix.optimise = {
      automatic = true;
      interval = {
        Weekday = 0;
        Hour = 1;
        Minute = 0;
      };
    };

    # launchd discards the jobs' output otherwise.
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
