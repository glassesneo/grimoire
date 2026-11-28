require "json"
require "./preferences"

module HjemDefaults
  ACTIVATE_SETTINGS = "/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings"

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

  class Commands
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
        run("/usr/bin/killall", [action.target], quiet: true)
        Outcome::Done
      when "activateSettings"
        raise "activateSettings failed" unless run(ACTIVATE_SETTINGS, ["-u"])
        Outcome::Done
      when "service"
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

    journal_dirty = !File.exists?(path)
    wanted.each do |entry, leaf|
      if owned = journal.keys.find { |o| o.domain == entry.domain && o.path == leaf.path }
        if owned.actions != entry.actions
          owned.actions = entry.actions
          journal_dirty = true
        end
      else
        journal.keys << Owned.new(entry.domain, leaf.path, prefs.present(entry.domain, leaf.path),
          prefs.read(entry.domain, leaf.path), entry.actions)
        journal_dirty = true
      end
    end
    pending_before = journal.pending.size
    queue(journal, changed.flat_map { |entry, _| entry.actions })
    journal_dirty = true if journal.pending.size != pending_before
    save(path, journal) if journal_dirty

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
