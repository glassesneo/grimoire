{delib, ...}:
delib.role {
  name = "launcher";
  # Two launchers would contend for the same shortcuts and windows.
  seatedOnly = true;
  meta = {
    description = "Seat the one application launcher a graphical host runs.";
    tags = ["gui"];
  };
}
