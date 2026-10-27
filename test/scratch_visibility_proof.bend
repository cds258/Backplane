import Base
import ../src/core/model.bend as M
import ../src/core/json.bend as J
import ../src/core/mcp.bend as MC
import ../src/core/subthreads.bend as LEG

def retired_scratch_launch_refused(s: M.State, now: Nat, thread: String, by: String, p: J.Json) ->
  {MC.Mcp.launch.retired_guard(True{}, s, now, thread, by, p) == MC.Res.fail(MC.Mcp.launch.retired_message()) : MC.Res}:
  {==}

def retired_scratch_id() ->
  {MC.Mcp.launch.retired_id("scratch") == True{} : Bool}:
  {==}

def legacy_active_visible() ->
  {LEG.Legacy.unsettled(M.Active{}) == True{} : Bool}:
  {==}
