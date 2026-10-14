# OTP owns process lifetime; Node executes the published Pi CLI unchanged.
{
  lib,
  stdenvNoCC,
  beamPackages,
  bun2nix,
  nodejs,
  writeShellScript,
  makeWrapper,
  # provider/id used when neither --model nor the dedicated Pi settings name a model.
  defaultModel ? null,
}: let
  runtime = bun2nix.mkDerivation {
    packageJson = ./runtime/package.json;
    src = lib.fileset.toSource {
      root = ./runtime;
      fileset = lib.fileset.unions [./runtime/package.json ./runtime/bun.lock ./runtime/faux.ts ./runtime/bash-fixture.ts];
    };
    bunDeps = bun2nix.fetchBunDeps {bunNix = ./runtime/bun.nix;};
    buildPhase = "true";
    installPhase = ''
      mkdir -p "$out/libexec/pi"
      cp -r node_modules "$out/libexec/pi/"
      cp faux.ts bash-fixture.ts "$out/libexec/pi/"
      mkdir -p "$out/bin"
      cat > "$out/bin/shield-pi" <<EOF
      #!${stdenvNoCC.shell}
      exec ${nodejs}/bin/node "$out/libexec/pi/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js" "\$@"
      EOF
      chmod +x "$out/bin/shield-pi"
    '';
    dontFixup = true;
  };
  hub = stdenvNoCC.mkDerivation {
    pname = "shield-hub";
    version = "0.1.0";
    src = lib.fileset.toSource {
      root = ./hub;
      fileset = lib.fileset.unions [./hub/mix.exs ./hub/.formatter.exs ./hub/lib ./hub/test];
    };
    doCheck = true;
    checkPhase = ''
      MIX_ENV=test mix test --no-start
      mix format --check-formatted
    '';
    nativeBuildInputs = [beamPackages.elixir];
    buildPhase = ''
      export HOME="$TMPDIR" MIX_ENV=prod
      mix compile --warnings-as-errors
      mix release
    '';
    installPhase = ''
      mkdir -p "$out"
      cp -r _build/prod/rel/shield/. "$out/"
    '';
  };
  launcher = writeShellScript "shield-launch" ''
    set -eu
    umask 077
    : "\''${SHIELD_SOCKET:?}"
    exec 9<>"$SHIELD_SOCKET.lock"
    /usr/bin/lockf -s -t 0 9 || exit 75
    export RELEASE_DISTRIBUTION=none
    exec ${hub}/bin/shield start
  '';
  clients = bun2nix.mkDerivation {
    packageJson = ./quin/package.json;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [./quin ./client];
    };
    bunDeps = bun2nix.fetchBunDeps {bunNix = ./quin/bun.nix;};
    postUnpack = ''
      cp "$sourceRoot/quin/package.json" "$sourceRoot/package.json"
      cp "$sourceRoot/quin/bun.lock" "$sourceRoot/bun.lock"
    '';
    doCheck = true;
    checkPhase = ''
      bun ../node_modules/typescript/bin/tsc --noEmit
      bun test
    '';
    buildPhase = ''
      cd quin
      bun run build.ts
    '';
    installPhase = ''
      mkdir -p "$out/libexec/shield"
      cp quin shield "$out/libexec/shield/"
    '';
    dontFixup = true;
  };
in {
  inherit runtime hub launcher clients;
  shield = stdenvNoCC.mkDerivation {
    pname = "shield";
    version = "0.1.0";
    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];
    installPhase = ''
      makeWrapper ${clients}/libexec/shield/shield "$out/bin/shield" --set SHIELD_LAUNCHER ${launcher}
    '';
    meta = {
      mainProgram = "shield";
      platforms = ["aarch64-darwin"];
    };
  };
  quin = stdenvNoCC.mkDerivation {
    pname = "quin";
    version = "0.1.0";
    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];
    installPhase = ''
      makeWrapper ${clients}/libexec/shield/quin "$out/bin/quin" \
        --set SHIELD_PI ${runtime}/bin/shield-pi \
        --set SHIELD_FAUX ${runtime}/libexec/pi/faux.ts \
        --set SHIELD_COMMANDCODE ${runtime}/libexec/pi/node_modules/@commandcode/pi-commandcode-provider/index.ts \
        ${lib.optionalString (defaultModel != null) "--set SHIELD_DEFAULT_MODEL ${lib.escapeShellArg defaultModel}"}
    '';
    meta = {
      mainProgram = "quin";
      platforms = ["aarch64-darwin"];
    };
  };
}
