# Process boundaries own SHIELD/Pi compatibility and lifetime; UI checks stay with quin.
{
  inputs,
  pkgs,
  system,
}: let
  packages = pkgs.callPackage ../../abstractions/modules/agents/shield/package.nix {
    bun2nix = inputs.bun2nix.packages.${system}.default;
  };
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./. ../../abstractions/modules/agents/shield];
  };
in
  pkgs.runCommand "shield-check" {
    nativeBuildInputs = [pkgs.bun pkgs.beamPackages.elixir inputs.self.packages.${system}.shield];
    meta.platforms = ["aarch64-darwin"];
  } ''
        export HOME="$TMPDIR/home" XDG_CONFIG_HOME="$TMPDIR/config" XDG_STATE_HOME="$TMPDIR/state"
        mkdir -p "$HOME"
        export SHIELD_LAUNCHER=${packages.launcher}
      export SHIELD_NODE=${pkgs.nodejs}/bin/node
        export SHIELD_PI=${packages.runtime}/bin/shield-pi
        export SHIELD_FAUX=${packages.runtime}/libexec/pi/faux.ts
        export SHIELD_BASH_FIXTURE=${packages.runtime}/libexec/pi/bash-fixture.ts
        shield --version
        shield --help
        bun run ${source}/tests/shield/lock-probe.ts
        bun run ${source}/tests/shield/pi-smoke.ts
        bun run ${source}/tests/shield/hub-test.ts
    bun run ${source}/tests/shield/failures.ts
        cp -r ${source} work
        chmod -R u+w work
        pushd work/abstractions/modules/agents/shield/hub
        MIX_ENV=test mix compile --warnings-as-errors
        popd
        bun run work/tests/shield/view-trace.ts
        touch "$out"
  ''
