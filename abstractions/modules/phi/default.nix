{
  delib,
  mylib,
  ...
}:
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
      cliPackage = packageOption (pkgs.callPackage ./package.nix {
        inherit (mylib.anchors.sources ./anchors.json) phibrowser-cli;
      });
    };

  hjem.ifEnabled = {
    packages = [cfg.cliPackage];

    files."Applications/Phi.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Phi.app";
    };

    skills.phi-browser = "${cfg.package}/Applications/Phi.app/Contents/Resources/phi-browser-skill";
  };

  bundles.always = {pkgs, ...}: {
    phi = {
      inherit (cfg) package;
      publish = pkgs.stdenv.hostPlatform.isDarwin;
    };
    phi-cli = {
      package = cfg.cliPackage;
      publish = pkgs.stdenv.hostPlatform.isDarwin;
    };
  };
})
