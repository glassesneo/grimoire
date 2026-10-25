{
  delib,
  inputs,
  lib,
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
      package = packageOption inputs.vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default;
      sourceFiles =
        attrsOfOption (lib.types.uniq (lib.types.submodule {
          options = {
            source = lib.mkOption {
              type = lib.types.path;
              description = "File that replaces the upstream one.";
            };
            upstreamSha256 = lib.mkOption {
              type = lib.types.strMatching "[0-9a-f]{64}";
              description = "Hex SHA-256 of the upstream file being replaced; a build whose source holds a different file fails, so upstream changes are merged rather than overwritten.";
            };
          };
        })) {}
        "Files of `package`'s source replaced before it is built, keyed by their path relative to the source root. Each path may be replaced by one definition only.";
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
    # Overriding without replacements would still change the derivation and miss
    # the upstream binary cache.
    patched =
      if cfg.sourceFiles == {}
      then cfg.package
      else
        cfg.package.overrideAttrs (old: {
          postPatch =
            (old.postPatch or "")
            + lib.concatStrings (lib.mapAttrsToList (path: file: ''
                if ! echo ${lib.escapeShellArg "${file.upstreamSha256}  ${path}"} | sha256sum --check --status; then
                  echo ${lib.escapeShellArg "${path} differs from the upstream file its replacement was written against"} >&2
                  exit 1
                fi
                cp ${file.source} ${lib.escapeShellArg path}
              '')
              cfg.sourceFiles);
        });
    # stabilizeApp rejects the browser native-messaging host, a wrapper outside
    # the bundle that names the package's own store path. Browser integration is
    # not configured, so only the bundle and the CLI link are kept, repointed at
    # this copy; the equal-length name keeps Mach-O rewrites in place.
    bundled = pkgs.runCommand (builtins.substring 33 (-1) (baseNameOf patched.outPath)) {nativeBuildInputs = [pkgs.perl];} ''
      mkdir "$out"
      cp -a ${patched}/Applications ${patched}/bin "$out/"
      chmod -R u+w "$out"
      find "$out" -type f -exec env SOURCE=${patched} OUT="$out" perl -0777 -pi -e 's/\Q$ENV{SOURCE}\E/$ENV{OUT}/g' {} +
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
        job = lib.findFirst (job: job.name == "vicinae") (throw "Missing vicinae job") result.serviceApply.jobs;
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
        inherit package;
      };
      modules = lib.genAttrs ["first" "second"] (name: {
        myconfig.always.vicinae.sourceFiles."file.qml" = {
          source = pkgs.writeText "${name}.qml" "";
          upstreamSha256 = lib.fixedWidthString 64 "0" "";
        };
      });
      expr = result: result.serviceApply.jobs;
      fails = true;
    };
  };
})
