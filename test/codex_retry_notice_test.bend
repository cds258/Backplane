import Base
import ./check.bend as C
import ../src/core/thin-chat.bend as T
import ../src/core/hub.bend as H
import ../src/core/model.bend as M
import ../src/core/json.bend as J
import ../src/core/fallback.bend as F

def notice.kind(s: H.Step) -> String:
  match s:
    case H.Step{[M.ActivityLogged{_, _, tone, kind, _, _}], Nil{}}: tone ++ "/" ++ kind
    case _: "unexpected"

def notice.visible(s: H.Step) -> String:
  match s:
    case H.Step{[M.ActivityLogged{th, id, tone, kind, text, at}], Nil{}}:
      Bool.show(Bool.not(T.Chat.receipt(M.Act{id, th, tone, kind, text, at})))
    case _: "unexpected"

def event(message: String) -> J.Json:
  J.Json.obj([J.KV{"type", J.Str{"error"}}, J.KV{"message", J.Str{message}}])

def text(step: H.Step) -> String:
  match step:
    case H.Step{[M.ActivityLogged{_, _, _, _, text, _}], Nil{}}: text
    case _: "unexpected"

def yes(name: String, b: Bool) -> IO(Unit):
  C.Check.str(name, Bool.show(b), "True")

def main() -> IO(Unit):
  do IO<Unit>:
    +o : J.Json = event("Reconnecting... 1/5 (exceeded retry limit, last status: 429 Too Many Requests, request id: PRIVATE-REQUEST-ID)")
    +step : H.Step = H.Codex.line.parsed(Some{o}, M.State.empty(), "fixture", 10n)
    C.Check.str("Codex error has a distinct notice kind", Nat.show(H.Codex.kind("error")), "9")
    C.Check.str("rate limit is informational provider activity without side effects", notice.kind(step), "info/provider")
    C.Check.str("rate limit notice survives chat receipt filter", notice.visible(step), "True")
    yes("visible notice explains HTTP 429", String.contains(text(step), "HTTP 429"))
    yes("visible notice states retry", String.contains(text(step), "retry"))
    yes("visible notice keeps input", String.contains(text(step), "message is kept"))
    yes("raw request details stay out of timeline", Bool.not(String.contains(text(step), "PRIVATE-REQUEST-ID")))
    C.Check.str("network retry is not called quota", H.Codex.error.text(event("Reconnecting... 1/5: connection reset")), "Provider connection interrupted. The provider is retrying; your message is kept.")
    C.Check.str("empty error still visible", H.Codex.error.text(event("")), "Provider reported an error. Your message is kept; waiting for the provider's next result.")
    C.Check.str("unknown event remains silent", notice.kind(H.Codex.line.parsed(Some{J.Json.obj([J.KV{"type", J.Str{"unknown-event"}}])}, M.State.empty(), "fixture", 10n)), "unexpected")
    +failed : H.Step = H.Codex.line.parsed(Some{J.Json.obj([J.KV{"type", J.Str{"turn.failed"}}, J.KV{"message", J.Str{"failed"}}])}, M.State.empty(), "fixture", 10n)
    C.Check.str("terminal failure still has failed turn change", Nat.show(List.length(&2, M.Change, H.Queue.changes(failed))), "2")
    +completed : H.Step = H.Codex.line.parsed(Some{J.Json.obj([J.KV{"type", J.Str{"turn.completed"}}])}, M.State.empty(), "fixture", 10n)
    yes("completion path still changes turn", Nat.is_gt(List.length(&2, M.Change, H.Queue.changes(completed)), 0n))
    C.Check.str("existing provider notice preserved", notice.kind(H.Codex.line.parsed(Some{J.Json.obj([J.KV{"type", J.Str{"notice"}}, J.KV{"message", J.Str{"renewed"}}])}, M.State.empty(), "fixture", 10n)), "info/session")
    C.Check.str("429 alone does not authorize quota fallback", Bool.show(Maybe.is_some(&2, F.Limit, F.Error.classify("codex", "gpt-6.1-sol", o))), "False")
