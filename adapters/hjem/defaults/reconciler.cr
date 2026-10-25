# Owns serialized, retryable reconciliation of Hjem-owned user defaults.
# The journal (state.json) lives under .local/state/hjem/defaults in the
# configured home. It records each owned key with the plist XML of its value
# before ownership (null when absent), the actions of its domain, and the
# onChange actions not yet completed.
# A key's previous value and the actions a run will cause are recorded before
# any value is written. A key is written only when its value differs from the
# declared one. Removing a declaration restores the recorded value, deleting
# the key when it was absent, and ends ownership; actions run only when the
# restore changed the value. Pending actions are retried by later runs until
# they complete; a GUI-domain service restart without a GUI session stays
# pending, and a failed action stops the run with the rest still pending.
# Crystal's stdlib supplies flock, tempfile, file fsync and same-directory
# rename. No directory fsync is performed: full power-loss durability is not
# guaranteed. Preferences and commands are injected; specs substitute fakes.
require "json"
require "./preferences"

module HjemDefaults
  ACTIVATE_SETTINGS = "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings"

  # kind is process (target: name), activateSettings, or service (target: domain/label).
  record Action, kind : String, target : String do
    include JSON::Serializable
  end

  class Owned
    include JSON::Serializable
    property domain : String
    property key : String
    property original : String?
    property actions : Array(Action)

    def initialize(@domain, @key, @original, @actions)
    end
  end

  class Journal
    include JSON::Serializable
    property keys = [] of Owned
    property pending = [] of Action

    def initialize
    end
  end

  class Desired
    include JSON::Serializable
    getter domain : String
    getter keys : Hash(String, String)
    getter actions : Array(Action)
  end

  enum Outcome
    Done
    Deferred
  end

  class Commands
    def run(path : String, args : Array(String), quiet = false) : Bool
      error = quiet ? Process::Redirect::Close : Process::Redirect::Inherit
      Process.run(path, args, output: Process::Redirect::Close, error: error).success?
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
        kind, label = action.target.split("/", 2)
        domain = "#{kind}/#{LibC.getuid}"
        unless run("/bin/launchctl", ["print", domain], quiet: true)
          raise "Unavailable #{domain}" unless kind == "gui"
          return Outcome::Deferred
        end
        # A job that is not loaded reads the values when it starts.
        return Outcome::Done unless run("/bin/launchctl", ["print", "#{domain}/#{label}"], quiet: true)
        raise "Restart failed: #{domain}/#{label}" unless run("/bin/launchctl", ["kickstart", "-k", "#{domain}/#{label}"])
        Outcome::Done
      else
        raise "Unknown action: #{action.kind}"
      end
    end
  end

  def self.reconcile(closure : Path, home : Path, prefs, commands = Commands.new)
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

  def self.apply_locked(closure : Path, state : Path, prefs, commands)
    path = state / "state.json"
    raise "Unsafe journal" if File.symlink?(path)
    journal = File.exists?(path) ? Journal.from_json(File.read(path)) : Journal.new
    desired = Array(Desired).from_json(File.read(closure / "defaults.json"))

    wanted = desired.flat_map { |entry| entry.keys.map { |key, xml| {entry, key, xml} } }
    changed = wanted.reject { |entry, key, xml| prefs.matches?(entry.domain, key, xml) }
    removed = journal.keys.reject do |owned|
      wanted.any? { |entry, key, _| entry.domain == owned.domain && key == owned.key }
    end
    restored = removed.reject { |owned| prefs.matches?(owned.domain, owned.key, owned.original) }

    wanted.each do |entry, key, _|
      if owned = journal.keys.find { |o| o.domain == entry.domain && o.key == key }
        owned.actions = entry.actions
      else
        journal.keys << Owned.new(entry.domain, key, prefs.read(entry.domain, key), entry.actions)
      end
    end
    (changed.flat_map { |entry, _, _| entry.actions } + restored.flat_map(&.actions)).each do |action|
      journal.pending << action unless journal.pending.includes?(action)
    end
    save(path, journal)

    changed.each { |entry, key, xml| prefs.write(entry.domain, key, xml) }
    changed.map { |entry, _, _| entry.domain }.uniq.each { |domain| prefs.sync(domain) }

    removed.each do |owned|
      if restored.includes?(owned)
        prefs.write(owned.domain, owned.key, owned.original)
        prefs.sync(owned.domain)
      end
      journal.keys.delete(owned)
      save(path, journal)
    end

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
