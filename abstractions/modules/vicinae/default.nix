{
  delib,
  inputs,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "vicinae";
  meta = {
    description = "Provide the Vicinae launcher as a login service with a stable code-signing identity.";
    tags = ["gui"];
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      upstreamPackage = packageOption inputs.vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default "Package whose source `sourceFiles` patches.";
      package = packageOption (mylib.sourceFiles.apply cfg.upstreamPackage cfg.sourceFiles) "Package installed as the app; setting it bypasses `sourceFiles`.";
      sourceFiles = mylib.sourceFiles.option "upstreamPackage";
    };

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

    # The in-bundle CLI execs the server in place, so TCC sees the signed
    # bundle rather than a wrapper script.
    userServices.vicinae = {
      command = ["${app}/Contents/MacOS/vicinae-cli" "server"];
      environment.VICINAE_OVERRIDES = toString ((pkgs.formats.json {}).generate "vicinae-settings.json" config.vicinae.settings);
    };
    platform.darwin.launchAgents.vicinae = {
      domain = "gui";
      config = {
        KeepAlive = {
          Crashed = true;
          SuccessfulExit = false;
        };
        ProcessType = "Interactive";
      };
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

  checks = {pkgs, ...}: let
    # Stands in for the upstream build; evaluation cases never realize it.
    package = pkgs.runCommand "vicinae-fixture" {} "mkdir $out";
  in {
    service = {
      uses = ["app-identity"];
      platforms = ["aarch64-darwin"];
      host.myconfig.ifEnabled.vicinae = {
        enable = true;
        inherit package;
      };
      expr = result: let
        job = lib.findFirst (job: job.name == "vicinae") (throw "Missing vicinae job") result.apply.steps.services.jobs;
        args = lib.drop 4 job.config.ProgramArguments;
      in {
        inherit (job) domain;
        executable = lib.hasSuffix "/Applications/Vicinae.app/Contents/MacOS/vicinae-cli" (builtins.head args);
        signed = !(lib.hasPrefix (toString package) (builtins.head args));
        arguments = builtins.tail args;
        overrides = lib.hasSuffix "-vicinae-settings.json" job.config.EnvironmentVariables.VICINAE_OVERRIDES;
      };
      expected = {
        domain = "gui";
        executable = true;
        signed = true;
        arguments = ["server"];
        overrides = true;
      };
    };
    duplicate-source-file = {
      uses = ["app-identity"];
      platforms = ["aarch64-darwin"];
      host.myconfig.ifEnabled.vicinae = {
        enable = true;
        upstreamPackage = package;
      };
      modules = lib.genAttrs ["first" "second"] (name: {
        myconfig.always.vicinae.sourceFiles."file.qml" = {
          source = pkgs.writeText "${name}.qml" "";
          upstreamSha256 = lib.fixedWidthString 64 "0" "";
        };
      });
      expr = result: result.apply.steps.services.jobs;
      fails = true;
    };
  };
})
