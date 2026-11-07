# Owns journal state-machine checks at the reconciliation boundary.
# Given generations, edits made elsewhere and injected failures, callers observe
# recorded previous values, restoration, write-ahead pending actions and their
# retry or deferral. Preference values and actions are faked; CFPreferences
# storage, killall and launchd semantics are trusted upstream. The plist
# document boundary is exercised against CoreFoundation without preferences.
require "spec"
require "file_utils"
require "../reconciler"

# A leaf is its XML document; a dictionary maps keys to nodes.
alias Node = String | Hash(String, Node)

def tree(**entries) : Node
  entries.to_h.transform_keys(&.to_s).transform_values(&.as(Node)).as(Node)
end

# Keyed by domain and first key, with the semantics of HjemDefaults::Preferences.
class FakePreferences
  getter values = {} of Tuple(String, String) => Node
  getter writes = [] of Tuple(String, Array(String), String?)
  getter syncs = [] of String
  property fail_write = false

  # The enclosing nodes from the first key's value down to the leaf's parent,
  # ending early where one is absent.
  private def chain(domain, path) : Array(Node?)
    nodes = [values[{domain, path.first}]?] of Node?
    path[1..].each_with_index do |key, i|
      node = nodes.last
      return nodes if node.nil?
      raise HjemDefaults::Blocked.new(path[0..i]) unless node.is_a?(Hash)
      nodes << node[key]? unless i == path.size - 2
    end
    nodes
  end

  private def leaf(domain, path) : Node?
    parent = chain(domain, path).last
    return parent if path.size == 1 || parent.nil?
    raise HjemDefaults::Blocked.new(path[0..-2]) unless parent.is_a?(Hash)
    parent[path.last]?
  end

  def read(domain, path)
    leaf(domain, path).as(String?)
  end

  def blocked?(domain, path)
    leaf(domain, path)
    false
  rescue HjemDefaults::Blocked
    true
  end

  def present(domain, path)
    chain(domain, path).count { |node| !node.nil? }
  end

  def matches?(domain, path, xml)
    leaf(domain, path) == xml
  rescue HjemDefaults::Blocked
    false
  end

  def write(domain, path, xml)
    raise "injected write" if fail_write
    leaf(domain, path)
    writes << {domain, path, xml}
    if path.size == 1
      values[{domain, path.first}] = xml
      return
    end
    node = (values[{domain, path.first}] ||= {} of String => Node).as(Hash)
    path[1...-1].each { |key| node = (node[key] ||= {} of String => Node).as(Hash) }
    node[path.last] = xml
  end

  def remove(domain, path, keep)
    raise "injected write" if fail_write
    writes << {domain, path, nil}
    nodes = chain(domain, path)
    if path.size == 1
      values.delete({domain, path.first})
      return
    end
    return if nodes.last.nil?
    nodes.last.as(Hash).delete(path.last)
    (nodes.size - 1).downto(keep) do |level|
      break unless nodes[level].as(Hash).empty?
      if level == 0
        values.delete({domain, path.first})
      else
        nodes[level - 1].as(Hash).delete(path[level])
      end
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
  # Exit codes of the calls starting with each prefix; other calls succeed.
  property codes = {} of Array(String) => Int32

  def initialize
    super(RESTART)
  end

  def status(path : String, args : Array(String), quiet = false) : Int32
    call = [path] + args
    calls << call
    codes.find { |prefix, _| call[0, prefix.size] == prefix }.try(&.[1]) || 0
  end
end

RESTART = "/restart-service"
DOCK    = HjemDefaults::Action.new("process", "Dock")
TOOL    = HjemDefaults::Action.new("service", "tool")

