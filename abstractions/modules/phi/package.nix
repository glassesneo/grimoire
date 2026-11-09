{
  lib,
  nodejs,
  phibrowser-cli,
  stdenvNoCC,
}: let
  version = lib.removePrefix "v" phibrowser-cli.version;
in
  stdenvNoCC.mkDerivation {
    pname = "phi-cli";
    inherit version;
    src = phibrowser-cli;

    # patchShebangs resolves the entry point's `env node` from these.
    buildInputs = [nodejs];
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
  }
