# The hub's Pi view and quin's patch application agree record by record; needs
# neither the published packages nor Pi.
{
  inputs,
  pkgs,
  system,
}: let
  quin = inputs.self.packages.${system}.quin or null;
  shield = ../../abstractions/modules/agents/shield;
  source = pkgs.lib.fileset.toSource {
    root = ../..;
    fileset = pkgs.lib.fileset.unions [./. (shield + "/hub") (shield + "/quin/view.ts") (shield + "/client/protocol.ts")];
  };
in
  pkgs.runCommand "shield-trace-check" {
    nativeBuildInputs = [pkgs.bun pkgs.beamPackages.elixir];
    meta.platforms =
      if quin == null
      then []
      else quin.meta.platforms;
  } ''
    export HOME="$TMPDIR"
    cp -r ${source} work
    chmod -R u+w work
    pushd work/abstractions/modules/agents/shield/hub
    MIX_ENV=test mix compile
    popd
    bun run work/tests/shield-trace/view-trace.ts
    touch "$out"
  ''
