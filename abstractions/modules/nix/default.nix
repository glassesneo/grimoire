{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "nix";
  meta.description = "Configure Nix itself.";

  darwin.always = {pkgs, ...}: {
    # Backport of NixOS/nix#16626 (merged after 2.35.6): root skips the chmod
    # that App Management denies on launched .app bundles, which aborted every
    # GC. Drop it once nixpkgs' Nix includes the fix.
    nix.package = pkgs.nix.appendPatches [./nix-skip-root-chmod-darwin.patch];

    nix.settings = {
      experimental-features = ["nix-command" "flakes"];
      trusted-users = ["root" "@admin" myconfig.host.user.name];
      # The daemon collects garbage during builds when free space falls below
      # min-free, until max-free is available, even if the scheduled job fails.
      min-free = 50 * 1024 * 1024 * 1024;
      max-free = 150 * 1024 * 1024 * 1024;
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

    # launchd discards the jobs' output otherwise, which hid their failures.
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
