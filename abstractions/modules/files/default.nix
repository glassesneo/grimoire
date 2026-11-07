{delib, ...}:
delib.module {
  name = "files";
  requires = ["defaults"];
  meta.description = "Configure how the Finder and file dialogs present files, and what the Finder writes to other volumes.";

  options.enable = delib.boolOption true;

  hjem.ifEnabled.platform.darwin.defaults = {
    "com.apple.finder" = {
      settings = {
        _FXShowPosixPathInTitle = true;
        _FXSortFoldersFirst = true;
        AppleShowAllExtensions = true;
        AppleShowAllFiles = true;
        CreateDesktop = false;
        FXDefaultSearchScope = "SCcf"; # Search the current folder
        FXEnableExtensionChangeWarning = false;
        NewWindowTarget = "PfHm"; # Home directory
        QuitMenuItem = true;
        ShowExternalHardDrivesOnDesktop = true;
        ShowHardDrivesOnDesktop = true;
        ShowMountedServersOnDesktop = true;
        ShowPathbar = true;
        ShowRemovableMediaOnDesktop = true;
        ShowStatusBar = true;
      };
      onChange.restartProcesses = ["Finder"];
    };
    NSGlobalDomain.settings = {
      NSNavPanelExpandedStateForSaveMode = true;
      NSNavPanelExpandedStateForSaveMode2 = true;
    };
    "com.apple.desktopservices".settings = {
      DSDontWriteNetworkStores = true;
      DSDontWriteUSBStores = true;
    };
  };
}
