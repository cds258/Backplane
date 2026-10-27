import Base
import ./check.bend as C
import ../src/core/model.bend as M
import ../src/core/json.bend as J
import ../src/core/client.bend as U
import ../src/core/subthreads.bend as L
import ../src/core/mcp.bend as MC
import ../src/core/fmcp.bend as F
import ../src/core/far.bend as FR
import ../src/core/codec.bend as K
import ../src/web/dom.bend as D
import ../src/web/view.bend as V
import ../src/web/presentation.bend as W
import ../src/core/i18n.bend as I
import ../src/mobile/screen.bend as MOB

def state() -> M.State:
  M.State.replay([M.ProjectCreated{"p", "Board", "/board", 1n}, M.ProjectCreated{"scratch", "Scratch", "/legacy", 1n},
    M.ThreadCreated{"caller", "p", "Caller", M.Local{}, "", "", "claude", "", 2n},
    M.ThreadCreated{"legacy", "scratch", "Existing background work", M.Local{}, "", "", "claude", "", 3n},
    M.ThreadLaunched{"legacy", "peer~boat-thread", True{}, 4n}], M.State.empty())

def settled() -> M.State:
  M.State.apply(state(), M.ThreadSettled{"legacy", False{}, 10n})

def ui(st: M.State) -> U.Ui:
  U.Ui.select.k(U.Ui.adopt.raw(U.Ui.init(20n), st), "caller")

def yes(b: Bool) -> String:
  Bool.pick(String, b, "yes", "no")

def args(project: String) -> J.Json:
  J.Json.obj([J.KV{"project", J.Str{project}}, J.KV{"prompt", J.Str{"fixture work"}}])

def launch(project: String) -> MC.Res:
  MC.Mcp.launch(state(), 20n, "caller", args(project))

def body(r: MC.Res) -> J.Json:
  match r:
    case MC.Res{_, b, _}: b

def error(r: MC.Res) -> String:
  match r:
    case MC.Res{_, b, _}: J.Json.get_str(b, "error", "")

def ids(ts: List<&2, M.Thread>) -> String:
  match ts:
    case Nil{}: ""
    case t <> rest: M.Thread.id(t) ++ "|" ++ ids(rest)

def plan(project: String, away: Bool) -> F.Plan:
  F.Fm.plan.o(J.Json.obj([J.KV{"method", J.Str{"tools/call"}}, J.KV{"params", J.Json.obj([J.KV{"name", J.Str{"thread_launch"}}, J.KV{"arguments", args(project)}])}]), state(), [FR.In.away.set(FR.In.new("peer", "desktop"), away)], "caller")

def plan.error(p: F.Plan) -> String:
  match p:
    case F.PAnswer{r}: error(r)
    case _: "not refused"

def nodes(xs: List<&2, D.Node>) -> List<&2, J.Json>:
  match xs:
    case Nil{}: Nil{}
    case x <> rest: W.Node.write(x) <> nodes(rest)

def history(+s: M.State, open: Bool) -> String:
  J.Json.show(J.Json.arr(nodes(V.View.history(I.En{}, "", Map.set(&2, Bool, Map.new(&2, Bool), "conversation-history", open), U.Side.ix(s), s, "caller", 20n))))

def visible(s: M.State) -> String:
  String.join(U.Side.visible(ui(s)), "|")

