# Process boundaries own SHIELD/Pi compatibility and lifetime; UI checks stay with quin.
{
  inputs,
  pkgs,
  system,
}: let
  quin = inputs.self.packages.${system}.quin or null;
  shield = inputs.self.packages.${system}.shield;
  runtime = quin.runtime;
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./. ../../abstractions/modules/agents/shield];
  };
in
  pkgs.runCommand "shield-check" {
    nativeBuildInputs = [pkgs.bun pkgs.beamPackages.elixir inputs.self.packages.${system}.shield];
    meta.platforms =
      if quin == null
      then []
      else quin.meta.platforms;
  } ''
        export HOME="$TMPDIR/home" XDG_CONFIG_HOME="$TMPDIR/config" XDG_STATE_HOME="$TMPDIR/state"
        mkdir -p "$HOME"
        export SHIELD_LAUNCHER=${shield.launcher}
        export SHIELD_NODE=${runtime.node}
        ${pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (name: value: "export ${name}=${pkgs.lib.escapeShellArg value}") runtime.env)}
        export SHIELD_BASH_FIXTURE=${runtime.bashFixture}
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
