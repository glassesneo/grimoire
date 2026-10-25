# Owns the CFPreferences boundary: values of the current user on any host,
# exchanged as XML plist documents and compared by plist type and value.
# CFPreferences goes through cfprefsd, so values are never written to the
# preference files directly.
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
  fun CFPreferencesCopyValue(key : Ref, application : Ref, user : Ref, host : Ref) : Ref
  fun CFPreferencesSetValue(key : Ref, value : Ref, application : Ref, user : Ref, host : Ref)
  fun CFPreferencesSynchronize(application : Ref, user : Ref, host : Ref) : UInt8
  fun CFEqual(a : Ref, b : Ref) : UInt8
  fun CFRelease(ref : Ref)
end

module HjemDefaults
  module Plist
    UTF8      = 0x08000100_u32
    XMLFormat =            100

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

    def self.parse(xml : String, &)
      owning(LibCF.CFDataCreate(nil, xml.to_unsafe, xml.bytesize)) do |data|
        # CoreFoundation sets the error only on failure, so it starts as null.
        error = LibCF::Ref.null
        owning(LibCF.CFPropertyListCreateWithData(nil, data, 0, nil, pointerof(error))) do |value|
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
  end

  class Preferences
    # Plist XML of the key's value, or nil when the key is absent.
    def read(domain : String, key : String) : String?
      value(domain, key) { |value| value.null? ? nil : Plist.xml(value) }
    end

    def matches?(domain : String, key : String, xml : String?) : Bool
      value(domain, key) do |value|
        if xml.nil? || value.null?
          xml.nil? && value.null?
        else
          Plist.parse(xml) { |expected| LibCF.CFEqual(value, expected) != 0 }
        end
      end
    end

    # Sets the key to the XML document's value, or deletes it when nil.
    def write(domain : String, key : String, xml : String?)
      application(domain) do |app|
        Plist.string(key) do |name|
          if xml
            Plist.parse(xml) { |value| LibCF.CFPreferencesSetValue(name, value, app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost) }
          else
            LibCF.CFPreferencesSetValue(name, nil, app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost)
          end
        end
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

    private def value(domain : String, key : String, &)
      application(domain) do |app|
        Plist.string(key) do |name|
          Plist.owning(LibCF.CFPreferencesCopyValue(name, app, LibCF.kCFPreferencesCurrentUser, LibCF.kCFPreferencesAnyHost)) do |value|
            yield value
          end
        end
      end
    end
  end
end
