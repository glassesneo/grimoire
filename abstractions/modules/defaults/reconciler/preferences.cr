# Owns the CFPreferences boundary: values of the current user on any host at
# key paths, exchanged as XML plist documents and compared by plist type and
# value. A path's first key names a key of the domain and later keys descend
# into dictionaries; a path is blocked when a value along it is not a
# dictionary. Writing a path creates the missing dictionaries along it and
# keeps their other keys. CFPreferences goes through cfprefsd, so values are
# never written to the preference files directly.
@[Link(framework: "CoreFoundation")]
lib LibCF
  alias Ref = Void*

  $kCFPreferencesCurrentUser : Ref
  $kCFPreferencesAnyHost : Ref
  $kCFPreferencesAnyApplication : Ref

  fun CFStringCreateWithBytes(alloc : Ref, bytes : UInt8*, length : LibC::Long, encoding : UInt32, external : UInt8) : Ref
  fun CFDataCreate(alloc : Ref, bytes : UInt8*, length : LibC::Long) : Ref
  fun CFDataGetBytePtr(data : Ref) : UInt8*
  fun CFDataGetLength(data : Ref) : LibC::Long
  fun CFPropertyListCreateWithData(alloc : Ref, data : Ref, options : LibC::ULong, format : Void*, error : Ref*) : Ref
  fun CFPropertyListCreateData(alloc : Ref, list : Ref, format : LibC::Long, options : LibC::ULong, error : Ref*) : Ref
  fun CFPropertyListCreateDeepCopy(alloc : Ref, list : Ref, options : LibC::ULong) : Ref
  fun CFGetTypeID(ref : Ref) : LibC::ULong
  fun CFDictionaryGetTypeID : LibC::ULong
  fun CFDictionaryGetCount(dict : Ref) : LibC::Long
  fun CFDictionaryGetValue(dict : Ref, key : Ref) : Ref
  fun CFDictionarySetValue(dict : Ref, key : Ref, value : Ref)
  fun CFDictionaryRemoveValue(dict : Ref, key : Ref)
  fun CFRetain(ref : Ref) : Ref
  fun CFPreferencesCopyValue(key : Ref, application : Ref, user : Ref, host : Ref) : Ref
  fun CFPreferencesSetValue(key : Ref, value : Ref, application : Ref, user : Ref, host : Ref)
  fun CFPreferencesSynchronize(application : Ref, user : Ref, host : Ref) : UInt8
  fun CFEqual(a : Ref, b : Ref) : UInt8
  fun CFRelease(ref : Ref)
end

