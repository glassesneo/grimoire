# Owns serialized, retryable LaunchAgent reconciliation. The JSON array is a
# write-ahead ownership journal, not evidence inferred from installed files.
# The journal (state.json) and persistent generation roots live under
# .local/state/hjem/services in the configured home, beyond temporary build roots.
# Intent precedes installation; successful operations are never rolled back.
# Failed/deferred entries and desired intent retain their generation roots.
# Changed serialized plist content triggers retirement and registration even
# when restartOnSwitch is false; formatting-only differences count.
# Crystal's stdlib supplies flock, tempfile, file fsync and same-directory
# rename. The kernel lock is released when its file closes or the process exits.
# No directory fsync is performed: full power-loss durability is not guaranteed.
# launchctl is invoked without a shell; specs substitute a fake.
require "json"
require "file_utils"
require "set"

module HjemServices
  struct Owned
  end

  struct Removing
  end

  struct Retired
  end

  alias Intent = Owned | Removing | Retired

  # Keep the legacy wire separate from in-memory intent. Owned means ownership
  # intent, not that a copy or bootstrap has completed. Removing is cancellable
  # by the next desired generation; Retired must finish removing its identity.
  class Wire
    include JSON::Serializable
    property name : String
    property label : String
    property domain : String
    property content : String
    property root : String
    property restart : Bool
    # Older journals omit this field; execution uses the desired job's policy.
    @[JSON::Field(key: "runAtLoad")]
    property run_at_load : Bool = false
    property remove : Bool = false
    property retired : Bool? = nil

    def initialize(@name, @label, @domain, @content, @root, @restart, @run_at_load)
    end
  end

  class Entry
    getter wire : Wire
    property intent : Intent

    def initialize(@wire : Wire)
      raise "Invalid retired journal intent" if wire.retired == true && !wire.remove
      @intent = wire.retired == true ? Retired.new : wire.remove ? Removing.new : Owned.new
    end

    def owned? : Bool
      intent.is_a?(Owned)
    end

    def retired? : Bool
      intent.is_a?(Retired)
    end

    def same_identity?(other : Entry) : Bool
      a, b = wire, other.wire
      a.name == b.name && a.label == b.label && a.domain == b.domain && a.content == b.content
    end

    def to_json(json : JSON::Builder)
      case intent
      in Owned
        wire.remove = false
      in Removing
        wire.remove = true
      in Retired
        wire.remove = true
        wire.retired = true
      end
      wire.to_json(json)
    end
  end

  class Launchctl
    record Result, output : String, error : String, success : Bool

    def run(args : Array(String), check = false) : Result
      output, error = IO::Memory.new, IO::Memory.new
      status = Process.run("/bin/launchctl", args, output: output, error: error)
      result = Result.new(output.to_s, error.to_s, status.success?)
      raise(result.error.empty? ? result.output : result.error) if check && !result.success
      result
    end

    def available(domain : String) : Bool
      run(["print", domain]).success
    end

    def loaded(domain : String, label : String, path : Path) : Bool
      result = run(["print", "#{domain}/#{label}"])
      unless result.success
        raise "Cannot inspect #{domain}" unless available(domain)
        return false
      end
      paths = result.output.scan(Regex.new("^\\s*path = (.+)$", Regex::Options::MULTILINE_ONLY)).map(&.[1])
      raise "Unmanaged or ambiguous loaded job: #{domain}/#{label}" unless paths == [path.to_s]
      true
    end

    def disabled(domain : String, label : String) : Bool
      output = run(["print-disabled", domain], check: true).output
      pattern = Regex.new("^\\s*\"" + Regex.escape(label) + "\"\\s*=>\\s*(true|false|disabled|enabled)\\s*$", Regex::Options::MULTILINE_ONLY)
      output.scan(pattern).any? { |match| {"true", "disabled"}.includes?(match[1]) }
    end

    def bootout(domain : String, label : String)
      run(["bootout", "#{domain}/#{label}"], check: true)
    end

    def bootstrap(domain : String, path : Path)
      run(["bootstrap", domain, path.to_s], check: true)
    end

    def restart(domain : String, label : String)
      run(["kickstart", "-k", "#{domain}/#{label}"], check: true)
    end
  end

  # Only the physical LaunchAgents filename mapping is replaceable, to model
  # case-insensitive APFS without changing the spelling passed to launchctl.
  class Files
    def physical(path : Path) : Path
      path
    end

    def atomic(path : Path, data : String)
      path = physical(path)
      temp = File.tempfile(".hjem", nil, dir: path.parent.to_s)
      begin
        temp.print(data)
        temp.flush
        temp.fsync
        temp.chmod(0o600)
        temp.close
        File.rename(temp.path, path)
      ensure
        temp.close unless temp.closed?
        File.delete(temp.path) if File.exists?(temp.path)
      end
    end
  end

  def self.reconcile(closure : Path, home : Path, nix_store : String, ctl, files = Files.new)
    state = home / ".local/state/hjem/services"
    agents = home / "Library/LaunchAgents"
    {state, agents}.each do |directory|
      Dir.mkdir_p(directory)
      if File.symlink?(directory) || File.info(directory).owner_id != LibC.getuid.to_s
        raise "Unsafe owned directory: #{directory}"
      end
    end
    File.chmod(state, 0o700)
    lock = state / "lock"
    raise "Unsafe lock" if File.symlink?(lock)
    File.open(lock, "a") do |stream|
      stream.flock_exclusive do
        apply_locked(closure, state, agents, nix_store, ctl, files)
      end
    end
  end

  def self.verify_file(record : Entry, agents : Path, files : Files) : Path
    path = agents / (record.wire.label + ".plist")
    physical = files.physical(path)
    if File.symlink?(physical) || (File.exists?(physical) && (File.info(physical).owner_id != LibC.getuid.to_s || File.read(physical) != record.wire.content))
      raise "Refusing modified/unmanaged file: #{path}"
    end
    path
  end

  def self.domain(record : Entry) : String
    "#{record.wire.domain}/#{LibC.getuid}"
  end

  def self.save(journal : Path, records : Array(Entry), files : Files)
    files.atomic(journal, records.to_json)
  end

  def self.apply_locked(closure : Path, state : Path, agents : Path, nix_store : String, ctl, files : Files)
    journal = state / "state.json"
    raise "Unsafe journal" if File.symlink?(journal)
    records = File.exists?(journal) ? Array(Wire).from_json(File.read(journal)).map { |wire| Entry.new(wire) } : [] of Entry
    desired = JSON.parse(File.read(closure / "services.json")).as_a
    root = state / ("root-" + closure.basename)
    if File.symlink?(root) && Path[File.realpath(root)] != closure
      raise "Unexpected GC root"
    end
    status = Process.run(nix_store, ["--add-root", root.to_s, "--indirect", "--realise", closure.to_s], output: Process::Redirect::Close, error: Process::Redirect::Inherit)
    raise "nix-store failed: #{status}" unless status.success?

    records.each do |record|
      if !record.retired?
        verify_file(record, agents, files)
      elsif !records.any? { |r| r.wire.label.downcase == record.wire.label.downcase && !r.retired? }
        path = files.physical(agents / (record.wire.label + ".plist"))
        raise "Refusing file created after managed removal: #{path}" if File.exists?(path) || File.symlink?(path)
      end
    end
    wanted = desired.map do |job|
      label = job["label"].as_s
      Entry.new(Wire.new(job["name"].as_s, label, job["domain"].as_s,
        File.read(closure / "plists" / (label + ".plist")), root.to_s,
        job["restart"].as_bool, job["runAtLoad"].as_bool))
    end
    identities = records.map { |r| {r.wire.domain, r.wire.label} }.to_set
    (records + wanted).map(&.wire.label).uniq.each do |label|
      {"user", "gui"}.each do |kind|
        dom = "#{kind}/#{LibC.getuid}"
        if ctl.available(dom) && ctl.loaded(dom, label, agents / (label + ".plist"))
          raise "Refusing unmanaged job: #{dom}/#{label}" unless identities.includes?({kind, label})
        end
      end
    end
    records.each do |record|
      unless record.retired?
        record.intent = wanted.any? { |new| record.same_identity?(new) } ? Owned.new : Removing.new
      end
    end
    save(journal, records, files)

    records.dup.each do |record|
      next if record.owned?
      path = record.retired? ? agents / (record.wire.label + ".plist") : verify_file(record, agents, files)
      dom = domain(record)
      available = ctl.available(dom)
      ctl.bootout(dom, record.wire.label) if available && ctl.loaded(dom, record.wire.label, path)
      unless record.retired?
        physical = files.physical(path)
        File.delete(physical) if File.exists?(physical)
        record.intent = Retired.new
        save(journal, records, files)
      end
      unless available
        raise "Unavailable #{dom}" unless record.wire.domain == "gui"
        puts "Deferred GUI removal: #{record.wire.label}"
        next
      end
      records.delete(record)
      save(journal, records, files)
    end

    wanted.each do |new|
      record = records.find { |r| r.wire.name == new.wire.name && r.owned? }
      path = agents / (new.wire.label + ".plist")
      physical = files.physical(path)
      dom = domain(new)
      available = ctl.available(dom)
      raise "Unavailable #{dom}" if !available && new.wire.domain != "gui"
      unless record
        raise "Refusing unmanaged file: #{path}" if File.exists?(physical) || File.symlink?(physical)
        raise "Refusing unmanaged job: #{new.wire.label}" if available && ctl.loaded(dom, new.wire.label, path)
        records << new
        record = new
        save(journal, records, files)
      end
      verify_file(record, agents, files)
      if !File.exists?(physical)
        files.atomic(path, new.wire.content)
      else
        File.chmod(physical, 0o600)
      end
      unless available
        puts "Deferred GUI registration: #{new.wire.label}"
        next
      end
      if ctl.disabled(dom, new.wire.label)
        puts "Manually disabled, startup skipped: #{new.wire.label}"
        next
      end
      bootstrapped = !ctl.loaded(dom, new.wire.label, path)
      ctl.bootstrap(dom, path) if bootstrapped
      # RunAtLoad has already started a newly registered job. Do not kill it.
      ctl.restart(dom, new.wire.label) if new.wire.restart && !(bootstrapped && new.wire.run_at_load)
      record.wire.restart = new.wire.restart
      record.wire.run_at_load = new.wire.run_at_load
      record.wire.root = new.wire.root
      save(journal, records, files)
    end

    keep = records.map(&.wire.root).to_set.add(root.to_s)
    Dir.glob((state / "root-*").to_s).each do |old|
      File.delete(old) unless keep.includes?(old)
    end
  end
end
