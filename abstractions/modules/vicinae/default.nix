{
  delib,
  lib,
  mylib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: let
  inherit (mylib.anchors.flakes ./anchors.json) vicinae;
in {
  name = "vicinae";
  tests.fixture = ["defaults" "exclusive" "roles.launcher" "services"];
  meta = {
    description = "Provide the Vicinae launcher as a login service with a stable code-signing identity.";
    tags = ["gui"];
    role = "launcher";
  };

  options = {pkgs, ...}:
    with delib; {
      enable = boolOption false;
      upstreamPackage = packageOption vicinae.packages.${pkgs.stdenv.hostPlatform.system}.default "Package whose source `sourceFiles` patches.";
      package = packageOption (mylib.sourceFiles.apply cfg.upstreamPackage cfg.sourceFiles) "Package installed as the app; setting it bypasses `sourceFiles`.";
      sourceFiles = mylib.sourceFiles.option "upstreamPackage";
    };

  myconfig.always.roles.launcher.holder = "vicinae";

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
    bundled = pkgs.runCommand (builtins.substring 33 (-1) (baseNameOf cfg.package.outPath)) {nativeBuildInputs = [pkgs.perl];} ''
      mkdir "$out"
      cp -a ${cfg.package}/Applications ${cfg.package}/bin "$out/"
      chmod -R u+w "$out"
      find "$out" -type f -exec env SOURCE=${cfg.package} OUT="$out" perl -0777 -pi -e 's/\Q$ENV{SOURCE}\E/$ENV{OUT}/g' {} +
    '';
    package = myconfig.app-identity.stabilizeApp bundled;
    app = "${package}/Applications/Vicinae.app";
  in {
    packages = [package];

    files."Applications/Vicinae.app" = {
      exclusive = true;
      source = app;
    };

    userServices.vicinae = {
      command = ["${app}/Contents/MacOS/vicinae-cli" "server"];
      environment.VICINAE_OVERRIDES = toString ((pkgs.formats.json {}).generate "vicinae-settings.json" config.vicinae.settings);
      restart = "on-failure";
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
