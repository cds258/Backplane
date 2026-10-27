import Base
import ./check.bend as C
import ../src/core/model.bend as M
import ../src/core/tz.bend as Z
import ../src/core/stamp.bend as S

# Times under messages (core/stamp.bend): when each was sent, in the
# person's zone, and when a turn finished on its last reply.

# Tue 13 Oct 2026 09:00:00 UTC
def t0() -> Nat:
  1791882000n

def at(+s: Nat) -> Nat:
  Nat.add(t0(), s)

def u(+id: String, +s: Nat) -> M.Entry:
  M.Msg{id, "t", M.User{}, "hi", at(s)}

def a(+id: String, +s: Nat) -> M.Entry:
  M.Msg{id, "t", M.Assistant{}, "ok", at(s)}

def act(+id: String, +s: Nat) -> M.Entry:
  M.Act{id, "t", "tool", "Bash", "ls", at(s)}

# two turns: the first over, the second with a reply so far
def es() -> List<&2, M.Entry>:
  [u("u1", 0n), a("a1", 30n), act("x1", 40n), a("a2", 433n), act("x2", 440n), u("u2", 1000n), a("a3", 1010n)]

def ss(+es: List<&2, M.Entry>, +r: Z.TzRule, +now: Nat, +running: Bool) -> S.Stamps:
  S.Stamps.at(r, now, S.Stamp.ends(es, running))

# the stamp of entry i
def st(+es: List<&2, M.Entry>, +r: Z.TzRule, +now: Nat, +running: Bool, +i: Nat) -> String:
  S.Stamp.text(ss(es, r, now, running), Maybe.default(&2, M.Entry, List.get(&2, M.Entry, es, i), act("none", 0n)))

# the last turn stopped (the person's Stop): its last reply says so
def ss.stop(+es: List<&2, M.Entry>, +r: Z.TzRule, +now: Nat) -> S.Stamps:
  S.Stamps.at.s(r, now, S.Stamp.ends(es, False{}), S.Stamp.last.go(List.reverse(&2, M.Entry, es)))

def st.stop(+es: List<&2, M.Entry>, +r: Z.TzRule, +now: Nat, +i: Nat) -> String:
  S.Stamp.text(ss.stop(es, r, now), Maybe.default(&2, M.Entry, List.get(&2, M.Entry, es, i), act("none", 0n)))

def utc() -> Z.TzRule:
  Z.Tz.utc0()

def main() -> IO(Unit):
  do IO<Unit>:
    C.Check.str("a message sent today shows its time", st(es(), utc(), at(3600n), True{}, 0n), "09:00")
    C.Check.str("a reply mid-turn shows its time", st(es(), utc(), at(3600n), True{}, 1n), "09:00")
    C.Check.str("a tool call shows nothing", st(es(), utc(), at(3600n), True{}, 2n), "")
    C.Check.str("a finished turn's last reply: when, and how long", st(es(), utc(), at(3600n), True{}, 3n), "Finished 09:07 · 7m 13s")
    C.Check.str("the turn still running has not finished", st(es(), utc(), at(3600n), True{}, 6n), "09:16")
    C.Check.str("once it stops, it has", st(es(), utc(), at(3600n), False{}, 6n), "Finished 09:16 · 10s")
    C.Check.str("a page from mid-turn: when it finished alone", st([a("a1", 30n), a("a2", 433n), u("u2", 1000n)], utc(), at(3600n), False{}, 1n), "Finished 09:07")
    C.Check.str("only a turn's last reply finishes it", st([a("a1", 30n), a("a2", 433n), u("u2", 1000n)], utc(), at(3600n), False{}, 0n), "09:00")
    C.Check.str("another day shows the date", st(es(), utc(), at(172800n), True{}, 0n), "Tue 13 Oct 09:00")
    C.Check.str("in the person's zone", st(es(), Z.Tz.fixed(True{}, 10800n), at(3600n), True{}, 0n), "12:00")
    C.Check.str("a stopped turn's last reply says Stopped", st.stop(es(), utc(), at(3600n), 6n), "Stopped 09:16 · 10s")
    C.Check.str("the turns before it still say Finished", st.stop(es(), utc(), at(3600n), 3n), "Finished 09:07 · 7m 13s")
    C.Check.str("a stop with no reply yet marks nothing", S.Stamp.last.go(List.reverse(&2, M.Entry, [u("u1", 0n), a("a1", 30n), u("u2", 60n)])), "")
    C.Check.str("a turn with no reply finishes nothing", st([u("u1", 0n), act("x1", 5n), u("u2", 60n)], utc(), at(3600n), False{}, 0n), "09:00")
