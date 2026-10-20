# OTP owns process lifetime; Node runs the keel runtime, which hosts Pi through its SDK.
{
  lib,
  stdenvNoCC,
  beamPackages,
  bun2nix,
  nodejs,
  writeShellScript,
  makeWrapper,
  # provider/id that keel's Pi uses when the declared settings name no model.
  defaultModel ? null,
  # Packages whose bin directories keel puts at the front of a new agent's PATH.
  extraPackages ? [],
  # Pi settings.json and models.json content; Hjem deploys them, so they are only
  # exposed as passthru.piConfig and never read by the package.
  settings ? {},
  models ? {providers = {};},
  writeText,
}: let
  platforms = import ./platforms.nix;
  piVersion = (lib.importJSON ./package.json).dependencies."@earendil-works/pi-coding-agent";
  toolsPath = lib.makeBinPath extraPackages;
  # The declared default model applies only when the declared settings choose none.
  piSettings =
    settings
    // lib.optionalAttrs (defaultModel != null && !(settings ? defaultProvider) && !(settings ? defaultModel)) (
      let
        parts = lib.splitString "/" defaultModel;
      in {
        defaultProvider = lib.head parts;
        defaultModel = lib.concatStringsSep "/" (lib.tail parts);
      }
    );
  piConfig = {
    settings = writeText "keel-pi-settings.json" (builtins.toJSON piSettings);
    models = writeText "keel-pi-models.json" (builtins.toJSON models);
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
  bunDeps = bun2nix.fetchBunDeps {bunNix = ./bun.nix;};
  # The screen and the shield client as Bun executables, and the runtime as a Node module
  # beside the node_modules Pi and its extensions load from.
  build = bun2nix.mkDerivation {
    packageJson = ./package.json;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [./package.json ./bun.lock ./bunfig.toml ./build.ts ./keel ./client];
    };
    inherit bunDeps;
    doCheck = true;
    # The inline keel build case owns type, lint, and extension UI validation.
    checkPhase = ''
      HOME="$TMPDIR" PI_TELEMETRY=off PI_OFFLINE=1 bun test
    '';
    buildPhase = ''
      bun run build.ts
    '';
    installPhase = ''
      dir="$out/libexec/keel"
      mkdir -p "$dir/runtime/protocol" "$dir/runtime/runtime" "$dir/runtime/fixtures"
      cp dist/keel dist/shield "$dir/"
      cp dist/runtime.mjs "$dir/runtime/"
      cp -r node_modules "$dir/runtime/"
      echo '{"type": "module"}' > "$dir/runtime/package.json"
      # What an extension written for keel imports, and the checks' fixtures.
      cp keel/api.ts "$dir/runtime/"
      cp keel/protocol/*.ts "$dir/runtime/protocol/"
      cp keel/runtime/content.ts "$dir/runtime/runtime/"
      cp keel/fixtures/*.ts "$dir/runtime/fixtures/"
    '';
    dontFixup = true;
  };
  runtime = writeShellScript "keel-runtime" ''
    exec ${nodejs}/bin/node ${build}/libexec/keel/runtime/runtime.mjs "$@"
  '';
in {
  inherit hub launcher build;
  shield = stdenvNoCC.mkDerivation {
    pname = "shield";
    version = "0.1.0";
    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];
    installPhase = ''
      makeWrapper ${build}/libexec/keel/shield "$out/bin/shield" --set SHIELD_LAUNCHER ${launcher}
    '';
    passthru = {inherit launcher piConfig;};
    meta = {
      mainProgram = "shield";
      inherit platforms;
    };
  };
  keel = stdenvNoCC.mkDerivation {
    pname = "keel";
    version = "0.1.0";
    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];
    installPhase = ''
      makeWrapper ${build}/libexec/keel/keel "$out/bin/keel" \
        --set KEEL_RUNTIME ${runtime} \
        --set KEEL_PI_VERSION ${lib.escapeShellArg piVersion} \
        ${lib.optionalString (extraPackages != []) "--set SHIELD_TOOLS_PATH ${lib.escapeShellArg toolsPath}"}
    '';
    passthru = {
      inherit bunDeps piConfig;
      runtime = {
        executable = runtime;
        node = "${nodejs}/bin/node";
        faux = "${build}/libexec/keel/runtime/fixtures/faux.ts";
        bashFixture = "${build}/libexec/keel/runtime/fixtures/bash-fixture.ts";
      };
    };
    meta = {
      mainProgram = "keel";
      inherit platforms;
    };
  };
}
