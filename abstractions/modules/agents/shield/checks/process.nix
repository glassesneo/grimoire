# Real hub/driver process boundaries, through the packaged shield executable, use temporary
# homes and the faux provider.
{
  pkgs,
  keel,
  shield,
}: let
  driver = keel.driver;
  source = pkgs.lib.fileset.toSource {
    root = ./..;
    fileset = pkgs.lib.fileset.unions [./process ../client ../keel ../contracts/generated];
  };
in
  pkgs.runCommand "shield-process-check" {
    nativeBuildInputs = [pkgs.bun shield keel];
  } ''
    export HOME="$TMPDIR/home" XDG_CONFIG_HOME="$TMPDIR/config" XDG_STATE_HOME="$TMPDIR/state"
    mkdir -p "$HOME"
    export SHIELD_LAUNCHER=${shield.launcher}
    export SHIELD_NODE=${driver.node}
    export KEEL_DRIVER=${driver.executable}
    export KEEL_FAUX=${driver.faux}
    export KEEL_BASH_FIXTURE=${driver.bashFixture}
    # The scripts import keel's screen code and the contracts, with the driver's packages.
    cp -r ${source} "$TMPDIR/shield"
    chmod -R u+w "$TMPDIR/shield"
    ln -s ${driver.modules} "$TMPDIR/shield/node_modules"
    checks="$TMPDIR/shield/checks/process"
    shield --version
    shield --help
    keel --version
    bun run "$checks/lock-probe.ts"
    bun run "$checks/management.ts"
    bun run "$checks/keel-smoke.ts"
    bun run "$checks/hub-test.ts"
    bun run "$checks/failures.ts"
    touch "$out"
  ''
