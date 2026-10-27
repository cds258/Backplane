import Base
import ./check.bend as C
import ../src/core/model.bend as M
import ../src/core/codec.bend as Cdc
import ../src/core/json.bend as J
import ../src/core/far.bend as F
import ../src/core/ubop.bend as UO
import ../src/core/ubersync.bend as US
import ../src/core/thin.bend as T
import ../src/core/thin-wire.bend as W
import ../src/server/thin-mirror.bend as R
import ../src/server/thinstore.bend as TS
import ../src/server/thin-view.bend as V
import ../src/server/thin-actor.bend as A
import ../src/server/thin-sidebar.bend as SC
import ../src/core/thin-live.bend as L
import ../src/core/client.bend as U

def yes(b: Bool) -> String:
  Bool.pick(String, b, "yes", "no")

def local() -> M.State:
  M.State.replay([M.ProjectCreated{"lp", "Local", "/local", 1n}, M.ThreadCreated{"local", "lp", "Tub", M.Local{}, "", "", "claude", "", 1n},
    M.BotSet{"b1", "Tub", "local", 0n, "", 1n}, M.UberSet{"b1", "u", 2n}, M.SettingSet{"machine.id", "here", 2n},
    M.UberOp{"u", "there", 1n, UO.Ub.stamp.make(3n, 0n, "there"), UO.Ub.b.bind("there", "rb", "chat", "Tub"), 3n},
    M.UberOp{"u", "there", 2n, UO.Ub.stamp.make(4n, 0n, "there"), UO.Ub.b.lease("there", 2n), 4n},
    M.SettingSet{"uber.link.u.there", "peer", 5n}, M.MessagePosted{"local", "collision", M.Assistant{}, "LOCAL PRIVATE BODY", 6n}], M.State.empty())

def posts(+n: Nat, acc: List<&2, M.Change>) -> List<&2, M.Change>:
  match n:
    case 0n: acc
    case 1n+k: posts(k, M.MessagePosted{"chat", "m" ++ Nat.show(1n+k), M.Assistant{}, "history needle", 7n} <> acc)

def receipts(+n: Nat, acc: List<&2, M.Change>) -> List<&2, M.Change>:
  match n:
    case 0n: acc
    case 1n+k: receipts(k, M.ActivityLogged{"chat", "ride:" ++ Nat.show(1n+k), "info", "ride", "delivery receipt", 8n} <> acc)

def changes() -> List<&2, M.Change>:
  List.append(&2, M.Change, [M.ProjectCreated{"rp", "Remote", "/remote", 1n}, M.ThreadCreated{"chat", "rp", "Remote chat", M.Local{}, "", "", "claude", "", 2n}, M.ThreadCreated{"other", "rp", "Other", M.Local{}, "", "", "claude", "", 2n}, M.BotSet{"rb", "Tub", "chat", 0n, "", 2n}],
    List.append(&2, M.Change, posts(80n, Nil{}), List.append(&2, M.Change, receipts(90n, Nil{}), [M.MessagePosted{"other", "other-only", M.Assistant{}, "OTHER PRIVATE BODY", 9n}, M.MessagePosted{"chat", "collision", M.User{}, "fresh remote reply", 10n}])))

def mirror() -> F.In:
  +cs = changes()
  F.In.put(F.In.epoch.set(F.In.new("peer", "Boat"), "remote-epoch"), 0n, List.length(&2, M.Change, cs), F.Fr.demo.items(cs, 0n))

def selected() -> Maybe<&2, F.In>:
  R.Mirror.get(True{}, [mirror()], "peer~chat")

def page(before: Nat, hide: Bool) -> TS.Page:
  R.Mirror.page(selected(), "peer~chat", hide, before, T.Index.empty())

def texts(ids: List<&2, String>, +index: T.Index) -> String:
  match ids:
    case Nil{}: ""
    case id <> tail: T.Entry.text(T.Row.entry(T.Index.row.k(Map.get(T.Row, T.Row.blank(), T.Index.rows(index), id)))) ++ "|" ++ texts(tail, index)

def rows(p: TS.Page) -> Nat:
  match p:
    case TS.Page{_, ids}: List.length(&2, String, ids)

def json(s: String) -> J.Json:
  Maybe.default(&2, J.Json, J.Json.parse(s), J.Null{})

def request() -> J.Json:
  json("{\"hub\":\"h\",\"cid\":\"fixture\",\"target\":{\"kind\":\"bot\",\"id\":\"b1\"},\"session\":{\"sel\":\"peer~chat\",\"rid\":1,\"drafts\":{\"peer~chat\":\"UNSENT 日本語\",\"@unknown\":\"keep\"},\"route\":{\"kind\":\"bot-tab\",\"bot\":\"b1\",\"tab\":\"chat\"},\"open\":{},\"info\":{}},\"action\":\"\",\"value\":\"\"}")

def rendered.result(r: A.Rendered) -> J.Json:
  match r:
    case A.Rendered{_, result}: result

