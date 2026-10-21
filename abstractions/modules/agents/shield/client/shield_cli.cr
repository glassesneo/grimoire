# The SHIELD management CLI: `shield [--socket PATH] start|list|stop ID|shutdown`. It starts the
# hub through the packaged launcher and sends the hub's own requests over its socket; it is
# not a screen and follows no agent.
#
# The socket defaults to $XDG_STATE_HOME/shield/hub.sock, its directory is 0700 and created
# when missing, and the socket, its lock, and its log must be the user's own, not links, and
# not readable by others; the lock is created once and never replaced, so its inode stays the
# one the launcher locks. The hub is started detached, in its own session, with its output
# appended to `<socket>.log`; `start` returns once the hub answers, or fails after 10 s. A
# request the hub has not answered within 65 s, the hub's own deadline and a margin, has
# unknown acceptance and is not resent. Errors go to stderr as `shield: <message>` with exit
# status 1. Records are framed as the hub frames them (Shield.Protocol): LF-delimited JSON
# objects of at most 64 MiB, split on bytes so a split UTF-8 sequence or a Unicode line
# separator inside a string never ends a record.
require "json"
require "socket"

lib LibC
  fun setsid : PidT
end

module Shield
  VERSION      = "0.1.0"
  RECORD_LIMIT = 64 * 1024 * 1024
  # The hub answers within 60 s; this waits that and a margin, never less.
  REQUEST_TIMEOUT = 65.seconds

  HELP = <<-TEXT
    shield [--socket /absolute/hub.sock] start|list|stop <id>|shutdown
    Starts and manages the SHIELD hub that runs keel agents. Pass the same --socket to keel.
    Agents end with the hub; Pi's session files remain. After shutdown, wait for the hub to exit before starting another.
    New agents inherit the environment of the keel screen that started them, including CMD_API_KEY or COMMAND_CODE_API_KEY for CommandCode.
    TEXT

  # A failure reported to the user as it is; `code` names an operating system error.
  class Failure < Exception
    getter code : String?

    def initialize(message : String, @code : String? = nil)
      super(message)
    end
  end

  # LF-delimited JSON objects from bytes that may arrive in any pieces.
  class JsonLines
    @pending = IO::Memory.new

    def feed(bytes : Bytes) : Array(JSON::Any)
      records = [] of JSON::Any
      start = 0
      while start < bytes.size
        rest = bytes[start..]
        index = rest.index(10_u8)
        chunk = index ? rest[0, index] : rest
        raise Failure.new("frame_limit") if @pending.size + chunk.size > RECORD_LIMIT
        @pending.write(chunk)
        break unless index
        line = String.new(@pending.to_slice)
        @pending = IO::Memory.new
        raise Failure.new("invalid_record") unless line.valid_encoding?
        value = JSON.parse(line.rchop("\r"))
        raise Failure.new("invalid_record") unless value.as_h?
        records << value
        start += index + 1
      end
      records
    end
  end

  def self.state_directory : String
    base = ENV["XDG_STATE_HOME"]?.presence || File.join(Path.home.to_s, ".local/state")
    File.join(base, "shield")
  end

  def self.socket_path(value : String?) : String
    path = value || File.join(state_directory, "hub.sock")
    raise Failure.new("--socket requires an absolute path") unless path.starts_with?("/")
    raise Failure.new("socket path too long (Darwin Unix socket limit)") if path.bytesize > 100
    path
  end

  # Cooperative same-user boundary: refuse links and others' paths. /tmp, /var, and /etc are
  # OS-owned links on Darwin, so they are followed as ancestors, never as the directory itself.
  def self.private_directory(path : String) : Nil
    path = Path.new(path).expand.to_s
    current = "/"
    path.lchop("/").split("/").each do |part|
      next if part.empty?
      current = File.join(current, part)
      info = File.info?(current, follow_symlinks: false)
      if info.nil?
        Dir.mkdir(current, 0o700)
      elsif info.symlink?
        if current == path || info.owner_id != "0" || !["/tmp", "/var", "/etc"].includes?(current)
          raise Failure.new("unsafe directory: #{current}")
        end
        current = File.realpath(current)
      elsif !info.directory?
        raise Failure.new("not a directory: #{current}")
      end
    end
    info = File.info(path, follow_symlinks: false)
    unless info.owner_id == LibC.getuid.to_s && info.directory? && !info.symlink?
      raise Failure.new("unsafe directory owner/type: #{path}")
    end
    File.chmod(path, 0o700)
  end

  private def self.managed_file(path : String, kind : String) : Nil
    info = File.info?(path, follow_symlinks: false)
    return if info.nil?
    expected = kind == "file" ? info.file? : info.type.socket?
    if info.owner_id != LibC.getuid.to_s || info.symlink? || !expected
      raise Failure.new("unsafe #{kind}: #{path}")
    end
    raise Failure.new("unsafe permissions: #{path}") if info.permissions.value & 0o077 != 0
  end

  private def self.open_file(path : String, flags : Int32) : Int32
    fd = LibC.open(path, flags | LibC::O_NOFOLLOW | LibC::O_CLOEXEC, 0o600)
    raise Failure.new("open #{Errno.value} #{path}", Errno.value.to_s) if fd < 0
    fd
  end

  def self.prepare_socket(path : String) : Nil
    private_directory(File.dirname(path))
    managed_file(path, "socket")
    managed_file("#{path}.lock", "file")
    LibC.close(open_file("#{path}.lock", LibC::O_RDWR | LibC::O_CREAT))
    managed_file("#{path}.log", "file")
  end

  # One connection to the hub, for one request at a time.
  class Client
    @socket : UNIXSocket
    @lines = JsonLines.new
    @next = 0

    def initialize(path : String, @timeout : Time::Span = REQUEST_TIMEOUT)
      @socket = begin
        UNIXSocket.new(path)
      rescue error : Socket::ConnectError
        code = error.os_error.try(&.to_s)
        raise Failure.new("connect #{code} #{path}", code)
      end
    end

    def hub(method : String, payload = {} of String => JSON::Any) : JSON::Any
      id = "c#{@next}"
      @next += 1
      record = {
        "v" => 1, "type" => "hub_request", "id" => id, "agent-id" => nil, "engine" => nil,
        "method" => method, "payload" => payload,
      }
      frame = record.to_json + "\n"
      raise Failure.new("outgoing_frame_or_queue_limit") if frame.bytesize > RECORD_LIMIT
      @socket.write(frame.to_slice)
      @socket.flush
      # The deadline is the request's, not each read's: records that keep arriving without its
      # answer do not extend it.
      deadline = Time.instant + @timeout
      buffer = Bytes.new(65536)
      loop do
        remaining = deadline - Time.instant
        raise Failure.new("request_timeout; acceptance unknown (not resent)") if remaining <= Time::Span.zero
        @socket.read_timeout = remaining
        count = begin
          @socket.read(buffer)
        rescue IO::TimeoutError
          raise Failure.new("request_timeout; acceptance unknown (not resent)")
        end
        raise Failure.new("disconnected; pending requests have unknown acceptance (not resent)") if count == 0
        @lines.feed(buffer[0, count]).each do |r|
          h = r.as_h
          unless h["v"]? == 1 && h.has_key?("agent-id") && h.has_key?("engine")
            raise Failure.new("invalid_protocol")
          end
          return r if h["type"]? == "response" && h["id"]? == id
        end
      end
    end

    def close : Nil
      @socket.close
    end
  end

  # Whether a hub answers at `path`; a missing or refusing socket means none does.
  def self.ping(path : String) : Bool
    client = Client.new(path)
    begin
      client.hub("ping")["success"]? == true
    ensure
      client.close
    end
  rescue error : Failure
    raise error unless error.code.in?("ENOENT", "ECONNREFUSED")
    false
  end

  def self.start_hub(path : String) : Nil
    prepare_socket(path)
    return if ping(path)
    launcher = ENV["SHIELD_LAUNCHER"]?
    raise Failure.new("SHIELD_LAUNCHER is missing; use the packaged shield executable") unless launcher
    log = open_file("#{path}.log", LibC::O_WRONLY | LibC::O_APPEND | LibC::O_CREAT)
    begin
      spawn_detached(launcher, ENV.to_h.merge({"SHIELD_SOCKET" => path}), log)
    ensure
      LibC.close(log)
    end
    100.times do
      sleep 100.milliseconds
      return if ping(path)
    end
    raise Failure.new("hub not ready; another start may hold the lock. Inspect #{path}.log")
  end

  # Starts `executable` in a session of its own, so the terminal's signals and hangup do not
  # reach the hub, with stdin from /dev/null, stdout and stderr to `log`, every signal's
  # disposition back to the default and none blocked, as a freshly spawned process has them
  # (the Crystal runtime ignores SIGPIPE, which exec would otherwise pass on). Everything the
  # child needs is prepared before the fork, which happens with signals blocked so no handler
  # of this process runs in the child; between fork and exec the child only calls
  # async-signal-safe functions. A failed exec is reported through a pipe that a successful
  # one closes.
  private def self.spawn_detached(executable : String, env : Hash(String, String), log : Int32) : Nil
    strings = env.map { |key, value| "#{key}=#{value}" }
    envp = strings.map(&.to_unsafe) + [Pointer(UInt8).null]
    argv = [executable.to_unsafe, Pointer(UInt8).null]
    null = open_file("/dev/null", LibC::O_RDONLY)
    status = uninitialized StaticArray(Int32, 2)
    raise Failure.new("pipe #{Errno.value}", Errno.value.to_s) if LibC.pipe(status) != 0
    status.each { |fd| LibC.fcntl(fd, LibC::F_SETFD, LibC::FD_CLOEXEC) }
    all = uninitialized LibC::SigsetT
    none = uninitialized LibC::SigsetT
    saved = uninitialized LibC::SigsetT
    LibC.sigfillset(pointerof(all))
    LibC.sigemptyset(pointerof(none))
    begin
      LibC.pthread_sigmask(LibC::SIG_SETMASK, pointerof(all), pointerof(saved))
      pid = LibC.fork
      if pid == 0
        (1..31).each do |signal|
          LibC.signal(signal, LibC::SIG_DFL) unless signal.in?(LibC::SIGKILL, LibC::SIGSTOP)
        end
        LibC.pthread_sigmask(LibC::SIG_SETMASK, pointerof(none), nil)
        LibC.setsid
        LibC.dup2(null, 0)
        LibC.dup2(log, 1)
        LibC.dup2(log, 2)
        LibC.execve(executable, argv.to_unsafe, envp.to_unsafe)
        failure : Int32 = Errno.value.value
        LibC.write(status[1], pointerof(failure).as(Void*), sizeof(Int32))
        LibC._exit(127)
      end
      error = Errno.value
      LibC.pthread_sigmask(LibC::SIG_SETMASK, pointerof(saved), nil)
      raise Failure.new("fork #{error}", error.to_s) if pid < 0
      LibC.close(status[1])
      status[1] = -1
      code = 0
      if LibC.read(status[0], pointerof(code).as(Void*), sizeof(Int32)) == sizeof(Int32)
        raise Failure.new("spawn #{executable} #{Errno.new(code)}", Errno.new(code).to_s)
      end
    ensure
      LibC.close(null)
      status.each { |fd| LibC.close(fd) if fd >= 0 }
    end
  end

  # The options and positional arguments, as Node's strict `parseArgs` accepted them.
  def self.parse(args : Array(String)) : {Hash(String, String | Bool), Array(String)}
    values = {} of String => String | Bool
    positionals = [] of String
    index = 0
    while index < args.size
      arg = args[index]
      index += 1
      case arg
      when "--"
        positionals.concat(args[index..])
        break
      when "--version", "--help"
        values[arg.lchop("--")] = true
      when "--socket"
        if index >= args.size || args[index].starts_with?("-")
          raise Failure.new("Option '--socket <value>' argument missing")
        end
        values["socket"] = args[index]
        index += 1
      when .starts_with?("--socket=")
        values["socket"] = arg.lchop("--socket=")
      when "-"
        positionals << arg
      when .starts_with?("-")
        raise Failure.new("Unknown option '#{arg.split("=").first}'")
      else
        positionals << arg
      end
    end
    {values, positionals}
  end

  def self.main(args : Array(String), output : IO = STDOUT) : Nil
    values, positionals = parse(args)
    if values["version"]?
      output.puts "shield #{VERSION}"
      return
    end
    if values["help"]? || args.empty?
      output.puts HELP
      return
    end
    path = socket_path(values["socket"]?.as(String?))
    method = positionals[0]?
    count = method == "stop" ? 2 : 1
    unless method.in?("start", "list", "stop", "shutdown") && positionals.size == count
      raise Failure.new("invalid arguments; see shield --help")
    end
    if method == "start"
      start_hub(path)
      output.puts "SHIELD ready: #{path}"
      return
    end
    client = Client.new(path)
    begin
      payload = method == "stop" ? {"id" => JSON::Any.new(positionals[1])} : {} of String => JSON::Any
      r = client.hub(method.not_nil!, payload)
      unless r["success"]? == true
        code = r.dig?("error", "code").try(&.as_s?)
        raise Failure.new(code.presence || "request failed")
      end
      if method == "list"
        r["payload"].as_a.each do |a|
          output.puts "#{a["agent-id"]}\t#{a["state"]}\t#{a["harness"]}/#{a["engine"]}\t#{a["cwd"]}"
        end
      end
    ensure
      client.close
    end
  end
end
