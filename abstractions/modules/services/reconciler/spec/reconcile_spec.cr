# Owns journal state-machine checks at the reconciliation boundary.
# Given generations, legacy journals and injected failures, callers observe no
# takeover, retryable intent, GUI deferral, disable preservation and rooted
# closures. These are repository-owned behaviors not covered by upstream's
# syscall/launchctl contracts. Filesystem outcomes and fake ctl calls are the
# stable observables; flock itself and launchd semantics are trusted upstream.
require "spec"
require "../reconciler"

class FakeCtl
  getter jobs = Set(Tuple(String, String)).new
  property gui = false
  property user = true
  property disable = false
  property fail : String? = nil
  getter bootstraps = 0
  getter restarts = 0
  getter bootouts = 0

  def available(domain)
    domain.starts_with?("gui") ? gui : user
  end

  def loaded(domain, label, path)
    jobs.includes?({domain, label})
  end

  def disabled(domain, label)
    inject("disabled")
    disable
  end

  def inject(operation)
    raise "injected #{operation}" if fail == operation
  end

  def bootout(domain, label)
    inject("bootout")
    jobs.delete({domain, label})
    @bootouts += 1
  end

  def bootstrap(domain, path)
    inject("bootstrap")
    jobs.add({domain, path.basename(".plist")})
    @bootstraps += 1
  end

  def restart(domain, label)
    inject("restart")
    @restarts += 1
  end
end

class Diagnostic < HjemServices::Launchctl
  property output = ""
  property success = true
  property domain_available = true

  def run(args : Array(String), check = false) : Result
    ok = args == ["print", "user/1"] ? domain_available : success
    raise "diagnostic failed" if check && !ok
    Result.new(output, "diagnostic failed", ok)
  end
end

class CaseInsensitiveFiles < HjemServices::Files
  def physical(path : Path) : Path
    if path.parent.basename == "LaunchAgents" && path.extension == ".plist"
      path.parent / path.basename.downcase
    else
      path
    end
  end
end

# Inject only at our atomic-write boundary, not a general filesystem framework.
class FailingFiles < HjemServices::Files
  property fail_at = 0
  getter writes = 0

  def atomic(path : Path, data : String)
    @writes += 1
    raise "injected write" if writes == fail_at
    super
  end
end

