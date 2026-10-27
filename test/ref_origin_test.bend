import Base
import ./check.bend as C
import ../src/core/ref-origin.bend as O
import ../src/core/ref.bend as R
import ../src/core/far.bend as F
import ../src/core/model.bend as M
import ../src/core/codec.bend as K
import ../src/core/json.bend as J

def show(s: String) -> String:
  O.Origin.show(s, "peer")

def text(c: Maybe<&2, M.Change>) -> String:
  match c:
    case Some{M.MessagePosted{_, _, _, s, _}}: s
    case Some{M.ActivityLogged{_, _, _, _, s, _}}: s
    case _: "missing"

def entry(es: List<&2, M.Entry>) -> String:
  match es:
    case M.Msg{_, _, _, s, _} <> _: s
    case _: "missing"

def mirror() -> F.In:
  F.In.put(F.In.new("peer", "Boat"), 0n, 4n, F.Fr.demo.items([M.ProjectCreated{"p", "Board", "/b", 1n}, M.ThreadCreated{"t", "p", "Chat", M.Local{}, "", "", "claude", "", 2n}, M.BotSet{"b", "Bub", "t", 0n, "", 3n}, M.MessagePosted{"t", "m", M.Assistant{}, "[desktop](backplane://thread/peer~local)", 4n}], 0n))

def item_json(i: F.Item) -> J.Json:
  match i:
    case F.Item{_, c}: c

def main() -> IO(Unit):
  +raw : String = "[desktop](backplane://thread/peer~local)"
  +m : F.In = mirror()
  do IO<Unit>:
    C.Check.str("plain text exact", show("plain 日本語 text"), "plain 日本語 text")
    C.Check.str("no origin leaves text exact", O.Origin.show("backplane://thread/t", ""), "backplane://thread/t")
    C.Check.str("invalid origin leaves text exact", O.Origin.show("backplane://thread/t", "bad/link"), "backplane://thread/t")
    C.Check.str("owner local thread points back to owner", show("backplane://thread/t"), "backplane://thread/peer~t")
    C.Check.str("receiver thread becomes local", show("backplane://thread/peer~local"), "backplane://thread/local")
    C.Check.str("foreign link stays byte exact", show("backplane://thread/other~t#m%3a1"), "backplane://thread/other~t#m%3a1")
    C.Check.str("owner project gains origin", show("backplane://project/p"), "backplane://project/peer~p")
    C.Check.str("receiver project becomes local", show("backplane://project/peer~p"), "backplane://project/p")
    C.Check.str("markdown label and syntax retained", show(raw), "[desktop](backplane://thread/local)")
    C.Check.str("sentence punctuation retained", show("go backplane://thread/peer~t., then"), "go backplane://thread/t., then")
    C.Check.str("two links translated independently", show("backplane://thread/t and backplane://project/peer~p"), "backplane://thread/peer~t and backplane://project/p")
    C.Check.str("quoted URI retains quotes", show("'backplane://thread/t'"), "'backplane://thread/peer~t'")
    C.Check.str("angle URI retains brackets", show("<backplane://thread/t>"), "<backplane://thread/peer~t>")
    C.Check.str("inline code remains literal", show("`backplane://thread/t`"), "`backplane://thread/t`")
    C.Check.str("double backtick code remains literal", show("``backplane://thread/t``"), "``backplane://thread/t``")
    C.Check.str("fenced code remains literal", show("```text\nbackplane://thread/t\n```"), "```text\nbackplane://thread/t\n```")
    C.Check.str("after closing code URI is translated", show("`code` backplane://thread/t"), "`code` backplane://thread/peer~t")
    C.Check.str("unclosed code stays literal", show("`backplane://thread/t"), "`backplane://thread/t")
    C.Check.str("ordinary web link untouched", show("https://example.com/backplane://thread/t"), "https://example.com/backplane://thread/t")
    C.Check.str("word containing scheme untouched", show("prefixbackplane://thread/t"), "prefixbackplane://thread/t")
    C.Check.str("unknown scheme target untouched", show("backplane://unknown/t"), "backplane://unknown/t")
    C.Check.str("malformed URI stays exact", show("backplane://thread/"), "backplane://thread/")
    C.Check.str("unrelated reference kind unchanged", show("backplane://room/r"), "backplane://room/r")
    C.Check.str("entry anchor preserved", show("backplane://thread/peer~t#m1"), "backplane://thread/t#m1")
    C.Check.str("percent encoded IDs normalized only on remap", show(R.Ref.uri(R.Ref.thread("peer~日本語"))), R.Ref.uri(R.Ref.thread("日本語")))
    C.Check.str("far MessagePosted display translated", text(F.Fr.change("peer", M.MessagePosted{"t", "m", M.Assistant{}, raw, 1n})), "[desktop](backplane://thread/local)")
    C.Check.str("far ActivityLogged display translated", text(F.Fr.change("peer", M.ActivityLogged{"t", "a", "info", "fixture", raw, 1n})), "[desktop](backplane://thread/local)")
    C.Check.str("raw mirror items retain original text", Bool.show(String.contains(J.Json.show(J.Json.arr(F.Fr.items.json(F.In.items(m)))), "backplane://thread/peer~local")), "True")
    C.Check.str("folded mirror reads translated links", entry(M.State.mine(F.In.view(m), "peer~t")), "[desktop](backplane://thread/local)")
    C.Check.str("compaction never double-translates links", entry(M.State.mine(F.In.view(F.In.compact(m)), "peer~t")), "[desktop](backplane://thread/local)")
    C.Check.str("repeat compaction stays exact", entry(M.State.mine(F.In.view(F.In.compact(F.In.compact(m))), "peer~t")), "[desktop](backplane://thread/local)")
