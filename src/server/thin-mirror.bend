import Base
import ../core/model.bend as M
import ../core/json.bend as J
import ../core/codec.bend as C
import ../core/far.bend as F
import ../core/thin.bend as T
import ../core/thin-chat.bend as TC
import ./thinstore.bend as TS

# A selected mirror is a read projection, never a local-store commit. The
# caller supplies the existing link/sync authority decision. No unpaired,
# revoked, disabled or different link can supply a selected conversation.
def Mirror.project(t: M.Thread) -> String:
  match t:
    case M.Thread{_, p, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _, _}: p

def Mirror.project.get(p: Map<&2, M.Project> & M.Project) -> M.Project:
  (_, x) = p
  x

def Mirror.item.n(m: Maybe<&2, F.Item>) -> Nat:
  match m:
    case None{}: 0n
    case Some{i}: F.Item.n(i)

def Mirror.entry(c: Maybe<&2, M.Change>) -> Maybe<&2, M.Entry>:
  match c:
    case Some{M.MessagePosted{th, id, role, text, at}}: Some{M.Msg{id, th, role, text, at}}
    case Some{M.ActivityLogged{th, id, tone, kind, text, at}}: Some{M.Act{id, th, tone, kind, text, at}}
    case _: None{}

def Mirror.row(+n: Nat, +e: M.Entry, terms: Map<&2, Bool>) -> T.Row:
  T.Row{n, e, terms, T.Blocks.of(T.Entry.text(e))}

# Parse no unrelated body. Only retained, selected rows get UTF8 blocks;
# a page materializes at most 33 rows including the exact older lookahead.
def Mirror.add(m: Maybe<&2, T.Row>, acc: List<&2, T.Row>) -> List<&2, T.Row>:
  match m:
    case None{}: acc
    case Some{r}: r <> acc

def Mirror.left(m: Maybe<&2, T.Row>, left: Nat) -> Nat:
  match m:
    case None{}: left
    case Some{_}: Nat.sub(left, 1n)

def Mirror.has(p: Map<&2, M.Thread> & Bool) -> Bool:
  (_, has) = p
  has

def Mirror.ids(rs: List<&2, T.Row>) -> List<&2, String>:
  match rs:
    case Nil{}: Nil{}
    case r <> rest: Nat.show(T.Row.n(r)) <> Mirror.ids(rest)

# Search visits only the selected, already bounded mirror. Unrelated bodies
# get no word or block scan. Keep at most 129 matching candidates, then use
# the normal 25-result search protocol and exact source ordinals.
def Mirror.anchor(+previous: String, +current: String, anchor: Nat) -> Nat:
  Bool.pick(Nat, Bool.and(Bool.not(String.is_empty(previous)), Bool.not(String.eq(previous, current))), 0n, anchor)
def Mirror.projects(empty: Bool, ps: Map<&2, M.Project>, +remote: Map<&2, M.Project>, +id: String) -> Map<&2, M.Project>:
  match empty:
    case True{}: ps
    case False{}: Map.set(&2, M.Project, ps, id, Mirror.project.get(Map.get(M.Project, M.Project.blank(id), remote, id)))

# Only selected thread/project metadata is added. Local sequence, settings,
# bot world, entries, pending work and devices retain their exact identities.
def Mirror.basis(+i: F.In) -> Nat:
  +n = Nat.sub(List.length(&2, F.Item, F.In.items(i)), F.In.tail(i))
  Bool.pick(Nat, Nat.is_eq(n, 0n), 0n, Mirror.item.n(List.get(&2, F.Item, F.In.items(i), Nat.sub(n, 1n))))

def Mirror.change(c: Maybe<&2, M.Change>, +link: String) -> Maybe<&2, M.Entry>:
  match c:
    case None{}: None{}
    case Some{ch}: Mirror.entry(F.Fr.change(link, ch))

def Mirror.pick.keep(keep: Bool, e: M.Entry, n: Nat) -> Maybe<&2, T.Row>:
  match keep:
    case False{}: None{}
    case True{}: Some{Mirror.row(n, e, Map.new(&2, Bool))}

def Mirror.present.state(st: M.State, i: F.In, +thread: String) -> Maybe<&2, F.In>:
  match st:
    case M.State{_, ts, _, _, _, _, _, _, _, _, _}:
      Bool.pick(Maybe<&2, F.In>, Mirror.has(Map.has(&2, M.Thread, ts, thread)), Some{i}, None{})

