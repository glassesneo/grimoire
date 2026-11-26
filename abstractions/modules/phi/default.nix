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

  hjem.ifEnabled = {pkgs, ...}: let
    bundled = "${cfg.package}/Applications/Phi.app/Contents/Resources/phi-browser-skill";
    # The bundled skill starts its runner with `node`, which this module does not
    # put on PATH; `phi script` runs the same runner with the CLI's own Node.
    skill = pkgs.runCommand "phi-browser-skill" {} ''
      cp -R ${bundled} "$out"
      chmod -R u+w "$out"
      rm -r "$out/scripts"
      ln -s ${bundled}/scripts "$out/scripts"
      if ! grep -qE 'node [^ ]*/scripts/runner\.mjs' "$out/SKILL.md"; then
        echo "phi: SKILL.md no longer starts the runner as 'node <dir>/scripts/runner.mjs'; update the rewrite in abstractions/modules/phi/default.nix" >&2
        exit 1
      fi
      grep -rlE --include='*.md' 'node [^ ]*/scripts/runner\.mjs' "$out" | xargs sed -i -E 's#node [^ ]*/scripts/runner\.mjs#phi script#g'
      if grep -rnE --include='*.md' '\bnode\b.*runner\.mjs' "$out"; then
        echo "phi: the skill still starts the runner with node in the lines above; extend the rewrite in abstractions/modules/phi/default.nix" >&2
        exit 1
      fi
    '';
  in {
    packages = [cfg.cliPackage];

    files."Applications/Phi.app" = {
      exclusive = true;
      source = "${cfg.package}/Applications/Phi.app";
    };

    skills.phi-browser = skill;
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
