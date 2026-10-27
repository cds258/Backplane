import Base
import ../src/server/hotboot.bend as H
import ../src/core/snapshot.bend as S
import ../src/core/model.bend as M
law startup_warm_accepted:
  for +w: H.Warm
  for +rows: List<&2, List<&2, String>>
  {H.Warm.choose(True{}, w, rows) == H.Warm.threads(w) : Map<&2, M.Thread>}
law startup_warm_fallback:
  for +w: H.Warm
  for +rows: List<&2, List<&2, String>>
  {H.Warm.choose(False{}, w, rows) == S.Fill.threads(rows, Map.new(&2, M.Thread)) : Map<&2, M.Thread>}
def startup_warm_accepted(w, rows):
  {==}
def startup_warm_fallback(w, rows):
  {==}
