import Base
import ./check.bend as C
import ./mailtriage_test.bend as F
import ../src/core/maildisposition.bend as D
import ../src/core/mailtriage.bend as T
import ../src/core/hub.bend as H
import ../src/core/model.bend as M
import ../src/core/json.bend as J

def yes(name: String, b: Bool) -> IO(Unit):
  C.Check.str(name, Bool.show(b), "True")

def main() -> IO(Unit):
  do IO<Unit>:
    +s : M.State = F.running()
    +run : String = F.runid(s)
    yes("live owner triage receives scoped grants", D.Disposition.triage.launch(s, run))
    yes("ordinary worker gets no triage grants", Bool.not(D.Disposition.triage.launch(s, "worker")))
    yes("original coordinator gets no extra triage grants", Bool.not(D.Disposition.triage.launch(s, "foh")))
    yes("completed run gets no grants", Bool.not(D.Disposition.triage.launch(M.State.apply(s, M.TurnChanged{run, M.Completed{}, 20n}), run)))
    C.Check.str("nontriage flags empty", String.join(D.Disposition.codex.triage(False{}), " "), "")
    +flags : String = String.join(D.Disposition.codex.triage(True{}), " ")
    yes("source read preapproved", String.contains(flags, "tools.thread_read.approval_mode=\"approve\""))
    yes("context read preapproved", String.contains(flags, "tools.mail_context.approval_mode=\"approve\""))
    yes("private escalation preapproved", String.contains(flags, "tools.escalate.approval_mode=\"approve\""))
    yes("no server default approval override", Bool.not(String.contains(flags, "default_tools_approval_mode")))
    yes("no shell approval grant", Bool.not(String.contains(flags, "exec_command")))
    yes("no direct external mail grant", Bool.not(String.contains(flags, "tools.mail.approval_mode")))
    yes("no permission answering grant", Bool.not(String.contains(flags, "permission_prompt")))
    yes("completed empty report is silent", Bool.not(H.Triage.bot.report(M.Completed{}, "")))
    yes("completed whitespace report is silent", Bool.not(H.Triage.bot.report(M.Completed{}, " \n\t")))
    yes("meaningful report retained", H.Triage.bot.report(M.Completed{}, "Actual changed outcome"))
    yes("failed empty turn still reported", H.Triage.bot.report(M.Failed{}, ""))
    +empty : M.State = M.State.apply(F.base(), M.TurnChanged{"bot-thread", M.Completed{}, 20n})
    F.n("empty bot completion files no envelope", F.appends(H.Step.outs_of(H.Triage.bot.end(True{}, empty, 21n, "bot-thread"))), 0n)
    +meaningful : M.State = M.State.apply(empty, M.MessagePosted{"bot-thread", "final", M.Assistant{}, "Verified material change", 21n})
    F.n("meaningful bot report files once", F.appends(H.Step.outs_of(H.Triage.bot.end(True{}, meaningful, 22n, "bot-thread"))), 1n)
    +failed : M.State = M.State.apply(empty, M.TurnChanged{"bot-thread", M.Failed{}, 23n})
    F.n("failed bot still files unresolved report", F.appends(H.Step.outs_of(H.Triage.bot.end(True{}, failed, 24n, "bot-thread"))), 1n)
    yes("silent workflow present in fresh brief", String.contains(T.Triage.brief(True{}, s, "b"), "Work silently"))
    # Existing production cases cover routine/hold receipt, duplicates,
    # material escalation, real source approvals and true triage failure.
    F.quiet_checks()
    F.escalation_checks()
    F.ask_checks()
    F.failure_checks()
