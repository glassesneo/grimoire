{delib, ...}:
delib.module {
  name = "security";
  tests.fixture = ["defaults"];
  meta.description = "Configure how a person authenticates to the host: sudo, the login window, and the screen lock.";

  options.enable = delib.boolOption true;

  darwin.ifEnabled = {
    # reattach lets pam_tid reach the GUI session from inside Zellij.
    security.pam.services.sudo_local = {
      touchIdAuth = true;
      reattach = true;
    };
    system.defaults.loginwindow = {
      GuestEnabled = false;
      SHOWFULLNAME = true;
    };
  };

  hjem.ifEnabled.platform.darwin.defaults."com.apple.screensaver".settings = {
    askForPassword = 1;
    askForPasswordDelay = 0;
  };
}
