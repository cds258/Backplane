import Base
import ../src/core/hub.bend as H
import ../src/core/model.bend as M
import ../src/core/maildisposition.bend as D
law mail_empty_success_quiet:
  {H.Triage.bot.report(M.Completed{}, "") == False{} : Bool}
def mail_empty_success_quiet(): {==}
law mail_failed_empty_preserved:
  {H.Triage.bot.report(M.Failed{}, "") == True{} : Bool}
def mail_failed_empty_preserved(): {==}
law mail_no_triage_grants_outside_run:
  {D.Disposition.codex.triage(False{}) == [] : List<&2, String>}
def mail_no_triage_grants_outside_run(): {==}
law mail_silent_bot_envelope:
  for s: M.State
  for now: Nat
  for th: String
  for text: String
  {H.Triage.bot.file(False{}, s, now, th, text) == H.Step.none() : H.Step}
def mail_silent_bot_envelope(s, now, th, text): {==}
