# Owns serialized, retryable reconciliation of Hjem-owned user defaults.
# The journal (state.json) lives under .local/state/hjem/defaults in the
# configured home. It records each owned leaf by domain and key path with the
# plist XML of its value before ownership (null when absent), how many of its
# enclosing dictionaries were present then, the actions of its domain, and the
# onChange actions not yet completed. An entry of an earlier journal that names
# a single key is read as the path of that key.
# A run fails before writing when a value along a declared path is not a
# dictionary. A leaf's previous value and the actions a run will cause are
# recorded before any value is written. A leaf is written only when its value
# differs from the declared one. Removing a declaration restores the recorded
# value, or deletes the leaf and the enclosing dictionaries that were absent
# once they are empty, and ends ownership; actions run only when the restore
# changed the value. A leaf whose enclosing value is no longer a dictionary is
# left as it is, with a warning. A removed path that encloses or lies within a
# declared one is restored first, so the declared leaf records the restored
# value. Pending actions are retried by later runs until they complete; a
# service restart while the service manager is not running stays pending, and a
# failed action stops the run with the rest still pending.
# Crystal's stdlib supplies flock, tempfile, file fsync and same-directory
# rename. No directory fsync is performed: full power-loss durability is not
# guaranteed. Preferences and commands are injected; specs substitute fakes.
require "json"
require "./preferences"

