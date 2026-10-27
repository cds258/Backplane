import Base
import ../src/core/hub.bend as H
import ../src/core/model.bend as M
import ../src/core/json.bend as J

law codex_error_notice_kind:
  {H.Codex.kind("error") == 9n : Nat}
law codex_error_notice_no_effects:
  for s: M.State
  for th: String
  for now: Nat
  for o: J.Json
  {H.Step.outs_of(H.Codex.error.step(s, th, now, o)) == [] : List<&2, H.Out>}

def codex_error_notice_kind(): {==}
def codex_error_notice_no_effects(s, th, now, o): {==}
