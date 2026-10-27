import Base
import ./check.bend as T
import ./hotboot_test.bend as F
import ./store_checkpoint_test.bend as C
import ../src/server/storeio.bend as S
import ../src/server/hotboot.bend as H
import ../src/server/db.bend as D
import ../src/core/storedb.bend as DB
import ../src/core/snapshot.bend as SN
import ../src/core/store.bend as ST
import ../src/core/model.bend as M

def has(w: Maybe<&2, H.Warm>) -> Bool:
  match w:
    case None{}: False{}
    case Some{_}: True{}

def dump(s: M.State) -> String:
  F.dump(DB.Tab.dump(s))

def equal(+home: String, warm: Maybe<&2, H.Warm>, +name: String) -> IO(Unit):
  do IO<Unit>:
    +got : H.Hot <- H.Hot.load.warm(home, warm)
    +want : H.Hot <- H.Hot.load(home)
    T.Check.str(name ++ " accepted", H.Hot.why(got), "")
    T.Check.str(name ++ " all records", dump(H.Hot.st(got)), dump(H.Hot.st(want)))
    T.Check.str(name ++ " entry windows", ST.Store.text(H.Hot.ls(got)), ST.Store.text(H.Hot.ls(want)))

def poison(w: H.Warm, +which: Nat) -> H.Warm:
  match w:
    case H.Warm{+home, +seq, +off, +log, _}:
      H.Warm{Bool.pick(String, Nat.is_eq(which, 0n), home ++ "-other", home),
        Bool.pick(String, Nat.is_eq(which, 1n), seq ++ "0", seq),
        Bool.pick(String, Nat.is_eq(which, 2n), off ++ "0", off),
        Bool.pick(String, Nat.is_eq(which, 3n), log ++ "-other", log), Map.new(&2, M.Thread)}

def bads(w: Maybe<&2, H.Warm>, +home: String) -> IO(Unit):
  match w:
    case None{}: IO.print("FAIL catchup did not retain its thread map")
    case Some{+v}:
      do IO<Unit>:
        equal(home, Some{poison(v, 0n)}, "other home fallback")
        equal(home, Some{poison(v, 1n)}, "other sequence fallback")
        equal(home, Some{poison(v, 2n)}, "other offset fallback")
        equal(home, Some{poison(v, 3n)}, "other log fallback")

def extra(+n: Nat) -> List<&2, M.Change>:
  match n:
    case 0n: [M.ProviderSet{"t1", "codex", "gpt", 400n}]
    case 1n+t: M.MessagePosted{"t1", "extra-" ++ Nat.show(n), M.User{}, "跨 chunk", 300n+n} <> extra(t)

def main() -> IO(Unit):
  do IO<Unit>:
    made : Result<&1, &1, U32 & String, U32 & (String & String)> <- Process.run("mktemp", ["-d"], "", 4096, 10000)
    +home : String = C.temp(made)
    +path : String = home ++ "/events.jsonl"
    C.write(path, "w", ST.Store.text(C.lines(List.append(&2, M.Change, List.take(&2, M.Change, DB.Demo.changes(), 20n), [M.SettingSet{"checkpoint.pad", C.pad(300n, ""), 20n}]))))
    +initial : S.Opened <- S.Sto.boot(home)
    T.Check.str("rebuild has no reusable seed", Bool.show(has(S.Opened.warm(initial))), "False")
    cl0 : String <- D.Db.close(S.Opened.handle(initial))
    +zero : S.Opened <- S.Sto.boot(home)
    T.Check.str("zero tail does not decode extra threads", Bool.show(has(S.Opened.warm(zero))), "False")
    equal(home, S.Opened.warm(zero), "zero tail")
    cl1 : String <- D.Db.close(S.Opened.handle(zero))
    C.write(path, "a", ST.Store.text(C.lines([M.SettingSet{"startup.warm", "日本語", 100n}])))
    +one : S.Opened <- S.Sto.boot(home)
    T.Check.str("one event catchup retains decoded threads", Bool.show(has(S.Opened.warm(one))), "True")
    equal(home, S.Opened.warm(one), "one event")
    bads(S.Opened.warm(one), home)
    cl2 : String <- D.Db.close(S.Opened.handle(one))
    C.write(path, "a", ST.Store.text(C.lines(List.drop(&2, M.Change, DB.Demo.changes(), 20n))))
    +many : S.Opened <- S.Sto.boot(home)
    T.Check.str("thread and provider tail retains updated map", Bool.show(has(S.Opened.warm(many))), "True")
    equal(home, S.Opened.warm(many), "thread/provider tail")
    # Appended-but-not-checkpointed changes after the handoff are still folded.
    C.write(path, "a", ST.Store.text(C.lines([M.ThreadCreated{"warm-new", "p1", "New after handoff", M.Local{}, "", "", "claude", "", 200n}, M.MessagePosted{"warm-new", "warm-message", M.User{}, "new tail", 201n}])))
    equal(home, S.Opened.warm(many), "new tail after handoff")
    cl3 : String <- D.Db.close(S.Opened.handle(many))
    # Once checkpointed again, the old seed must not replace newer threads.
    +newer : S.Opened <- S.Sto.boot(home)
    equal(home, S.Opened.warm(many), "stale seed after new checkpoint")
    cl4 : String <- D.Db.close(S.Opened.handle(newer))
    C.write(path, "a", ST.Store.text(C.lines(extra(129n))))
    +chunks : S.Opened <- S.Sto.boot(home)
    T.Check.str("multi transaction tail retains decoded threads", Bool.show(has(S.Opened.warm(chunks))), "True")
    equal(home, S.Opened.warm(chunks), "multi transaction and provider count")
    cl5 : String <- D.Db.close(S.Opened.handle(chunks))
    IO.print("startup fixture: " ++ home)