def Mirror.search.result(+rows: List<&2, T.Row>, +thread: String, +base: T.Index) -> TS.Found:
  +ids = Mirror.ids(rows)
  TS.Found{T.SearchPage{List.take(&2, String, ids, 25n), Bool.pick(Nat, Nat.is_lt(List.length(&2, String, ids), 25n), List.length(&2, String, ids), 25n), Maybe.default(&2, String, List.get(&2, String, ids, Nat.sub(Bool.pick(Nat, Nat.is_lt(List.length(&2, String, ids), 25n), List.length(&2, String, ids), 25n), 1n)), ""), Nat.is_gt(List.length(&2, String, ids), 25n)}, T.Index.window(rows, thread, 0n, base)}

def Mirror.state.with_meta(st: M.State, remote: M.State, +thread: String, +t: M.Thread, +pid: String) -> M.State:
  match st remote:
    case M.State{ps, ts, es, n, tk, settings, queue, asks, devices, nav, world} M.State{rps, _, _, _, _, _, _, _, _, _, _}:
      M.State{Mirror.projects(String.is_empty(pid), ps, rps, pid), Map.set(&2, M.Thread, ts, thread, t), es, n, tk, settings, queue, asks, devices, nav, world}

def Mirror.epoch(+base: String, m: Maybe<&2, F.In>) -> String:
  match m:
    case None{}: base
    case Some{+i}: base ++ "|mirror:" ++ F.In.link(i) ++ ":" ++ F.In.epoch(i) ++ ":" ++ Nat.show(Mirror.basis(i))

def Mirror.key(m: Maybe<&2, F.In>) -> String:
  match m:
    case None{}: ""
    case Some{+i}: J.Json.show(J.Json.arr([J.Str{F.In.link(i)}, J.Str{F.In.epoch(i)}, J.Json.nat(F.In.head(i)), J.Json.nat(Mirror.basis(i)), J.Flag{F.In.away(i)}]))

def Mirror.pick.entry(m: Maybe<&2, M.Entry>, +n: Nat, +thread: String, +hide: Bool) -> Maybe<&2, T.Row>:
  match m:
    case None{}: None{}
    case Some{+e}: Mirror.pick.keep(Bool.and(T.Search.owner(thread, e), Bool.not(Bool.and(hide, TC.Chat.hidden(e)))), e, n)

def Mirror.present(m: Maybe<&2, F.In>, +thread: String) -> Maybe<&2, F.In>:
  match m:
    case None{}: None{}
    case Some{+i}: Mirror.present.state(F.In.view(i), i, thread)

def Mirror.search.owned(owned: Bool, +e: M.Entry, n: Nat, terms: List<&2, Sigma<&2, &2, String, _ => Bool>>) -> Maybe<&2, T.Row>:
  match owned:
    case False{}: None{}
    case True{}: Mirror.pick.keep(T.Search.all(terms, T.Words.of(T.Entry.text(e)), True{}), e, n)

def Mirror.get(allowed: Bool, +mirrors: List<&2, F.In>, +thread: String) -> Maybe<&2, F.In>:
  match allowed:
    case False{}: None{}
    case True{}: Mirror.present(Bool.pick(Maybe<&2, F.In>, F.Fr.is(thread), F.Ins.find(mirrors, F.Fr.link(thread)), None{}), thread)

def Mirror.state.with(+st: M.State, +remote: M.State, +thread: String) -> M.State:
  +t = M.State.thread.get(remote, thread)
  Mirror.state.with_meta(st, remote, thread, t, Mirror.project(t))

def Mirror.pick(older: Bool, n: Nat, c: J.Json, +link: String, +thread: String, +hide: Bool) -> Maybe<&2, T.Row>:
  match older:
    case False{}: None{}
    case True{}: Mirror.pick.entry(Mirror.change(C.Change.decode(c), link), n, thread, hide)

def Mirror.search.entry(m: Maybe<&2, M.Entry>, n: Nat, +thread: String, terms: List<&2, Sigma<&2, &2, String, _ => Bool>>) -> Maybe<&2, T.Row>:
  match m:
    case None{}: None{}
    case Some{+e}: Mirror.search.owned(T.Search.owner(thread, e), e, n, terms)

