# Builds when reconcile.nu brings a real dinit and its services through
# test/reconcile.nu's generations, with launchctl replaced by a fake.
{
  dinit,
  nushell,
  runCommand,
  writeShellScript,
}: let
  launchctl = writeShellScript "launchctl" ''
    exec ${nushell}/bin/nu --no-config-file ${./fake-launchctl.nu} "$@"
  '';
in
  runCommand "services-reconcile" {nativeBuildInputs = [dinit nushell];} ''
    export HOME="$TMPDIR/home" SOCKET="$TMPDIR/s" DINITCTL=${dinit}/bin/dinitctl
    export RECONCILE=${../reconcile.nu} LAUNCHCTL=${launchctl}
    export FAKE_LAUNCHD="$TMPDIR/launchd" FAKE_AGENT="$TMPDIR/agent"
    mkdir -p "$HOME"
    status=0
    nu --no-config-file ${./.}/reconcile.nu || status=$?
    # A failed scene leaves dinit running.
    "$DINITCTL" --socket-path "$SOCKET" shutdown >/dev/null 2>&1 || true
    [ "$status" = 0 ]
    touch "$out"
  ''
