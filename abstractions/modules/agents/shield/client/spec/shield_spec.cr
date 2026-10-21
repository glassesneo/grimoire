# The CLI's own rules apart from the hub: framing as the hub frames records, arguments as the
# TypeScript CLI took them, and the socket's locations. The packaged executable against a real
# hub is exercised by shield's process case.
require "file_utils"
require "spec"
require "../shield_cli"

describe Shield::JsonLines do
  it "yields the same records however the bytes are split" do
    bytes = %({"text":"日本 語 ","value":null}\r\n{"empty":""}\n).to_slice
    lines = Shield::JsonLines.new
    records = bytes.flat_map { |byte| lines.feed(Bytes[byte]) }
    records.map(&.to_json).should eq [%({"text":"日本 語 ","value":null}), %({"empty":""})]
    whole = Shield::JsonLines.new.feed(bytes)
    whole.should eq records
  end

  it "refuses a record that is not an object, and one over the limit" do
    expect_raises(Shield::Failure, "invalid_record") { Shield::JsonLines.new.feed("[1]\n".to_slice) }
    over = Bytes.new(Shield::RECORD_LIMIT + 1, 'x'.ord.to_u8)
    expect_raises(Shield::Failure, "frame_limit") { Shield::JsonLines.new.feed(over) }
  end
end

describe "Shield.main" do
  it "prints the version and help without touching the socket" do
    output = IO::Memory.new
    Shield.main(["--version"], output)
    Shield.main(["--socket", "relative", "--help"], output)
    output.to_s.should start_with "shield 0.1.0\nshield [--socket /absolute/hub.sock]"
  end

  it "refuses what the TypeScript CLI refused" do
    expect_raises(Shield::Failure, "invalid arguments") { Shield.main(["--socket", "/tmp/x.sock", "stop"]) }
    expect_raises(Shield::Failure, "invalid arguments") { Shield.main(["--socket=/tmp/x.sock", "list", "extra"]) }
    expect_raises(Shield::Failure, "Unknown option '--sock'") { Shield.main(["--sock=/x", "list"]) }
    expect_raises(Shield::Failure, "argument missing") { Shield.main(["list", "--socket"]) }
    expect_raises(Shield::Failure, "absolute path") { Shield.main(["--socket", "hub.sock", "list"]) }
    expect_raises(Shield::Failure, "too long") { Shield.main(["--socket", "/#{"x" * 100}", "list"]) }
  end
end

describe "Shield.private_directory" do
  it "creates a private directory and refuses a link in its place" do
    root = File.tempname("shield-spec")
    Dir.mkdir(root)
    begin
      target = File.join(root, "a", "b")
      Shield.private_directory(target)
      File.info(target).permissions.value.should eq 0o700
      File.symlink(target, File.join(root, "link"))
      expect_raises(Shield::Failure, "unsafe directory") { Shield.private_directory(File.join(root, "link")) }
      File.write(File.join(root, "file"), "")
      expect_raises(Shield::Failure, "not a directory") { Shield.private_directory(File.join(root, "file", "x")) }
    ensure
      FileUtils.rm_rf(root)
    end
  end

  it "refuses a socket, lock, or log another could read" do
    root = File.tempname("shield-spec")
    Dir.mkdir(root, 0o700)
    begin
      socket = File.join(root, "hub.sock")
      File.write("#{socket}.log", "", perm: 0o644)
      expect_raises(Shield::Failure, "unsafe permissions") { Shield.prepare_socket(socket) }
      File.chmod("#{socket}.log", 0o600)
      Shield.prepare_socket(socket)
      File.info("#{socket}.lock").permissions.value.should eq 0o600
    ensure
      FileUtils.rm_rf(root)
    end
  end
end

describe "Shield.main without a hub" do
  it "prints help without creating the state directory" do
    root = File.tempname("shield-spec")
    previous = ENV["XDG_STATE_HOME"]?
    ENV["XDG_STATE_HOME"] = root
    begin
      Shield.main(["--help"], IO::Memory.new)
      Dir.exists?(root).should be_false
    ensure
      previous ? (ENV["XDG_STATE_HOME"] = previous) : ENV.delete("XDG_STATE_HOME")
    end
  end

  it "takes a socket path of 100 bytes and refuses one of 101" do
    Shield.socket_path("/" + "x" * 99).bytesize.should eq 100
    expect_raises(Shield::Failure, "too long") { Shield.socket_path("/" + "x" * 100) }
  end
end

describe "Shield.prepare_socket" do
  it "refuses a socket, lock, or log that is a link" do
    root = File.tempname("shield-spec")
    Dir.mkdir(root, 0o700)
    begin
      target = File.join(root, "target")
      File.write(target, "", perm: 0o600)
      %w(hub.sock hub.sock.lock hub.sock.log).each do |name|
        dir = File.join(root, name + ".d")
        Dir.mkdir(dir, 0o700)
        File.symlink(target, File.join(dir, name))
        expect_raises(Shield::Failure, "unsafe") { Shield.prepare_socket(File.join(dir, "hub.sock")) }
      end
      File.read(target).should eq ""
    ensure
      FileUtils.rm_rf(root)
    end
  end
end

# A hub stand-in that answers each request with `records`, sent one at a time.
private def serve(path : String, records : Array(String), interval : Time::Span) : UNIXServer
  server = UNIXServer.new(path)
  spawn do
    if client = server.accept?
      client.gets
      records.each do |record|
        client.print(record + "\n")
        client.flush
        sleep interval
      end
      sleep 1.second
      client.close
    end
  end
  server
end

describe Shield::Client do
  it "gives up when the request's deadline passes, however much else keeps arriving" do
    path = File.tempname("shield", ".sock")
    other = %({"v":1,"type":"event","agent-id":"a","engine":"keel","payload":{}})
    server = serve(path, Array.new(40, other), 30.milliseconds)
    begin
      started = Time.instant
      expect_raises(Shield::Failure, "request_timeout") { Shield::Client.new(path, 200.milliseconds).hub("ping") }
      (Time.instant - started).should be < 600.milliseconds
    ensure
      server.close
      File.delete?(path)
    end
  end

  it "refuses a record that is not the hub's envelope" do
    path = File.tempname("shield", ".sock")
    server = serve(path, [%({"v":1,"type":"response","id":"c0"})], 10.milliseconds)
    begin
      expect_raises(Shield::Failure, "invalid_protocol") { Shield::Client.new(path, 1.second).hub("ping") }
    ensure
      server.close
      File.delete?(path)
    end
  end
end