def main() -> IO(Unit):
  +blocked = MC.Mcp.launch.retired_message()
  +running = M.State.apply(settled(), M.TurnChanged{"legacy", M.Running{}, 12n})
  +waiting = M.State.apply(settled(), M.AskOpened{"ask", "legacy", "approval", "tool", "Allow", "", 12n})
  +bg = M.State.apply(settled(), M.WorkSet{"legacy", "bg", "agent\tRunning Probe\ttool\tProbe\tsubagent", 12n})
  +watch = M.State.apply(settled(), M.WorkSet{"legacy", "watch", "watch\twatching\t\tMonitor\twatch", 12n})
  +killed = M.State.apply(state(), M.ThreadDeleted{"legacy", 12n})
  +archived = M.State.apply(running, M.ThreadArchived{"legacy", True{}, 12n})
  +pjson = J.Json.show(J.Json.arr(F.Fm.proj.rows(state())))
  +remote = FR.In.put(FR.In.new("peer", "desktop"), 0n, 2n, [FR.Item{1n, K.Change.wire(M.ProjectCreated{"scratch", "Scratch", "/legacy", 1n})}, FR.Item{2n, K.Change.wire(M.ProjectCreated{"p", "Board", "/board", 1n})}])
  do IO<Unit>:
    C.Check.str("local scratch launch refused clearly", error(launch("scratch")), blocked)
    C.Check.str("scratch name is case insensitive", error(launch(" Scratch ")), blocked)
    C.Check.str("refused scratch launch changes nothing", Nat.show(List.length(&2, M.Change, MC.Res.changes(launch("scratch")))), "0")
    C.Check.str("real project launch still succeeds", yes(MC.Res.good(launch("Board"))), "yes")
    C.Check.str("implicit legacy caller cannot launch more hidden work", error(MC.Mcp.launch(state(), 20n, "legacy", J.Json.obj([J.KV{"prompt", J.Str{"work"}}]))), blocked)
    C.Check.str("far scratch refused before network", plan.error(plan("peer~scratch", False{})), blocked)
    C.Check.str("far scratch refused before offline queue", plan.error(plan("peer~scratch", True{})), blocked)
    C.Check.str("unqualified scratch refused by caller plan", plan.error(plan("Scratch", False{})), blocked)
    C.Check.str("owner refuses incoming remote scratch launch", error(MC.Mcp.launch.by(state(), 20n, "", "peer~boat", args("scratch"))), blocked)
    C.Check.str("project list drops Scratch", yes(String.contains(pjson, "Scratch")), "no")
    C.Check.str("project list keeps real project", yes(String.contains(pjson, "Board")), "yes")
    C.Check.str("machine list drops local and mirrored Scratch", yes(String.contains(J.Json.show(body(F.Fm.machines(state(), [remote]))), "Scratch")), "no")
    C.Check.str("unsettled legacy row always visible", ids(L.Legacy.live(state(), "caller")), "legacy|")
    C.Check.str("settled legacy remains in collapsed history", ids(L.Legacy.live(settled(), "caller")), "")
    C.Check.str("settled source remains available", ids(L.Legacy.history(settled(), "caller")), "legacy|")
    C.Check.str("running overrides an old settled stamp", ids(L.Legacy.live(running, "caller")), "legacy|")
    C.Check.str("approval overrides an old settled stamp", ids(L.Legacy.live(waiting, "caller")), "legacy|")
    C.Check.str("owned background Agent stays visible", ids(L.Legacy.live(bg, "caller")), "legacy|")
    C.Check.str("owned monitor stays visible", ids(L.Legacy.live(watch, "caller")), "legacy|")
    C.Check.str("selected settled row stays in place", ids(L.Legacy.live(settled(), "legacy")), "legacy|")
    C.Check.str("selected row absent from quiet history", ids(L.Legacy.history(settled(), "legacy")), "")
    C.Check.str("explicit archive stays respected", ids(L.Legacy.live(archived, "caller")), "")
    C.Check.str("deleted legacy row is absent", ids(L.Legacy.live(killed, "caller")), "")
    C.Check.str("shared visible destinations include live legacy", yes(String.contains(visible(running), "legacy")), "yes")
    C.Check.str("expanded history has one legacy destination", Nat.show(List.length(&2, String, U.Side.legacy.shown(U.Ui.flag_on(ui(running), "conversation-history")))), "1")
    C.Check.str("collapsed settled destination stays hidden", yes(String.contains(visible(settled()), "legacy")), "no")
    C.Check.str("history expansion still reaches old conversation", yes(String.contains(String.join(U.Side.visible(U.Ui.flag_on(ui(settled()), "conversation-history")), "|"), "legacy")), "yes")
    C.Check.str("search still reaches old conversation", yes(String.contains(String.join(U.Side.visible(U.Ui.scratch_set(ui(settled()), "@f.pq", "background")), "|"), "legacy")), "yes")
    C.Check.str("live web row outside closed history", yes(String.contains(history(running, False{}), "Existing background work")), "yes")
    C.Check.str("settled web row stays folded", yes(String.contains(history(settled(), False{}), "Existing background work")), "no")
    C.Check.str("expanded web history reaches settled row", yes(String.contains(history(settled(), True{}), "Existing background work")), "yes")
    C.Check.str("native phone payload keeps legacy row available", yes(String.contains(J.Json.show(J.Json.arr(MOB.Mob.legacy(L.Legacy.threads(running), I.En{}, U.Side.ix(running), running, 20n))), "Existing background work")), "yes")
