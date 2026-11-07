{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) vicinae;
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: let
    # Themes Vicinae bundles, by scheme name.
    themes = mylib.schemeThemes {
      name = "vicinae";
      themes.rose-pine = "rose-pine";
    };
    theme = themes.select cfg myconfig.colorscheme.resolved;
  in {
    name = "vicinae";
    requires = ["app-identity" "defaults" "exclusive" "services"];
    meta = {
      description = "Provide the Vicinae launcher as a login service with a stable code-signing identity.";
      tags = ["gui"];
    };

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        # The flake keeps its own nixpkgs, so the dependencies upstream CI pushes
        # to vicinae.cachix stay substitutable.
        upstreamPackage = packageOption vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default "Package whose source `sourceFiles` patches.";
        package = packageOption (mylib.sourceFiles.apply cfg.upstreamPackage cfg.sourceFiles) "Package installed as the app; setting it bypasses `sourceFiles`.";
        sourceFiles = mylib.sourceFiles.option "upstreamPackage";
        useColorscheme = boolOption true "Whether Vicinae takes its theme from `colorscheme.resolved`.";
      };

    constraints.ifEnabled = [(themes.constraint cfg myconfig.colorscheme.resolved)];

    hjem.always = {pkgs, ...}: {
      options.vicinae.settings = lib.mkOption {
        inherit (pkgs.formats.json {}) type;
        default = {};
        description = "Settings layered over Vicinae's own settings.json through VICINAE_OVERRIDES; keys set here take precedence over changes made in the app.";
      };
    };

    hjem.ifEnabled = {
      config,
      pkgs,
      ...
    }: let
      # stabilizeApp rejects the browser native-messaging host, a wrapper outside
      # the bundle that names the package's own store path. Browser integration is
      # not configured, so only the bundle and the CLI link are kept, repointed at
      # this copy; the equal-length name keeps Mach-O rewrites in place.
      bundled = pkgs.runCommand (builtins.substring 33 (-1) (baseNameOf cfg.package.outPath)) {nativeBuildInputs = [pkgs.perl];} ''
        mkdir "$out"
        cp -a ${cfg.package}/Applications ${cfg.package}/bin "$out/"
        chmod -R u+w "$out"
        find "$out" -type f -exec env SOURCE=${cfg.package} OUT="$out" perl -0777 -pi -e 's/\Q$ENV{SOURCE}\E/$ENV{OUT}/g' {} +
      '';
      # Source replacements go in before signing: stabilizeApp rewrites and re-signs its input's output.
      package = myconfig.app-identity.stabilizeApp bundled;
      app = "${package}/Applications/Vicinae.app";
    in {
      packages = [package];

      files."Applications/Vicinae.app" = {
        exclusive = true;
        source = app;
      };

      # The in-bundle CLI execs the server in place, so the server runs as the
      # signed bundle rather than a wrapper script. TCC attributes it to dinit,
      # which starts it.
      userServices.vicinae = {
        command = ["${app}/Contents/MacOS/vicinae-cli" "server"];
        environment.VICINAE_OVERRIDES = toString ((pkgs.formats.json {}).generate "vicinae-settings.json" config.vicinae.settings);
        restart = "on-failure";
      };

      # The toggle shortcut takes ⌘Space over from Spotlight's search shortcut.
      platform.darwin.defaults."com.apple.symbolichotkeys" = {
        settings.AppleSymbolicHotKeys."64" = {
          enabled = false;
          value = {
            type = "standard";
            parameters = [32 49 1048576];
          };
        };
        onChange.activateSettings = true;
      };

      # The scheme applies whatever the system appearance.
      vicinae.settings.theme = lib.mkIf (theme != null) {
        dark.name = theme;
        light.name = theme;
      };

      vicinae.settings = {
        telemetry.system_info = true;
        input_server.enabled = true;
        tray.enabled = false;
        search_files_in_root = false;
        activate_on_single_click = false;
        escape_key_behavior = "navigate_back";
        pop_on_backspace = true;
        close_on_focus_loss = true;
        pop_to_root_on_close = true;
        wrap_navigation = true;
        favicon_service = "twenty";
        # Qt maps control to the command key on macOS.
        global_shortcuts.toggle = "control+space";
        launcher_window = {
          material = "liquid_glass";
          rounding = 30;
          size = {
            width = 780;
            height = 500;
          };
          compact_mode.enabled = true;
          clock = {
            enabled = false;
            format = "HH:mm";
            interval = 60;
          };
        };
      };
    };

    darwin.ifEnabled.nix.settings = {
      extra-substituters = ["https://vicinae.cachix.org"];
      extra-trusted-public-keys = ["vicinae.cachix.org-1:1kDrfienkGHPYbkpNj1mWTr7Fm1+zcenzgTizIcI3oc="];
    };
  })