class Fixture
  getter tmp = Path[File.tempname("hjem-defaults-spec", nil, dir: File.realpath(Dir.tempdir))]
  getter prefs = FakePreferences.new
  getter commands = FakeCommands.new
  getter home : Path

  def initialize
    Dir.mkdir(tmp)
    @home = tmp / "home"
  end

  # Declares single keys of each domain.
  def generation(n, domains)
    paths(n, domains.map { |domain, keys, actions| {domain, keys.transform_keys { |key| [key] }, actions} })
  end

  def paths(n, domains)
    path = tmp / "generation-#{n}"
    Dir.mkdir_p(path)
    File.write(path / "defaults.json", domains.map { |domain, leaves, actions|
      {"domain" => domain, "values" => leaves.map { |p, xml| {"path" => p, "xml" => xml} }, "actions" => actions}
    }.to_json)
    path
  end

  def state
    home / ".local/state/hjem/defaults/state.json"
  end

  def apply(path)
    HjemDefaults.reconcile(path, home, prefs, commands)
  end

  def journal
    HjemDefaults::Journal.from_json(File.read(state))
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
      f.journal.keys.map { |o| {o.path, o.original} }.to_set.should eq(Set{ {["kept"], "old"}, {["added"], nil} })
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

  it "writes leaves into dictionaries and removes only the dictionaries it created" do
    fixture do |f|
      f.prefs.values[{"com.test", "keys"}] = tree("32": "kept")
      one = f.paths(1, [{"com.test", {["keys", "64", "enabled"] => "off", ["new", "a", "b"] => "x"}, [DOCK]}])
      f.apply(one)
      f.prefs.values.should eq({
        {"com.test", "keys"} => tree("32": "kept", "64": tree(enabled: "off")),
        {"com.test", "new"}  => tree(a: tree(b: "x")),
      })
      f.journal.keys.map { |o| {o.path, o.present} }.to_set.should eq(Set{ {["keys", "64", "enabled"], 1}, {["new", "a", "b"], 0} })
      f.apply(one)
      f.prefs.writes.size.should eq(2)
      f.apply(f.paths(2, [] of Tuple(String, Hash(Array(String), String), Array(HjemDefaults::Action))))
      f.prefs.values.should eq({ {"com.test", "keys"} => tree("32": "kept") })
      f.commands.performed.should eq([DOCK, DOCK])
    end
  end

  it "fails before writing when a value along a declared path is not a dictionary" do
    fixture do |f|
      f.prefs.values[{"com.test", "scalar"}] = "x"
      one = f.paths(1, [{"com.test", {["fine"] => "1", ["scalar", "a"] => "2"}, [DOCK]}])
      expect_raises(Exception, /Not a dictionary along com.test \["scalar","a"\]/) { f.apply(one) }
      f.prefs.writes.should be_empty
      File.exists?(f.state).should be_false
    end
  end

  it "restores an overlapping removed path before recording the declared one" do
    fixture do |f|
      f.apply(f.paths(1, [{"com.test", {["a", "b"] => "1"}, [DOCK]}]))
      f.apply(f.paths(2, [{"com.test", {["a", "b", "c"] => "2"}, [DOCK]}]))
      f.prefs.values.should eq({ {"com.test", "a"} => tree(b: tree(c: "2")) })
      f.journal.keys.map { |o| {o.path, o.original, o.present} }.should eq([{["a", "b", "c"], nil, 0}])
      f.apply(f.paths(3, [{"com.test", {["a"] => "3"}, [DOCK]}]))
      f.prefs.values.should eq({ {"com.test", "a"} => "3" })
      f.journal.keys.map { |o| {o.path, o.original} }.should eq([{["a"], nil}])
      f.apply(f.paths(4, [] of Tuple(String, Hash(Array(String), String), Array(HjemDefaults::Action))))
      f.prefs.values.should be_empty
    end
  end

  it "ends ownership without restoring when an enclosing value is no longer a dictionary" do
    fixture do |f|
      f.apply(f.paths(1, [{"com.test", {["a", "b"] => "1"}, [DOCK]}]))
      f.prefs.values[{"com.test", "a"}] = "replaced"
      f.apply(f.paths(2, [] of Tuple(String, Hash(Array(String), String), Array(HjemDefaults::Action))))
      f.prefs.values.should eq({ {"com.test", "a"} => "replaced" })
      f.journal.keys.should be_empty
      f.commands.performed.should eq([DOCK])
    end
  end

  it "reads entries of an earlier journal that name a single key" do
    fixture do |f|
      Dir.mkdir_p(f.state.parent)
      File.write(f.state, %({"keys":[{"domain":"com.test","key":"k","original":"before","actions":[]}],"pending":[]}))
      f.prefs.values[{"com.test", "k"}] = "declared"
      f.apply(f.generation(1, [{"com.test", {"k" => "declared"}, [DOCK]}]))
      f.prefs.writes.should be_empty
      f.journal.keys.map { |o| {o.path, o.original} }.should eq([{["k"], "before"}])
      File.read(f.state).should_not contain(%("key"))
      f.apply(f.generation(2, [] of Tuple(String, Hash(String, String), Array(HjemDefaults::Action))))
      f.prefs.values.should eq({ {"com.test", "k"} => "before" })
    end
  end
