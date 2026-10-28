{delib, ...}:
delib.module {
  name = "identity";
  meta.description = "Expose the fixed identity of the person who uses these hosts.";

  options = with delib; {
    fullName = readOnly (strOption "Neo Kitani" "Full name of the person.");
    email = readOnly (strOption "glassesneo@protonmail.com" "Email address of the person.");
  };
}
