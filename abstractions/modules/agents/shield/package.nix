# OTP owns process lifetime and keel's model; Node runs the keel driver, which hosts Pi through
# its SDK.
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
  jq,
  oxfmt,
  crystal,
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
  # The contracts' JSON Schemas and the TypeScript modules exposing them, generated from the
  # TypeSpec sources alone with tools pinned apart from the product's dependencies. TypeSpec
  # seals an object as `unevaluatedProperties: {"not": {}}`; it is written as the equivalent
  # `false`, which TypeBox infers as a closed object rather than an open index signature.
  # `just shield-contracts` copies the output into contracts/generated, and the contracts
  # build case compares the two.
  contracts = bun2nix.mkDerivation {
    packageJson = ./contracts/package.json;
    src = lib.fileset.toSource {
      root = ./contracts;
      fileset = lib.fileset.unions [
        ./contracts/package.json
        ./contracts/bun.lock
        ./contracts/keel.tsp
        ./contracts/management.tsp
      ];
    };
    bunDeps = bun2nix.fetchBunDeps {bunNix = ./contracts/bun.nix;};
    nativeBuildInputs = [nodejs jq oxfmt];
    buildPhase = ''
      mkdir generated
      for name in keel management; do
        node node_modules/@typespec/compiler/cmd/tsp.js compile "$name.tsp" --pretty=false \
          --emit @typespec/json-schema \
          --option @typespec/json-schema.file-type=json \
          --option @typespec/json-schema.seal-object-schemas=true \
          --option "@typespec/json-schema.emitter-output-dir=$PWD/emitted/$name"
        comment="Generated from contracts/$name.tsp by \`just shield-contracts\`; do not edit."
        jq --arg comment "$comment" \
          '{"$comment": $comment} + walk(if type == "object" and .unevaluatedProperties == {"not": {}} then .unevaluatedProperties = false else . end)' \
          emitted/$name/*.json > "generated/$name.schema.json"
        printf '// %s\nexport default %s as const;\n' "$comment" "$(cat "generated/$name.schema.json")" > "generated/$name.ts"
      done
      oxfmt generated/*.ts
    '';
    installPhase = ''
      cp -r generated "$out"
    '';
    dontFixup = true;
  };
  # Hex packages of the hub, fixed by mix.lock and this hash.
  hubDeps = beamPackages.fetchMixDeps {
    pname = "shield-hub-deps";
    version = "0.1.0";
    src = lib.fileset.toSource {
      root = ./hub;
      fileset = lib.fileset.unions [./hub/mix.exs ./hub/mix.lock];
    };
    hash = "sha256-Z65FkY3YB3IzK+87jLskpBXhTiOv+5nmvKIO/ikluJI=";
  };
  hub = stdenvNoCC.mkDerivation {
    pname = "shield-hub";
    version = "0.1.0";
    # The model validates the records it receives against the generated keel schema, which
    # it reads at compile time.
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./hub/mix.exs
        ./hub/mix.lock
        ./hub/.formatter.exs
        ./hub/lib
        ./hub/test
        ./contracts/generated/keel.schema.json
        ./contracts/cases.json
        ./contracts/state.json
      ];
    };
    sourceRoot = "source/hub";
    doCheck = true;
    checkPhase = ''
      MIX_ENV=test mix test --no-start
    '';
    nativeBuildInputs = [beamPackages.elixir beamPackages.hex beamPackages.rebar3];
    configurePhase = ''
      export HOME="$TMPDIR" MIX_HOME="$TMPDIR/mix" HEX_HOME="$TMPDIR/hex" HEX_OFFLINE=1
      export MIX_REBAR3=${beamPackages.rebar3}/bin/rebar3 REBAR_GLOBAL_CONFIG_DIR="$TMPDIR/rebar3"
      cp -r --no-preserve=mode ${hubDeps} deps
    '';
    buildPhase = ''
      export MIX_ENV=prod
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
  # The screen as a Bun executable, and the driver as a Node module beside the node_modules Pi
  # and its extensions load from.
  build = bun2nix.mkDerivation {
    packageJson = ./package.json;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./package.json
        ./bun.lock
        ./bunfig.toml
        ./build.ts
        ./keel
        ./client
        ./contracts/generated
        ./contracts/cases.json
        ./contracts/state.json
      ];
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
      mkdir -p "$dir/driver/protocol" "$dir/driver/driver" "$dir/driver/fixtures" "$dir/contracts/generated"
      cp dist/keel "$dir/"
      cp dist/driver.mjs "$dir/driver/"
      cp -r node_modules "$dir/driver/"
      echo '{"type": "module"}' > "$dir/driver/package.json"
      # What an extension written for keel imports, with the types it names, and the checks'
      # fixtures.
      cp keel/api.ts "$dir/driver/"
      cp keel/protocol/*.ts "$dir/driver/protocol/"
      cp keel/driver/content.ts "$dir/driver/driver/"
      cp contracts/generated/keel.ts "$dir/contracts/generated/"
      cp keel/fixtures/*.ts "$dir/driver/fixtures/"
    '';
    dontFixup = true;
  };
  # The management CLI, a native executable that runs without Bun or the BEAM.
  cli = crystal.buildCrystalPackage {
    pname = "shield-cli";
    version = "0.1.0";
    src = lib.fileset.toSource {
      root = ./client;
      fileset = lib.fileset.unions [./client/shield.cr ./client/shield_cli.cr ./client/spec];
    };
    format = "crystal";
    crystalBinaries.shield.src = "shield.cr";
    doCheck = true;
  };
  driver = writeShellScript "keel-driver" ''
    exec ${nodejs}/bin/node ${build}/libexec/keel/driver/driver.mjs "$@"
  '';
in {
  inherit hub launcher build;
  shield = stdenvNoCC.mkDerivation {
    pname = "shield";
    version = "0.1.0";
    dontUnpack = true;
    nativeBuildInputs = [makeWrapper];
    installPhase = ''
      makeWrapper ${cli}/bin/shield "$out/bin/shield" --set SHIELD_LAUNCHER ${launcher}
    '';
    passthru = {inherit launcher piConfig contracts;};
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
        --set KEEL_DRIVER ${driver} \
        --set KEEL_PI_VERSION ${lib.escapeShellArg piVersion} \
        ${lib.optionalString (extraPackages != []) "--set SHIELD_TOOLS_PATH ${lib.escapeShellArg toolsPath}"}
    '';
    passthru = {
      inherit bunDeps piConfig;
      driver = {
        executable = driver;
        node = "${nodejs}/bin/node";
        faux = "${build}/libexec/keel/driver/fixtures/faux.ts";
        bashFixture = "${build}/libexec/keel/driver/fixtures/bash-fixture.ts";
        # The packages the driver loads, which the process case's scripts import as well.
        modules = "${build}/libexec/keel/driver/node_modules";
      };
    };
    meta = {
      mainProgram = "keel";
      inherit platforms;
    };
  };
}
