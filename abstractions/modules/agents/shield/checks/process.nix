# Real hub/runtime process boundaries use temporary homes and the faux provider.
{
  pkgs,
  keel,
  shield,
}: let
  runtime = keel.runtime;
  source = pkgs.lib.fileset.toSource {
    root = ./..;
    fileset = pkgs.lib.fileset.unions [./process ../client ../keel];
  };
in
  pkgs.runCommand "shield-process-check" {
    nativeBuildInputs = [pkgs.bun shield keel];
  } ''
    export HOME="$TMPDIR/home" XDG_CONFIG_HOME="$TMPDIR/config" XDG_STATE_HOME="$TMPDIR/state"
    mkdir -p "$HOME"
    export SHIELD_LAUNCHER=${shield.launcher}
    export SHIELD_NODE=${runtime.node}
    export KEEL_RUNTIME=${runtime.executable}
    export KEEL_FAUX=${runtime.faux}
    export KEEL_BASH_FIXTURE=${runtime.bashFixture}
    shield --version
    shield --help
    keel --version
    bun run ${source}/checks/process/lock-probe.ts
    bun run ${source}/checks/process/keel-smoke.ts
    bun run ${source}/checks/process/hub-test.ts
    bun run ${source}/checks/process/failures.ts
    touch "$out"
  ''
