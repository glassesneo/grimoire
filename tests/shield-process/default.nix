# Process boundaries own SHIELD/keel compatibility and lifetime; screen checks stay with keel.
{
  inputs,
  pkgs,
  system,
}: let
  keel = inputs.self.packages.${system}.keel or null;
  shield = inputs.self.packages.${system}.shield;
  runtime = keel.runtime;
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [
      ./.
      ../../abstractions/modules/agents/shield/client
      (pkgs.lib.fileset.difference ../../abstractions/modules/agents/keel ../../abstractions/modules/agents/keel/bun.nix)
    ];
  };
in
  pkgs.runCommand "shield-process-check" {
    nativeBuildInputs = [pkgs.bun shield keel];
    meta.platforms =
      if keel == null
      then []
      else keel.meta.platforms;
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
    bun run ${source}/tests/shield-process/lock-probe.ts
    bun run ${source}/tests/shield-process/keel-smoke.ts
    bun run ${source}/tests/shield-process/hub-test.ts
    bun run ${source}/tests/shield-process/failures.ts
    touch "$out"
  ''
