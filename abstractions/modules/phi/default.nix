{
  delib,
  lib,
  ...
}:
delib.module ({
  cfg,
  myconfig,
  ...
}: {
  name = "phi";
  meta = {
    description = "Provide the Phi browser.";
    tags = ["gui"];
  };

  options = with delib; {
    enable = boolOption false;
    package = packageOption myconfig.casks.taps.phibrowser.tap.phi {defaultText = lib.literalExpression "myconfig.casks.taps.phibrowser.tap.phi";};
  };

  hjem.ifEnabled.files."Applications/Phi.app" = {
    exclusive = true;
    source = "${cfg.package}/Applications/Phi.app";
  };
})
