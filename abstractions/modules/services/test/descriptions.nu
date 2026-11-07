# Observes what the services of the dinit instance at SOCKET, started on the
# descriptions a fixture placed, received and did. Services write under $OUT,
# which reaches their shell unexpanded by dinit.
use std/assert

use common.nu [eventually lines-of]

# The lines a service wrote to NAME under $OUT.
def output [name: string]: nothing -> list<string> {
  lines-of ($env.OUT | path join $name)
}

def main [socket: path] {
  eventually 'login started' { (^dinitctl --socket-path $socket --quiet is-started login | complete).exit_code == 0 }
  eventually 'failing services stop' {
    (output flaky | length) >= 2 and ([flaky once] | all {|name| (^dinitctl --socket-path $socket --quiet is-started $name | complete).exit_code != 0 })
  }

  assert equal (output args) ['two words' 'quote " and \ backslash' '$HOME' '#hash' '' '${x}' "'single'"] 'arguments arrive literally'
  assert equal (open --raw ($env.OUT | path join env)) 'a $B "c" #d' 'environment values arrive literally'
  assert equal (output pwd) ['/usr/bin'] 'the working directory applies'
  assert equal (output order | where {|line| $line in [setup args] }) [setup args] 'a dependency starts before its dependent'
  assert equal (output order | where {|line| $line in [early late] }) [early late] 'an after relation orders starts'
  assert equal (output manual) [] 'a service without groups does not start'
  assert equal (output once | length) 1 'a service that never restarts runs once'
}
