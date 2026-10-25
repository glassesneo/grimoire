# Owns journal state-machine checks at the reconciliation boundary.
# Given generations, edits made elsewhere and injected failures, callers observe
# recorded previous values, restoration, write-ahead pending actions and their
# retry or deferral. Preference values and actions are faked; CFPreferences
# storage, killall and launchd semantics are trusted upstream. The plist
# document boundary is exercised against CoreFoundation without preferences.
require "spec"
require "file_utils"
require "../reconciler"

class FakePreferences
  getter values = {} of Tuple(String, String) => String
  getter writes = [] of Tuple(String, String, String?)
  getter syncs = [] of String
  property fail_write = false

  def read(domain, key)
    values[{domain, key}]?
  end

  def matches?(domain, key, xml)
    values[{domain, key}]? == xml
  end

  def write(domain, key, xml)
    raise "injected write" if fail_write
    writes << {domain, key, xml}
    if xml
      values[{domain, key}] = xml
    else
      values.delete({domain, key})
    end
  end

  def sync(domain)
    syncs << domain
  end
end

class FakeCommands
  getter performed = [] of HjemDefaults::Action
  property defer = false
  property fail = false

  def perform(action)
    raise "injected action" if fail
    return HjemDefaults::Outcome::Deferred if defer && action.kind == "service"
    performed << action
    HjemDefaults::Outcome::Done
  end
end

# Scripts the external commands of the real action runner.
class ScriptedCommands < HjemDefaults::Commands
  getter calls = [] of Array(String)
  property failing = [] of Array(String)

  def run(path : String, args : Array(String), quiet = false) : Bool
    call = [path] + args
    calls << call
    !failing.any? { |prefix| call[0, prefix.size] == prefix }
  end
end

DOCK   = HjemDefaults::Action.new("process", "Dock")
TOOL   = HjemDefaults::Action.new("service", "gui/org.test")
UID    = LibC.getuid
DOMAIN = "gui/#{UID}"

class Fixture
  getter tmp = Path[File.tempname("hjem-defaults-spec", nil, dir: File.realpath(Dir.tempdir))]
  getter prefs = FakePreferences.new
  getter commands = FakeCommands.new
  getter home : Path

  def initialize
    Dir.mkdir(tmp)
    @home = tmp / "home"
  end

  def generation(n, domains)
    path = tmp / "generation-#{n}"
    Dir.mkdir_p(path)
    File.write(path / "defaults.json", domains.map { |domain, keys, actions|
      {"domain" => domain, "keys" => keys, "actions" => actions}
    }.to_json)
    path
  end

  def apply(path)
    HjemDefaults.reconcile(path, home, prefs, commands)
  end

  def journal
    HjemDefaults::Journal.from_json(File.read(home / ".local/state/hjem/defaults/state.json"))
  end

  def close
    FileUtils.rm_rf(tmp)
  end
end

def fixture(&)
  f = Fixture.new
  begin
    yield f
  ensure
    f.close
  end
end