module HjemDefaults
  ACTIVATE_SETTINGS = "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings"

  # kind is process (target: name), activateSettings, or service (target: service name).
  record Action, kind : String, target : String do
    include JSON::Serializable
  end

  class Owned
    include JSON::Serializable
    property domain : String
    property path = [] of String
    property present = 0
    property original : String?
    property actions : Array(Action)
    # The single key that an earlier journal recorded instead of a path.
    @[JSON::Field(ignore_serialize: true)]
    property key : String? = nil

    def initialize(@domain, @path, @present, @original, @actions)
    end

    def after_initialize
      if path.empty? && (key = @key)
        @path = [key]
      end
      @key = nil
    end

    def describe : String
      "#{domain} #{path.to_json}"
    end
  end

  class Journal
    include JSON::Serializable
    property keys = [] of Owned
    property pending = [] of Action

    def initialize
    end
  end

  record Leaf, path : Array(String), xml : String do
    include JSON::Serializable
  end

  class Desired
    include JSON::Serializable
    getter domain : String
    getter values : Array(Leaf)
    getter actions : Array(Action)
  end

  enum Outcome
    Done
    Deferred
  end

  # A service restart runs the services module's restart command with the
  # service name; its option description states the exit codes.
  class Commands
    # EX_TEMPFAIL: the service manager is not running.
    DEFERRED = 75

    def initialize(@restart_service : String)
    end

    def status(path : String, args : Array(String), quiet = false) : Int32
      error = quiet ? Process::Redirect::Close : Process::Redirect::Inherit
      Process.run(path, args, output: Process::Redirect::Close, error: error).exit_code
    end

    def run(path : String, args : Array(String), quiet = false) : Bool
      status(path, args, quiet) == 0
    end

    def perform(action : Action) : Outcome
      case action.kind
      when "process"
        # killall fails when the process is not running; it reads the values when launchd starts it.
        run("/usr/bin/killall", [action.target], quiet: true)
        Outcome::Done
      when "activateSettings"
        raise "activateSettings failed" unless run(ACTIVATE_SETTINGS, ["-u"])
        Outcome::Done
      when "service"
        # A service that is not started reads the values when it starts.
        case status(@restart_service, [action.target])
        when 0        then Outcome::Done
        when DEFERRED then Outcome::Deferred
        else               raise "Restart failed: #{action.target}"
        end
      else
        raise "Unknown action: #{action.kind}"
      end
    end
  end

  def self.reconcile(closure : Path, home : Path, prefs, commands)
    state = home / ".local/state/hjem/defaults"
    Dir.mkdir_p(state)
    if File.symlink?(state) || File.info(state).owner_id != LibC.getuid.to_s
      raise "Unsafe owned directory: #{state}"
    end
    File.chmod(state, 0o700)
    lock = state / "lock"
    raise "Unsafe lock" if File.symlink?(lock)
    File.open(lock, "a") do |stream|
      stream.flock_exclusive do
        apply_locked(closure, state, prefs, commands)
      end
    end
  end

  def self.save(path : Path, journal : Journal)
    temp = File.tempfile(".hjem", nil, dir: path.parent.to_s)
    begin
      temp.print(journal.to_json)
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

  def self.overlap?(a : Array(String), b : Array(String)) : Bool
    shorter, longer = a.size <= b.size ? {a, b} : {b, a}
    longer[0, shorter.size] == shorter
  end

  def self.queue(journal : Journal, actions : Array(Action))
    actions.each { |action| journal.pending << action unless journal.pending.includes?(action) }
  end

  # Ends ownership of a leaf, restoring its recorded value when that changes it.
  def self.release(path : Path, journal : Journal, owned : Owned, prefs)
    if prefs.blocked?(owned.domain, owned.path)
      STDERR.puts "Hjem defaults: not restoring #{owned.describe}: an enclosing value is not a dictionary"
    elsif !prefs.matches?(owned.domain, owned.path, owned.original)
      queue(journal, owned.actions)
      save(path, journal)
      if xml = owned.original
        prefs.write(owned.domain, owned.path, xml)
      else
        prefs.remove(owned.domain, owned.path, owned.present)
      end
      prefs.sync(owned.domain)
    end
    journal.keys.delete(owned)
    save(path, journal)
  end

  def self.apply_locked(closure : Path, state : Path, prefs, commands)
    path = state / "state.json"
    raise "Unsafe journal" if File.symlink?(path)
    journal = File.exists?(path) ? Journal.from_json(File.read(path)) : Journal.new
    desired = Array(Desired).from_json(File.read(closure / "defaults.json"))

    wanted = desired.flat_map { |entry| entry.values.map { |leaf| {entry, leaf} } }
    removed = journal.keys.reject do |owned|
      wanted.any? { |entry, leaf| entry.domain == owned.domain && leaf.path == owned.path }
    end
    overlapping, removed = removed.partition do |owned|
      wanted.any? { |entry, leaf| entry.domain == owned.domain && overlap?(leaf.path, owned.path) }
    end
    overlapping.each { |owned| release(path, journal, owned, prefs) }

    blocked = wanted.select { |entry, leaf| prefs.blocked?(entry.domain, leaf.path) }
    unless blocked.empty?
      raise "Not a dictionary along #{blocked.map { |entry, leaf| "#{entry.domain} #{leaf.path.to_json}" }.join(", ")}"
    end
    changed = wanted.reject { |entry, leaf| prefs.matches?(entry.domain, leaf.path, leaf.xml) }

    wanted.each do |entry, leaf|
      if owned = journal.keys.find { |o| o.domain == entry.domain && o.path == leaf.path }
        owned.actions = entry.actions
      else
        journal.keys << Owned.new(entry.domain, leaf.path, prefs.present(entry.domain, leaf.path),
          prefs.read(entry.domain, leaf.path), entry.actions)
      end
    end
    queue(journal, changed.flat_map { |entry, _| entry.actions })
    save(path, journal)

    changed.each { |entry, leaf| prefs.write(entry.domain, leaf.path, leaf.xml) }
    changed.map { |entry, _| entry.domain }.uniq.each { |domain| prefs.sync(domain) }

    removed.each { |owned| release(path, journal, owned, prefs) }

    journal.pending.dup.each do |action|
      if commands.perform(action).deferred?
        puts "Deferred #{action.kind}: #{action.target}"
        next
      end
      journal.pending.delete(action)
      save(path, journal)
    end
  end
end
