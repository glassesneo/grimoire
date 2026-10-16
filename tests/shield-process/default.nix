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
  pkgs.runCommand "shield-process-check" {
    nativeBuildInputs = [pkgs.bun shield quin];
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
    bun run ${source}/tests/shield-process/lock-probe.ts
    bun run ${source}/tests/shield-process/pi-smoke.ts
    bun run ${source}/tests/shield-process/hub-test.ts
    bun run ${source}/tests/shield-process/failures.ts
    touch "$out"
  ''
