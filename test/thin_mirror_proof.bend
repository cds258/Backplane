import Base
import ../src/core/model.bend as M
import ../src/core/far.bend as FR
import ../src/server/thin-mirror.bend as TMR

# ---- selected mirrored thin conversation ----
law mirror_no_authority:
  for mirrors: List<&2, FR.In>
  for thread: String
  {TMR.Mirror.get(False{}, mirrors, thread) == None{} : Maybe<&2, FR.In>}

law mirror_no_source_state:
  for st: M.State
  for thread: String
  {TMR.Mirror.state(st, None{}, thread) == st : M.State}

law mirror_local_epoch:
  for epoch: String
  {TMR.Mirror.epoch(epoch, None{}) == epoch : String}

law mirror_changed_basis_anchor:
  {TMR.Mirror.anchor("old", "new", 37n) == 0n : Nat}
# ---- end selected mirrored thin conversation ----

def mirror_no_authority(mirrors, thread): {==}
def mirror_no_source_state(st, thread): {==}
def mirror_local_epoch(epoch): {==}
def mirror_changed_basis_anchor(): {==}
