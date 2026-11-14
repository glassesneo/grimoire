{delib, ...}:
delib.module ({myconfig, ...}: {
  name = "vfkit.persistence";
  meta.description = "Provide vfkit for running virtual machines with Apple Virtualization.framework.";

  options.enable = delib.boolOption false;
  tests.fixture = ["services"];

  hjem.ifEnabled = {pkgs, ...}: {
    userServices.agent-vm = {
      command = [
        "${pkgs.vfkit}/bin/vfkit"
        "--cpus"
        "2"
        "--memory"
        "2048"
        "--bootloader"
        "efi,variable-store=/var/lib/agent-vm/efi-vars.fd,create"
        "--device"
        "virtio-blk,path=/var/lib/agent-vm/disk.raw"
        "--cloud-init"
        "${./cloud-init}/user-data,${./cloud-init}/meta-data"
        "--device"
        "virtio-net,nat,mac=52:54:00:12:34:56"
        "--device"
        "virtio-serial,logFilePath=${myconfig.host.user.homeDirectory}/Library/Logs/agent-vm.log"
        "--device"
        "virtio-rng"
      ];
      restart = "always";
      logFile = "${myconfig.host.user.homeDirectory}/Library/Logs/agent-vm.err.log";
    };
  };
})