describe "journal reconciliation" do
  it "records previous values, writes only differences and acts once per change" do
    fixture do |f|
      f.prefs.values[{"com.test", "kept"}] = "old"
      one = f.generation(1, [{"com.test", {"kept" => "new", "added" => "1"}, [DOCK]}])
      f.apply(one)
      f.prefs.values.should eq({ {"com.test", "kept"} => "new", {"com.test", "added"} => "1" })
      f.journal.keys.map { |o| {o.key, o.original} }.to_set.should eq(Set{ {"kept", "old"}, {"added", nil} })
      f.commands.performed.should eq([DOCK])
      f.journal.pending.should be_empty
      f.prefs.syncs.should eq(["com.test"])
      f.apply(one)
      f.prefs.writes.size.should eq(2)
      f.commands.performed.size.should eq(1)
      File.info(f.home / ".local/state/hjem/defaults").permissions.value.should eq(0o700)
    end
  end

  it "overwrites values changed elsewhere and keeps the first recorded value" do
    fixture do |f|
      one = f.generation(1, [{"com.test", {"key" => "declared"}, [DOCK]}])
      f.apply(one)
      f.prefs.values[{"com.test", "key"}] = "edited"
      f.apply(one)
      f.prefs.values[{"com.test", "key"}].should eq("declared")
      f.commands.performed.should eq([DOCK, DOCK])
      f.journal.keys.first.original.should be_nil
    end
  end

  it "restores recorded values on removal and acts only when the restore changes a value" do
    fixture do |f|
      f.prefs.values[{"com.test", "present"}] = "before"
      one = f.generation(1, [{"com.test", {"present" => "declared", "absent" => "declared"}, [DOCK]}])
      f.apply(one)
      empty = f.generation(2, [] of Tuple(String, Hash(String, String), Array(HjemDefaults::Action)))
      f.apply(empty)
      f.prefs.values.should eq({ {"com.test", "present"} => "before" })
      f.commands.performed.should eq([DOCK, DOCK])
      f.journal.keys.should be_empty

      # A value already declared is recorded as its own previous value, so
      # neither declaring nor removing it changes anything.
      f.prefs.values[{"com.test", "present"}] = "declared"
      same = f.generation(3, [{"com.test", {"present" => "declared"}, [DOCK]}])
      f.apply(same)
      f.apply(empty)
      f.commands.performed.size.should eq(2)
      f.prefs.writes.size.should eq(4)
      f.prefs.values.should eq({ {"com.test", "present"} => "declared" })
    end
  end

  it "keeps the previous value recorded before a failed write" do
    fixture do |f|
      f.prefs.values[{"com.test", "key"}] = "before"
      one = f.generation(1, [{"com.test", {"key" => "declared"}, [DOCK]}])
      f.prefs.fail_write = true
      expect_raises(Exception, /injected write/) { f.apply(one) }
      f.journal.keys.first.original.should eq("before")
      f.journal.pending.should eq([DOCK])
      f.prefs.fail_write = false
      f.apply(one)
      f.journal.keys.first.original.should eq("before")
      f.commands.performed.should eq([DOCK])
      f.apply(f.generation(2, [] of Tuple(String, Hash(String, String), Array(HjemDefaults::Action))))
      f.prefs.values[{"com.test", "key"}].should eq("before")
    end
  end

  it "retries failed and deferred actions, including those of removed declarations" do
    fixture do |f|
      one = f.generation(1, [{"com.test", {"key" => "declared"}, [DOCK, TOOL]}])
      f.commands.fail = true
      expect_raises(Exception, /injected action/) { f.apply(one) }
      f.prefs.values[{"com.test", "key"}].should eq("declared")
      f.journal.pending.should eq([DOCK, TOOL])
      f.commands.fail = false
      f.commands.defer = true
      f.apply(f.generation(2, [] of Tuple(String, Hash(String, String), Array(HjemDefaults::Action))))
      f.prefs.values.should be_empty
      f.journal.keys.should be_empty
      f.journal.pending.should eq([TOOL])
      f.commands.defer = false
      f.apply(f.generation(3, [] of Tuple(String, Hash(String, String), Array(HjemDefaults::Action))))
      f.journal.pending.should be_empty
      f.commands.performed.should eq([DOCK, TOOL])
    end
  end
end

describe HjemDefaults::Commands do
  it "restarts loaded services, skips unloaded ones and defers without a GUI session" do
    commands = ScriptedCommands.new
    commands.perform(TOOL).should eq(HjemDefaults::Outcome::Done)
    commands.calls.last.should eq(["/bin/launchctl", "kickstart", "-k", "#{DOMAIN}/org.test"])

    commands = ScriptedCommands.new
    commands.failing = [["/bin/launchctl", "print", "#{DOMAIN}/org.test"]]
    commands.perform(TOOL).should eq(HjemDefaults::Outcome::Done)
    commands.calls.none? { |call| call.includes?("kickstart") }.should be_true

    commands = ScriptedCommands.new
    commands.failing = [["/bin/launchctl", "print"]]
    commands.perform(TOOL).should eq(HjemDefaults::Outcome::Deferred)
    expect_raises(Exception, /Unavailable/) { commands.perform(HjemDefaults::Action.new("service", "user/org.test")) }
  end

  it "ignores processes that are not running and reports failed activation" do
    commands = ScriptedCommands.new
    commands.failing = [["/usr/bin/killall"], [HjemDefaults::ACTIVATE_SETTINGS]]
    commands.perform(DOCK).should eq(HjemDefaults::Outcome::Done)
    expect_raises(Exception, /activateSettings failed/) { commands.perform(HjemDefaults::Action.new("activateSettings", "")) }
    expect_raises(Exception, /Unknown action/) { commands.perform(HjemDefaults::Action.new("other", "")) }
  end
end

describe HjemDefaults::Plist do
  it "round-trips documents of every accepted value type" do
    # Literal lib.generators.toPlist {escape = true;} output.
    xml = %(<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>A&amp;B</key>
	<dict>
		<key>nested</key>
		<array>
			<string>&lt;v&gt;</string>
			<false/>
		</array>
	</dict>
	<key>n</key>
	<integer>-1</integer>
	<key>t</key>
	<true/>
</dict>
</plist>)
    HjemDefaults::Plist.parse(xml) do |value|
      HjemDefaults::Plist.parse(HjemDefaults::Plist.xml(value)) do |again|
        LibCF.CFEqual(value, again).should eq(1)
      end
    end
    expect_raises(Exception, /Invalid plist/) { HjemDefaults::Plist.parse("not a plist") { } }
  end
end
