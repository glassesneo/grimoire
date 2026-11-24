{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) spicetify-nix;
in
  delib.module ({myconfig, ...}: {
    name = "spicetify";
    tests.fixture = ["exclusive"];
    meta.description = "Provide Spotify patched by Spicetify with its extensions, and keep Spotify from updating itself.";

    options.enable = delib.boolOption false;

    constraints.ifEnabled = [
      {
        assertion = lib.hasSuffix "-darwin" myconfig.host.system;
        message = "spicetify.enable = true requires a Darwin host";
      }
    ];

    hjem.always.imports = [spicetify-nix.hjemModules.spicetify];

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      spicePkgs = spicetify-nix.legacyPackages.${pkgs.stdenv.hostPlatform.system};
      # Spotify installs downloaded updates over the patched app; an immutable
      # empty directory prevents it.
      noUpdates = pkgs.writeShellScript "spotify-no-updates" ''
        set -eu
        directory="$HOME/Library/Application Support/Spotify/PersistentCache/Update"
        if ! /usr/bin/stat -f %Sf "$directory" 2>/dev/null | /usr/bin/grep -q uchg; then
          /bin/rm -rf "$directory"
          /bin/mkdir -p "$directory"
          /usr/bin/chflags uchg "$directory"
        fi
      '';
    in {
      nixpkgs.config.allowUnfreePackages = ["spotify"];

      programs.spicetify = {
        enable = true;
        enabledExtensions = with spicePkgs.extensions; [
          hidePodcasts
          sidebarCustomizer
          volumePercentage
          spicyLyrics
        ];
      };

      files."Applications/Spotify.app" = {
        exclusive = true;
        source = "${config.programs.spicetify.spicedSpotify}/Applications/Spotify.app";
      };

      applySteps.spotify-no-updates.package = pkgs.linkFarm "hjem-spotify-no-updates" {"bin/apply" = noUpdates;};
    };
  })