def Mirror.state(+st: M.State, m: Maybe<&2, F.In>, +thread: String) -> M.State:
  match m:
    case None{}: st
    case Some{+i}: F.Fr.mark(Mirror.state.with(st, F.In.view(i), thread), F.In.link(i), F.In.name.of(i), F.In.away(i))

# The snapshot prefix ends before In.tail's appended items. Its end number
# is stable across appends and changes on compaction; a cursor cannot join
# two differently numbered snapshots. The remote epoch fences replacements.
def Mirror.rows(xs: List<&2, F.Item>, +link: String, +thread: String, +before: Nat, +hide: Bool, +left: Nat, acc: List<&2, T.Row>) -> List<&2, T.Row>:
  match xs left:
    case _ 0n: List.reverse(&2, T.Row, acc)
    case Nil{} _: List.reverse(&2, T.Row, acc)
    case F.Item{+n, c} <> rest _:
      +row = Mirror.pick(Bool.or(Nat.is_eq(before, 0n), Nat.is_lt(n, before)), n, c, link, thread, hide)
      Mirror.rows(rest, link, thread, before, hide, Mirror.left(row, left), Mirror.add(row, acc))

def Mirror.search.pick(older: Bool, n: Nat, c: J.Json, +link: String, +thread: String, terms: List<&2, Sigma<&2, &2, String, _ => Bool>>) -> Maybe<&2, T.Row>:
  match older:
    case False{}: None{}
    case True{}: Mirror.search.entry(Mirror.change(C.Change.decode(c), link), n, thread, terms)

def Mirror.page(m: Maybe<&2, F.In>, +thread: String, +hide: Bool, +before: Nat, +base: T.Index) -> TS.Page:
  match m:
    case None{}: TS.Page{T.Index.window(Nil{}, thread, 0n, base), Nil{}}
    case Some{+i}:
      +index = T.Index.window(Mirror.rows(List.reverse(&2, F.Item, F.In.items(i)), F.In.link(i), thread, before, hide, 33n, Nil{}), thread, 0n, base)
      TS.Page{index, T.Index.page(index, thread, before, 32n)}

# A continued source read may load only its named ordinal in this thread.
# Initial reads stay limited to the current page, as the store path does.
def Mirror.whole.rows(xs: List<&2, F.Item>, +link: String, +thread: String, +ord: Nat) -> List<&2, T.Row>:
  Mirror.rows(xs, link, thread, 1n+ord, False{}, 1n, Nil{})

def Mirror.search.rows(xs: List<&2, F.Item>, +link: String, +thread: String, +before: Nat, +terms: List<&2, Sigma<&2, &2, String, _ => Bool>>, +left: Nat, acc: List<&2, T.Row>) -> List<&2, T.Row>:
  match xs left:
    case _ 0n: List.reverse(&2, T.Row, acc)
    case Nil{} _: List.reverse(&2, T.Row, acc)
    case F.Item{+n, c} <> rest _:
      +row = Mirror.search.pick(Bool.or(Nat.is_eq(before, 0n), Nat.is_lt(n, before)), n, c, link, thread, terms)
      Mirror.search.rows(rest, link, thread, before, terms, Mirror.left(row, left), Mirror.add(row, acc))

def Mirror.whole(m: Maybe<&2, F.In>, +thread: String, +ord: Nat, p: TS.Page) -> TS.Page:
  match m p:
    case None{} _: p
    case Some{+i} TS.Page{+index, ids}:
      TS.Page{T.Index.window.rows(Bool.pick(List<&2, T.Row>, Nat.is_eq(ord, 0n), Nil{}, Mirror.whole.rows(List.reverse(&2, F.Item, F.In.items(i)), F.In.link(i), thread, ord)), thread, index), ids}

def Mirror.search(m: Maybe<&2, F.In>, +query: String, +thread: String, +before: Nat, +base: T.Index) -> TS.Found:
  match m:
    case None{}: Mirror.search.result(Nil{}, thread, base)
    case Some{+i}: Mirror.search.result(Mirror.search.rows(List.reverse(&2, F.Item, F.In.items(i)), F.In.link(i), thread, before, Map.to_list(&2, Bool, T.Words.of(query)), 129n, Nil{}), thread, base)

# A page anchor from an earlier mirror snapshot cannot address the new one.
# Ordinary appends retain the source basis, so readers keep their place.
