{delib, ...}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "phi";
  meta = {
    description = "Provide and publish the Phi browser.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.taps.phibrowser.tap.phi;
  };

  hjem.ifEnabled.files."Applications/Phi.app" = {
    exclusive = true;
    source = "${cfg.package}/Applications/Phi.app";
  };

  bundles.always = {pkgs, ...}: {
    phi = {
      inherit (cfg) package;
      publish = pkgs.stdenv.hostPlatform.isDarwin;
    };
  };
})
