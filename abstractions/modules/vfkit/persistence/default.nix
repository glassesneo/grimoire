{delib, ...}:
delib.module {
  name = "vfkit.persistence";
  meta.description = "Provide vfkit for running virtual machines with Apple Virtualization.framework.";

  options.enable = delib.boolOption false;

  darwin.ifEnabled = {pkgs, ...}: {
    launchd.daemons.agent-vm.serviceConfig = {
      ProgramArguments = [
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
        "virtio-serial,logFilePath=/var/log/agent-vm.log"
        "--device"
        "virtio-rng"
      ];
      RunAtLoad = true;
      KeepAlive = true;
      StandardErrorPath = "/var/log/agent-vm.err.log";
    };
  };
}
