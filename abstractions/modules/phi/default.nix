{
  delib,
  lib,
  mylib,
  ...
}: let
  inherit (mylib.anchors.sources ./anchors.json) phibrowser-cli;

  # nixpkgs does not package the CLI. It has no npm dependencies, so its sources
  # need only a Node interpreter.
  mkCli = pkgs: let
    version = lib.removePrefix "v" phibrowser-cli.version;
  in
    pkgs.stdenvNoCC.mkDerivation {
      pname = "phi-cli";
      inherit version;
      src = phibrowser-cli;

      # patchShebangs resolves the entry point's `env node` from these.
      buildInputs = [pkgs.nodejs];
      dontBuild = true;

      installPhase = ''
        runHook preInstall
        mkdir -p $out/libexec/phi-cli $out/bin
        cp -R bin src package.json $out/libexec/phi-cli/
        chmod +x $out/libexec/phi-cli/bin/phi-cli.mjs
        ln -s ../libexec/phi-cli/bin/phi-cli.mjs $out/bin/phi
        ln -s ../libexec/phi-cli/bin/phi-cli.mjs $out/bin/phibrowser
        runHook postInstall
      '';

      doInstallCheck = true;
      installCheckPhase = ''
        runHook preInstallCheck
        test "$($out/bin/phi --version)" = ${version}
        test "$($out/bin/phibrowser --version)" = ${version}
        runHook postInstallCheck
      '';

      meta = {
        mainProgram = "phi";
        license = lib.licenses.asl20;
        platforms = ["aarch64-darwin"];
      };
    };
in
  delib.module ({
    cfg,
    myconfig,
    ...
  }: {
    name = "phi";
    tests.fixture = ["exclusive" "skills"];
    meta = {
      description = "Provide and publish the Phi browser and the CLI and agent skill that drive it.";
      tags = ["gui"];
    };

    options = {pkgs, ...}:
      with delib; {
        enable = boolOption false;
        package = packageOption myconfig.casks.taps.phibrowser.tap.phi;
        cliPackage = packageOption (mkCli pkgs);
      };

    hjem.ifEnabled = {
      # The CLI loads its engine from the app bundle, which it finds here. Only
      # the CLI goes on PATH: the browser's package also provides a `phi`.
      packages = [cfg.cliPackage];

      files."Applications/Phi.app" = {
        exclusive = true;
        source = "${cfg.package}/Applications/Phi.app";
      };

      # `phi install skill` would link a store path outside any generation. The
      # skill ships with the app, so it stays paired with the engine it drives.
      skills.phi-browser = "${cfg.package}/Applications/Phi.app/Contents/Resources/phi-browser-skill";
    };

    bundles.always = {pkgs, ...}: {
      phi = {
        inherit (cfg) package;
        publish = pkgs.stdenv.hostPlatform.isDarwin;
      };
      phi-cli = {
        package = cfg.cliPackage;
        publish = lib.meta.availableOn pkgs.stdenv.hostPlatform cfg.cliPackage;
      };
    };
  })