class Fixture
  getter tmp = Path[File.tempname("hjem-spec", nil, dir: File.realpath(Dir.tempdir))]
  getter ctl = FakeCtl.new
  getter home : Path
  getter store : String
  property files : HjemServices::Files = HjemServices::Files.new

  def initialize
    Dir.mkdir(tmp)
    @home = tmp / "home"
    @store = (tmp / "nix-store").to_s
    File.write(store, "#!/bin/sh\nln -sfn \"$5\" \"$2\"\n")
    File.chmod(store, 0o755)
  end

  def state
    home / ".local/state/hjem/services"
  end

  def target(label = "org.hjem.test")
    files.physical(home / "Library/LaunchAgents" / (label + ".plist"))
  end

  def job(label = "org.hjem.test", domain = "user", restart = false, run_at_load = false, name = "test")
    {"name" => name, "label" => label, "domain" => domain, "restart" => restart, "runAtLoad" => run_at_load}
  end

  def generation(n, jobs = [job])
    path = tmp / "generation-#{n}"
    Dir.mkdir_p(path / "plists")
    File.write(path / "services.json", jobs.to_json)
    jobs.each do |job|
      File.write(path / "plists" / (job["label"].as(String) + ".plist"), n.to_s)
    end
    path
  end

  def apply(path)
    HjemServices.reconcile(path, home, store, ctl, files)
  end

  def roots
    Dir.glob((state / "root-*").to_s).map { |p| Path[File.realpath(p)] }.to_set
  end

  def records
    JSON.parse(File.read(state / "state.json")).as_a
  end

  def seed(path, remove : Bool, retired : Bool? = nil)
    Dir.mkdir_p(state)
    Dir.mkdir_p(target.parent)
    # Literal legacy writer schema, including interrupted ownership before copy,
    # removal intent before/after unlink, and retired GUI tombstones.
    wire = %({"name":"test","label":"org.hjem.test","domain":"user","content":"1","root":#{(state / ("root-" + path.basename)).to_s.to_json},"restart":false,"runAtLoad":false,"remove":#{remove}#{retired.nil? ? "" : ",\"retired\":#{retired}"}})
    File.write(state / "state.json", "[#{wire}]")
    File.symlink(path, state / ("root-" + path.basename))
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

describe HjemServices::Launchctl do
  it "parses boolean and named disable tokens without matching other labels" do
    ctl = Diagnostic.new
    {"true", "disabled", "false", "enabled"}.each do |token|
      ctl.output = "disabled = {\n  \"org.test\" => #{token}\n}\n"
      ctl.disabled("user/1", "org.test").should eq({"true", "disabled"}.includes?(token))
    end
    ctl.output = "\"org.test.other\" => disabled\n\"orgXtest\" => disabled\n"
    ctl.disabled("user/1", "org.test").should be_false
    ctl.success = false
    expect_raises(Exception, /diagnostic failed/) { ctl.disabled("user/1", "org.test") }
  end

  it "requires exactly the owned path in multiline print diagnostics" do
    ctl = Diagnostic.new
    path = Path["/home/agent.plist"]
    ctl.output = "job = {\n path = /home/agent.plist\n state = running\n}\n"
    ctl.loaded("user/1", "org.test", path).should be_true
    {"job = {\n path = /foreign/agent.plist\n}\n", "job = {}", "path = /home/agent.plist\npath = /home/agent.plist\n"}.each do |output|
      ctl.output = output
      expect_raises(Exception, /ambiguous/) { ctl.loaded("user/1", "org.test", path) }
    end
    ctl.success = false
    ctl.loaded("user/1", "org.test", path).should be_false
    ctl.domain_available = false
    expect_raises(Exception, /Cannot inspect/) { ctl.loaded("user/1", "org.test", path) }
  end
end

describe "journal reconciliation" do
  it "retries missing jobs, keeps failed roots, repeats restart and respects disable" do
    fixture do |f|
      one = f.generation(1)
      f.apply(one)
      f.apply(one)
      f.ctl.bootstraps.should eq(1)
      f.ctl.restarts.should eq(0)
      f.ctl.jobs.clear
      f.apply(one)
      f.ctl.bootstraps.should eq(2)
      two = f.generation(2, [f.job(restart: true)])
      f.ctl.fail = "bootstrap"
      expect_raises(Exception, /injected/) { f.apply(two) }
      f.roots.should eq(Set{one, two})
      f.ctl.fail = nil
      f.apply(two)
      f.apply(two)
      f.roots.should eq(Set{two})
      f.ctl.restarts.should eq(2)
      f.ctl.disable = true
      f.ctl.jobs.clear
      f.apply(two)
      f.ctl.jobs.should be_empty
      f.ctl.restarts.should eq(2)
      File.info(f.target).permissions.value.should eq(0o600)
      File.info(f.state).permissions.value.should eq(0o700)
    end
  end

  it "defers GUI registration, update and removal; rejects files after removal" do
    fixture do |f|
      one = f.generation(1)
      f.apply(one)
      gui = f.generation(3, [f.job(domain: "gui")])
      f.apply(gui)
      f.ctl.jobs.should be_empty
      File.read(f.target).should eq("3")
      f.ctl.gui = true
      f.apply(gui)
      f.ctl.jobs.size.should eq(1)
      f.ctl.gui = false
      update = f.generation(5, [f.job(domain: "gui")])
      f.apply(update)
      File.read(f.target).should eq("5")
      empty = f.generation(4, [] of Hash(String, String | Bool))
      f.apply(empty)
      File.exists?(f.target).should be_false
      File.read(f.state / "state.json").should contain("generation-3")
      f.roots.should eq(Set{gui, update, empty})
      File.write(f.target, "unmanaged after removal")
      expect_raises(Exception, /after managed removal/) { f.apply(empty) }
      File.read(f.target).should eq("unmanaged after removal")
      File.delete(f.target)
      f.ctl.gui = true
      f.apply(empty)
      f.ctl.jobs.should be_empty
      f.records.should be_empty
      f.roots.should eq(Set{empty})
    end
  end

  it "rejects unmanaged files, edited ownership and jobs in the other domain before mutation" do
    fixture do |f|
      one = f.generation(1)
      empty = f.generation(2, [] of Hash(String, String | Bool))
      Dir.mkdir_p(f.target.parent)
      File.write(f.target, "unmanaged")
      expect_raises(Exception, /unmanaged file/) { f.apply(one) }
      File.read(f.target).should eq("unmanaged")
      File.delete(f.target)
      f.apply(one)
      File.write(f.target, "manual edit")
      before = f.ctl.jobs.dup
      expect_raises(Exception, /modified\/unmanaged/) { f.apply(empty) }
      f.ctl.jobs.should eq(before)
      File.read(f.target).should eq("manual edit")
      File.delete(f.target)
      f.apply(empty)
      f.ctl.gui = true
      f.ctl.jobs.add({"gui/#{LibC.getuid}", "org.hjem.test"})
      expect_raises(Exception, /unmanaged job/) { f.apply(one) }
      File.exists?(f.target).should be_false
    end
  end

  it "preserves active case aliases beside retired GUI identities across retry" do
    fixture do |f|
      f.files = CaseInsensitiveFiles.new
      f.ctl.gui = true
      old = f.generation(6, [f.job("Org.Test", "gui")])
      new = f.generation(7, [f.job("org.test")])
      f.apply(old)
      f.ctl.gui = false
      f.apply(new)
      File.read(f.target("Org.Test")).should eq("7")
      f.apply(new)
      File.write(f.target("org.test"), "manual case-alias edit")
      f.ctl.gui = true
      before = f.ctl.jobs.dup
      expect_raises(Exception, /modified\/unmanaged/) { f.apply(new) }
      f.ctl.jobs.should eq(before)
      File.read(f.target("org.test")).should eq("manual case-alias edit")
      File.write(f.target("org.test"), "7")
      f.apply(new)
      f.ctl.jobs.should eq(Set{ {"user/#{LibC.getuid}", "org.test"} })
      File.read(f.target("org.test")).should eq("7")
      f.records.size.should eq(1)
      f.roots.should eq(Set{new})
      f.apply(f.generation(8, [] of Hash(String, String | Bool)))
      f.ctl.jobs.should be_empty
      File.exists?(f.target("Org.Test")).should be_false
      File.exists?(f.target("org.test")).should be_false
    end
  end

  it "avoids a duplicate RunAtLoad start only immediately after bootstrap" do
    fixture do |f|
      jobs = [f.job(restart: true, run_at_load: true)]
      one = f.generation(1, jobs)
      f.apply(one)
      f.ctl.bootstraps.should eq(1)
      f.ctl.restarts.should eq(0)
      f.apply(one)
      f.ctl.restarts.should eq(1)
      f.apply(f.generation(2, jobs))
      f.ctl.bootstraps.should eq(2)
      f.ctl.restarts.should eq(1)
      f.ctl.jobs.clear
      f.apply(f.generation(3, [f.job(restart: true)]))
      f.ctl.bootstraps.should eq(3)
      f.ctl.restarts.should eq(2)
    end
  end

  it "reads legacy intents without runAtLoad and uses the desired startup policy" do
    # Owned before/after installation; Removing before/after unlink; Retired
    # before identity cleanup. A failed journal save after unlink leaves Removing.
    { {false, nil, false}, {false, nil, true}, {true, nil, true}, {true, nil, false}, {true, true, false} }.each do |remove, retired, installed|
      fixture do |f|
        one = f.generation(1, [f.job(restart: true, run_at_load: true)])
        f.seed(one, remove, retired)
        legacy = f.records
        legacy[0].as_h.delete("runAtLoad")
        File.write(f.state / "state.json", legacy.to_json)
        File.write(f.target, "1") if installed
        f.apply(one)
        File.read(f.target).should eq("1")
        f.ctl.jobs.should eq(Set{ {"user/#{LibC.getuid}", "org.hjem.test"} })
        f.records.size.should eq(1)
        f.records[0]["remove"].as_bool.should be_false
        f.records[0]["runAtLoad"].as_bool.should be_true
        f.ctl.restarts.should eq(0)
        f.records[0]["root"].as_s.should eq((f.state / "root-generation-1").to_s)
      end
    end
  end

  it "preserves and later retires a deferred GUI journal without runAtLoad" do
    fixture do |f|
      one = f.generation(1)
      f.seed(one, true, true)
      legacy = f.records
      legacy[0].as_h.delete("runAtLoad")
      legacy[0].as_h["domain"] = JSON::Any.new("gui")
      File.write(f.state / "state.json", legacy.to_json)
      f.ctl.jobs.add({"gui/#{LibC.getuid}", "org.hjem.test"})
      empty = f.generation(2, [] of Hash(String, String | Bool))
      f.apply(empty)
      f.records[0]["retired"].as_bool.should be_true
      f.records[0]["runAtLoad"].as_bool.should be_false
      f.roots.should eq(Set{one, empty})
      f.apply(empty)
      f.ctl.gui = true
      f.apply(empty)
      f.records.should be_empty
      f.ctl.jobs.should be_empty
      f.roots.should eq(Set{empty})
    end
  end

  it "rejects invalid wire states instead of silently forgetting retired ownership" do
    fixture do |f|
      one = f.generation(1)
      f.seed(one, false, true)
      expect_raises(Exception, /Invalid retired/) { f.apply(one) }
      f.ctl.jobs.should be_empty
    end
  end

  it "retains prior roots and successful jobs when bootout or restart fails" do
    {"bootout", "restart", "disabled"}.each do |failure|
      fixture do |f|
        one = f.generation(1)
        f.apply(one)
        two = f.generation(2, [f.job(restart: true)])
        f.ctl.fail = failure
        expect_raises(Exception, /injected/) { f.apply(two) }
        f.roots.should eq(Set{one, two})
        if failure == "bootout"
          File.read(f.target).should eq("1")
          f.records[0]["remove"].as_bool.should be_true
        else
          File.read(f.target).should eq("2")
        end
        f.ctl.fail = nil
        f.apply(two)
        f.roots.should eq(Set{two})
        f.ctl.jobs.size.should eq(1)
      end
    end
  end

  it "recovers after each journal/install write boundary with intent before copy" do
    # Initial save, ownership save, plist installation, final save. Replacement
    # also saves removal intent, retired state, deletion and new ownership.
    {false, true}.each do |replacement|
      (1..(replacement ? 6 : 4)).each do |boundary|
        fixture do |f|
          one = f.generation(1)
          f.apply(one) if replacement
          desired = replacement ? f.generation(2) : one
          files = FailingFiles.new
          files.fail_at = boundary
          f.files = files
          expect_raises(Exception, /injected write/) { f.apply(desired) }
          # If a plist exists it always has a persisted, non-retired owner.
          if File.exists?(f.target)
            f.records.any? { |r| r["content"].as_s == File.read(f.target) && r["retired"]?.try(&.as_bool) != true }.should be_true
          end
          f.files = HjemServices::Files.new
          f.apply(desired)
          File.read(f.target).should eq(replacement ? "2" : "1")
          f.roots.should eq(Set{desired})
          f.ctl.jobs.size.should eq(1)
        end
      end
    end
  end

  it "keeps the old generation rooted when an unchanged job's final update save fails" do
    fixture do |f|
      one = f.generation(1, [f.job(restart: true)])
      f.apply(one)
      two = f.generation(2, [f.job(restart: true)])
      File.write(two / "plists/org.hjem.test.plist", "1")
      files = FailingFiles.new
      files.fail_at = 2
      f.files = files
      expect_raises(Exception, /injected write/) { f.apply(two) }
      f.ctl.restarts.should eq(2)
      f.records[0]["root"].as_s.should eq((f.state / "root-generation-1").to_s)
      f.roots.should eq(Set{one, two})
      f.files = HjemServices::Files.new
      f.apply(two)
      f.ctl.restarts.should eq(3)
      f.roots.should eq(Set{two})
    end
  end

  it "fails unavailable user domains but defers unavailable GUI domains" do
    fixture do |f|
      one = f.generation(1)
      f.ctl.user = false
      expect_raises(Exception, /Unavailable user/) { f.apply(one) }
      File.exists?(f.target).should be_false
      f.roots.should eq(Set{one})
      f.ctl.user = true
      f.apply(one)
      empty = f.generation(2, [] of Hash(String, String | Bool))
      f.ctl.user = false
      expect_raises(Exception, /Unavailable user/) { f.apply(empty) }
      f.records[0]["retired"].as_bool.should be_true
      f.roots.should eq(Set{one, empty})
      f.ctl.user = true
      f.apply(empty)
      f.records.should be_empty
    end
  end

  it "rejects symlinked owned directories, lock, journal, plist and foreign roots" do
    {"directory", "lock", "journal", "plist", "root"}.each do |kind|
      fixture do |f|
        one = f.generation(1)
        Dir.mkdir_p(f.state)
        Dir.mkdir_p(f.target.parent)
        foreign = f.tmp / "foreign"
        File.write(foreign, "foreign")
        case kind
        when "directory"
          FileUtils.rm_rf(f.state)
          Dir.mkdir(f.tmp / "foreign-dir")
          File.symlink(f.tmp / "foreign-dir", f.state)
        when "lock"
          File.symlink(foreign, f.state / "lock")
        when "journal"
          File.symlink(foreign, f.state / "state.json")
        when "plist"
          File.symlink(foreign, f.target)
        when "root"
          File.symlink(foreign, f.state / "root-generation-1")
        end
        expect_raises(Exception, /Unsafe|Unexpected|unmanaged/) { f.apply(one) }
        File.read(foreign).should eq("foreign")
        f.ctl.jobs.should be_empty
      end
    end
  end

  it "does not publish ownership or prune roots on nix-store failure" do
    fixture do |f|
      one = f.generation(1)
      f.apply(one)
      two = f.generation(2)
      before = File.read(f.state / "state.json")
      File.write(f.store, "#!/bin/sh\nexit 1\n")
      expect_raises(Exception, /nix-store failed/) { f.apply(two) }
      File.read(f.state / "state.json").should eq(before)
      File.read(f.target).should eq("1")
      f.roots.should eq(Set{one})
    end
  end
end