module HjemDefaults
  # A value along the path, at `at`, is not a dictionary.
  class Blocked < Exception
    getter at : Array(String)

    def initialize(@at)
      super("#{at.to_json} is not a dictionary")
    end
  end

  module Plist
    UTF8              = 0x08000100_u32
    XMLFormat         =            100
    MutableContainers =          1_u64
    EMPTY             = %(<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>)

    # Yields a CF object and releases it afterwards; a null object is yielded as is.
    def self.owning(ref : LibCF::Ref, &)
      yield ref
    ensure
      LibCF.CFRelease(ref) unless ref.nil? || ref.null?
    end

    def self.string(value : String, &)
      owning(LibCF.CFStringCreateWithBytes(nil, value.to_unsafe, value.bytesize, UTF8, 0_u8)) do |ref|
        raise "Cannot encode #{value.inspect}" if ref.null?
        yield ref
      end
    end

    def self.parse(xml : String, options = 0_u64, &)
      owning(LibCF.CFDataCreate(nil, xml.to_unsafe, xml.bytesize)) do |data|
        # CoreFoundation sets the error only on failure, so it starts as null.
        error = LibCF::Ref.null
        owning(LibCF.CFPropertyListCreateWithData(nil, data, options, nil, pointerof(error))) do |value|
          LibCF.CFRelease(error) unless error.null?
          raise "Invalid plist document" if value.null?
          yield value
        end
      end
    end

    def self.xml(value : LibCF::Ref) : String
      error = LibCF::Ref.null
      owning(LibCF.CFPropertyListCreateData(nil, value, XMLFormat, 0, pointerof(error))) do |data|
        LibCF.CFRelease(error) unless error.null?
        raise "Cannot serialize a preference value" if data.null?
        String.new(Slice.new(LibCF.CFDataGetBytePtr(data), LibCF.CFDataGetLength(data)))
      end
    end

    def self.dictionary?(value : LibCF::Ref) : Bool
      LibCF.CFGetTypeID(value) == LibCF.CFDictionaryGetTypeID
    end

    def self.get(dict : LibCF::Ref, key : String) : LibCF::Ref
      string(key) { |name| LibCF.CFDictionaryGetValue(dict, name) }
    end

    # The values along a path that start at `top`, the value of its first key,
    # down to the leaf's parent; ends early, at a null, where one is absent.
    # Raises Blocked when a value along the path is not a dictionary.
    def self.chain(top : LibCF::Ref, path : Array(String)) : Array(LibCF::Ref)
      values = [top]
      path[1..].each_with_index do |key, i|
        value = values.last
        return values if value.null?
        raise Blocked.new(path[0..i]) unless dictionary?(value)
        values << get(value, key) unless i == path.size - 2
      end
      values
    end

    # The leaf value at the path, null when it is absent; borrowed from `top`.
    def self.at(top : LibCF::Ref, path : Array(String)) : LibCF::Ref
      parent = chain(top, path).last
      return parent if path.size == 1 || parent.null?
      raise Blocked.new(path[0..-2]) unless dictionary?(parent)
      get(parent, path.last)
    end

    # How many of the dictionaries enclosing the leaf are present.
    def self.present(top : LibCF::Ref, path : Array(String)) : Int32
      chain(top, path).count { |value| !value.null? }
    end

    # A new top value with the leaf at the path set to `leaf`; owned by the caller.
    def self.set(top : LibCF::Ref, path : Array(String), leaf : LibCF::Ref) : LibCF::Ref
      return LibCF.CFRetain(leaf) if path.size == 1
      at(top, path)
      root = top.null? ? empty : LibCF.CFPropertyListCreateDeepCopy(nil, top, MutableContainers)
      node = root
      path[1...-1].each do |key|
        child = get(node, key)
        if child.null?
          child = empty
          string(key) { |name| LibCF.CFDictionarySetValue(node, name, child) }
          LibCF.CFRelease(child)
        end
        node = child
      end
      string(path.last) { |name| LibCF.CFDictionarySetValue(node, name, leaf) }
      root
    end

    # A new top value without the leaf at the path, owned by the caller, or null
    # when the key itself goes. Enclosing dictionaries deeper than the first
    # `keep` are removed once empty.
    def self.remove(top : LibCF::Ref, path : Array(String), keep : Int32) : LibCF::Ref
      return LibCF::Ref.null if path.size == 1 || top.null?
      chain(top, path)
      root = LibCF.CFPropertyListCreateDeepCopy(nil, top, MutableContainers)
      chain = chain(root, path)
      return root if chain.size < path.size - 1 || chain.last.null?
      string(path.last) { |name| LibCF.CFDictionaryRemoveValue(chain.last, name) }
      (chain.size - 1).downto(keep) do |level|
        break unless LibCF.CFDictionaryGetCount(chain[level]) == 0
        if level == 0
          LibCF.CFRelease(root)
          return LibCF::Ref.null
        end
        string(path[level]) { |name| LibCF.CFDictionaryRemoveValue(chain[level - 1], name) }
      end
      root
    end

    private def self.empty : LibCF::Ref
      parse(EMPTY, MutableContainers) { |value| LibCF.CFRetain(value) }
    end
  end

  class Preferences
    # Plist XML of the leaf's value, or nil when it is absent; raises Blocked.
    def read(domain : String, path : Array(String)) : String?
      top(domain, path) do |_, top|
        leaf = Plist.at(top, path)
        leaf.null? ? nil : Plist.xml(leaf)
      end
    end

    def blocked?(domain : String, path : Array(String)) : Bool
      read(domain, path)
      false
    rescue Blocked
      true
    end

    # How many of the dictionaries enclosing the leaf are present.
    def present(domain : String, path : Array(String)) : Int32
      top(domain, path) { |_, top| Plist.present(top, path) }
    end

    # Whether the leaf holds the XML document's value, or is absent for nil;
    # false when the path is blocked.
    def matches?(domain : String, path : Array(String), xml : String?) : Bool
      top(domain, path) do |_, top|
        leaf = Plist.at(top, path)
        if xml.nil? || leaf.null?
          xml.nil? && leaf.null?
        else
          Plist.parse(xml) { |expected| LibCF.CFEqual(leaf, expected) != 0 }
        end
      end
    rescue Blocked
      false
    end

    # Sets the leaf to the XML document's value.
    def write(domain : String, path : Array(String), xml : String)
      Plist.parse(xml) do |leaf|
        top(domain, path) do |store, top|
          Plist.owning(Plist.set(top, path, leaf)) { |value| store.call(value) }
        end
      end
    end

    # Deletes the leaf, and the enclosing dictionaries deeper than the first
    # `keep` once they are empty.
    def remove(domain : String, path : Array(String), keep : Int32)
      top(domain, path) do |store, top|
        Plist.owning(Plist.remove(top, path, keep)) { |value| store.call(value) }
      end
    end

    def sync(domain : String)
      synchronized = application(domain) do |app|
        LibCF.CFPreferencesSynchronize(app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost) != 0
      end
      raise "Cannot synchronize #{domain}" unless synchronized
    end

    private def application(domain : String, &)
      if domain == "NSGlobalDomain"
        yield LibCF.kCFPreferencesAnyApplication
      else
        Plist.string(domain) { |app| yield app }
      end
    end

    # Yields a setter for the path's first key, which deletes it for null, and
    # that key's current value, null when absent.
    private def top(domain : String, path : Array(String), &)
      application(domain) do |app|
        Plist.string(path.first) do |name|
          store = ->(value : LibCF::Ref) do
            LibCF.CFPreferencesSetValue(name, value, app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost)
          end
          Plist.owning(LibCF.CFPreferencesCopyValue(name, app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost)) do |value|
            yield store, value
          end
        end
      end
    end
  end
end