end

describe HjemDefaults::Commands do
  it "restarts services through the restart command, deferring while the service manager is not running" do
    commands = ScriptedCommands.new
    commands.perform(TOOL).should eq(HjemDefaults::Outcome::Done)
    commands.calls.should eq([[RESTART, "tool"]])

    commands.codes = {[RESTART] => HjemDefaults::Commands::DEFERRED}
    commands.perform(TOOL).should eq(HjemDefaults::Outcome::Deferred)

    commands.codes = {[RESTART] => 1}
    expect_raises(Exception, /Restart failed: tool/) { commands.perform(TOOL) }
  end

  it "ignores processes that are not running and reports failed activation" do
    commands = ScriptedCommands.new
    commands.codes = {["/usr/bin/killall"] => 1, [HjemDefaults::ACTIVATE_SETTINGS] => 1}
    commands.perform(DOCK).should eq(HjemDefaults::Outcome::Done)
    expect_raises(Exception, /activateSettings failed/) { commands.perform(HjemDefaults::Action.new("activateSettings", "")) }
    expect_raises(Exception, /Unknown action/) { commands.perform(HjemDefaults::Action.new("other", "")) }
  end
end

describe HjemDefaults::Plist do
  it "round-trips documents of every accepted value type" do
    # Literal lib/plist.nix toPlist output.
    xml = %(<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>A&amp;B</key><dict><key>nested</key><array><string>&lt;v&gt;</string><false/></array></dict><key>n</key><integer>-1</integer><key>r</key><real>1e-07</real><key>t</key><true/></dict></plist>
)
    HjemDefaults::Plist.parse(xml) do |value|
      HjemDefaults::Plist.parse(HjemDefaults::Plist.xml(value)) do |again|
        LibCF.CFEqual(value, again).should eq(1)
      end
    end
    # The shortest round-trip form of a float parses to the same value as its full digits.
    {"1e-07" => "0.0000001", "0.30000000000000004" => "0.300000000000000044408920985006"}.each do |short, full|
      HjemDefaults::Plist.parse(%(<plist version="1.0"><real>#{short}</real></plist>)) do |a|
        HjemDefaults::Plist.parse(%(<plist version="1.0"><real>#{full}</real></plist>)) do |b|
          LibCF.CFEqual(a, b).should eq(1)
        end
      end
    end
    expect_raises(Exception, /Invalid plist/) { HjemDefaults::Plist.parse("not a plist") { } }
  end

  it "sets and removes leaves at key paths" do
    xml = ->(body : String) { %(<?xml version="1.0" encoding="UTF-8"?><plist version="1.0">#{body}</plist>) }
    HjemDefaults::Plist.parse(xml.call("<dict><key>32</key><true/><key>s</key><string>x</string></dict>")) do |top|
      HjemDefaults::Plist.parse(xml.call("<false/>")) do |leaf|
        HjemDefaults::Plist.present(top, ["k", "64", "enabled"]).should eq(1)
        HjemDefaults::Plist.owning(HjemDefaults::Plist.set(top, ["k", "64", "enabled"], leaf)) do |set|
          HjemDefaults::Plist.parse(xml.call("<dict><key>32</key><true/><key>s</key><string>x</string><key>64</key><dict><key>enabled</key><false/></dict></dict>")) do |expected|
            LibCF.CFEqual(set, expected).should eq(1)
          end
          LibCF.CFEqual(HjemDefaults::Plist.at(set, ["k", "64", "enabled"]), leaf).should eq(1)
          HjemDefaults::Plist.owning(HjemDefaults::Plist.remove(set, ["k", "64", "enabled"], 1)) do |removed|
            LibCF.CFEqual(removed, top).should eq(1)
          end
          HjemDefaults::Plist.owning(HjemDefaults::Plist.remove(set, ["k", "64", "enabled"], 2)) do |kept|
            HjemDefaults::Plist.at(kept, ["k", "64"]).null?.should be_false
          end
        end
        expect_raises(HjemDefaults::Blocked, /\["k","s"\] is not a dictionary/) { HjemDefaults::Plist.set(top, ["k", "s", "a"], leaf) }
        HjemDefaults::Plist.owning(HjemDefaults::Plist.set(LibCF::Ref.null, ["k", "a", "b"], leaf)) do |created|
          HjemDefaults::Plist.remove(created, ["k", "a", "b"], 0).null?.should be_true
        end
      end
    end
  end
end