def render(+web: Bool, +st: M.State, +pg: TS.Page) -> J.Json:
  +p = request()
  +a = A.Actor.refresh(Nil{}, web, st, J.Json.obj(Nil{}), json("{\"t\":\"live\",\"items\":[]}"), 10n, p, "view")
  rendered.result(A.Actor.render.revision(a, web, st, TS.Page.index(pg), p, "epoch", 10n, TS.Page.ids(pg), L.Stream.blank(), 20n))

def search.count(r: TS.Found) -> Nat:
  match r:
    case TS.Found{T.SearchPage{ids, _, _, _}, _}: List.length(&2, String, ids)

def search.last(r: TS.Found) -> Nat:
  match r:
    case TS.Found{T.SearchPage{_, _, last, _}, _}: V.Page.number(last)

def read.code(r: V.MessageRead) -> String:
  match r:
    case V.MessageRead{code, _, _}: code

def read.result(r: V.MessageRead, p: J.Json, epoch: String) -> J.Json:
  match r:
    case V.MessageRead{_, row, start}: V.Message.result(row, start, p, epoch)

def main() -> IO(Unit):
  +s = local()
  +i = mirror()
  +view = R.Mirror.state(s, selected(), "peer~chat")
  +p = page(0n, True{})
  +text = texts(TS.Page.ids(p), TS.Page.index(p))
  +window = V.Page.window(TS.Page.index(p), "peer~chat", request(), R.Mirror.epoch("base", selected()), TS.Page.ids(p))
  +cursor = J.Json.get_str(window, "older", "")
  +at = Maybe.default(&2, Nat, W.Cursor.read(cursor, R.Mirror.epoch("base", selected()), J.Json.get_obj(request(), "target"), ""), 0n)
  +appended = F.In.put(i, F.In.head(i), 1n+F.In.head(i), [F.Item{1n+F.In.head(i), Cdc.Change.wire(M.MessagePosted{"chat", "next", M.Assistant{}, "next reply", 11n})}])
  +compact = F.In.compact(i)
  +found = R.Mirror.search(selected(), "needle", "peer~chat", 0n, T.Index.empty())
  +web = render(True{}, view, p)
  +native = render(False{}, view, p)
  +long = F.In.put(i, F.In.head(i), 1n+F.In.head(i), [F.Item{1n+F.In.head(i), Cdc.Change.wire(M.MessagePosted{"chat", "long", M.Assistant{}, String.repeat("日本語", 4000n), 11n})}])
  +long_page = R.Mirror.page(Some{long}, "peer~chat", True{}, 0n, T.Index.empty())
  +long_req = V.Obj.put(request(), "entryId", J.Str{"long"})
  +source = V.Message.read(TS.Page.index(long_page), "peer~chat", long_req, R.Mirror.epoch("base", Some{long}), TS.Page.ids(long_page), view)
  +first_chunk = read.result(source, long_req, R.Mirror.epoch("base", Some{long}))
  +next_req = V.Obj.put(long_req, "cursor", J.Str{J.Json.get_str(J.Json.get_obj(first_chunk, "message"), "cursor", "")})
  do IO<Unit>:
    C.Check.str("non-holder Uber route selects mirrored thread", US.Ub.chat(s), "peer~chat")
    C.Check.str("bot target uses same mirrored thread", V.Target.thread(s, V.Target.json("bot", "b1")), "peer~chat")
    C.Check.str("selected metadata exists without a local-store row", yes(V.Target.exists(view, V.Target.json("thread", "peer~chat"))), "yes")
    C.Check.str("canonical state still has no far thread", yes(V.Target.exists(s, V.Target.json("thread", "peer~chat"))), "no")
    C.Check.str("read projection preserves local sequence", Nat.show(M.State.seq(view)), Nat.show(M.State.seq(s)))
    C.Check.str("read projection preserves local body", T.Entry.text(Maybe.default(&2, M.Entry, List.head(&2, M.Entry, M.State.mine(view, "local")), M.Msg{"", "", M.User{}, "", 0n})), "LOCAL PRIVATE BODY")
    C.Check.str("read projection adds no mirrored history to local entries", Nat.show(List.length(&2, M.Entry, M.State.entries.all(view))), Nat.show(List.length(&2, M.Entry, M.State.entries.all(s))))
    C.Check.str("no authority yields no mirror", yes(Maybe.is_some(&2, F.In, R.Mirror.get(False{}, [i], "peer~chat"))), "no")
    C.Check.str("foreign link yields no mirror", yes(Maybe.is_some(&2, F.In, R.Mirror.get(True{}, [i], "other~chat"))), "no")
    C.Check.str("missing thread yields no mirror", yes(Maybe.is_some(&2, F.In, R.Mirror.get(True{}, [i], "peer~missing"))), "no")
    C.Check.str("local thread never borrows a mirror", yes(Maybe.is_some(&2, F.In, R.Mirror.get(True{}, [i], "local"))), "no")
    C.Check.str("page bounds emitted rows", Nat.show(rows(p)), "32")
    C.Check.str("page materializes only one lookahead", Nat.show(List.length(&2, T.Row, Map.values(&2, T.Row, T.Index.rows(TS.Page.index(p))))), "33")
    C.Check.str("mirror page contains newest body", yes(String.contains(text, "fresh remote reply")), "yes")
    C.Check.str("other thread body excluded", yes(String.contains(text, "OTHER PRIVATE BODY")), "no")
    C.Check.str("local collision body excluded", yes(String.contains(text, "LOCAL PRIVATE BODY")), "no")
    C.Check.str("chat receipt rows excluded before page selection", yes(String.contains(text, "delivery receipt")), "no")
    C.Check.str("raw source page retains receipt rows", yes(String.contains(texts(TS.Page.ids(page(0n, False{})), TS.Page.index(page(0n, False{}))), "delivery receipt")), "yes")
    C.Check.str("older cursor exists", yes(J.Json.get_bool(window, "hasMore", False{})), "yes")
    C.Check.str("older cursor uses source ordinal", yes(Nat.is_gt(at, 0n)), "yes")
    C.Check.str("older page remains bounded and filled", Nat.show(rows(page(at, True{}))), "32")
    C.Check.str("wrong epoch rejects cursor", yes(Maybe.is_some(&2, Nat, W.Cursor.read(cursor, "wrong", J.Json.get_obj(request(), "target"), ""))), "no")
    C.Check.str("append retains cursor source basis", R.Mirror.epoch("base", Some{appended}), R.Mirror.epoch("base", Some{i}))
    C.Check.str("append changes exact picture key without local commit", yes(String.eq(R.Mirror.key(Some{i}), R.Mirror.key(Some{appended}))), "no")
    C.Check.str("compaction changes cursor basis", yes(String.eq(R.Mirror.epoch("base", Some{i}), R.Mirror.epoch("base", Some{compact}))), "no")
    C.Check.str("changed source resets stored page anchor", Nat.show(R.Mirror.anchor("old", "new", 50n)), "0")
    C.Check.str("same source preserves page anchor", Nat.show(R.Mirror.anchor("same", "same", 50n)), "50")
    C.Check.str("no source leaves local epoch exact", R.Mirror.epoch("base", None{}), "base")
    C.Check.str("search returns bounded matching remote rows", Nat.show(search.count(found)), "25")
    C.Check.str("search continues with source ordinal", Nat.show(search.count(R.Mirror.search(selected(), "needle", "peer~chat", search.last(found), T.Index.empty()))), "25")
    C.Check.str("search excludes foreign text", Nat.show(search.count(R.Mirror.search(selected(), "PRIVATE", "peer~chat", 0n, T.Index.empty()))), "0")
    C.Check.str("actual web bot rendering contains remote body", yes(String.contains(J.Json.show(web), "fresh remote reply")), "yes")
    C.Check.str("actual native bot rendering contains remote body", yes(String.contains(J.Json.show(native), "fresh remote reply")), "yes")
    C.Check.str("web keeps unsent far draft", yes(String.contains(J.Json.show(web), "UNSENT 日本語")), "yes")
    C.Check.str("native keeps unsent far draft", yes(String.contains(J.Json.show(native), "UNSENT 日本語")), "yes")
    C.Check.str("unknown scratch stays in projected private sidebar key", yes(String.contains(SC.Sidebar.key(U.Ui.scratch_set(V.Session.current(True{}, view, J.Json.obj(Nil{}), json("{\"t\":\"live\",\"items\":[]}"), 10n, request()), "@unknown", "keep"), "epoch", "view"), "@unknown")), "yes")
    C.Check.str("mirror source read never repairs from local receipt", T.Entry.text(T.Row.entry(V.Message.whole.source(True{}, s, T.Row{1n, M.Msg{"collision", "peer~chat", M.Assistant{}, "REMOTE BODY", 7n}, Map.new(&2, Bool), T.Blocks.of("REMOTE BODY")}))), "REMOTE BODY")

    C.Check.str("long mirrored source read is owned and chunked", read.code(source), "")
    C.Check.str("long mirrored source offers a continuation", yes(J.Json.get_bool(J.Json.get_obj(first_chunk, "message"), "hasMore", False{})), "yes")
    C.Check.str("long mirrored source continuation validates", read.code(V.Message.read(TS.Page.index(long_page), "peer~chat", next_req, R.Mirror.epoch("base", Some{long}), TS.Page.ids(long_page), view)), "")
    C.Check.str("foreign source entry is refused", read.code(V.Message.read(TS.Page.index(long_page), "peer~chat", V.Obj.put(long_req, "entryId", J.Str{"other-only"}), R.Mirror.epoch("base", Some{long}), TS.Page.ids(long_page), view)), "NOT_FOUND")
    C.Check.str("source continuation wrong epoch is refused", read.code(V.Message.read(TS.Page.index(long_page), "peer~chat", next_req, "wrong", TS.Page.ids(long_page), view)), "STALE_CURSOR")
