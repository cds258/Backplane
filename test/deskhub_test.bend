import Base
import ./check.bend as C
import ../src/core/client.bend as U
import ../src/core/i18n.bend as I
import ../src/web/view.bend as V
import ../src/web/dom.bend as D

# The Windows desktop app's Hub row (client.bend's DeskHub) on Settings'
# Network page: only where host.js named the hub (scratch "@desktop.hub",
# as app.bend's desktop_hub sets it), with the app's label and a Change…
# button whose action stays in the desktop shell.

def state(a: U.Act) -> U.Ui:
  match a:
    case U.Act{u, _}: u

def act(+u: U.Ui, +a: String, +v: String) -> U.Ui:
  state(U.Ui.act(u, a, v))

def network(+label: String) -> U.Ui:
  act(act(U.Ui.scratch_set(U.Ui.init(0n), "@desktop.hub", label), "flag", "settings"), "settings-page", "network")

# the text, attribute values and click actions of nodes
def attrs(as: List<&2, D.Attr>) -> String:
  match as:
    case Nil{}: ""
    case D.At{_, +v} <> t: v ++ "\n" ++ attrs(t)
    case D.On{_, +a} <> t: "click:" ++ a ++ "\n" ++ attrs(t)

def texts(ns: List<&2, D.Node>) -> String:
  match ns:
    case Nil{}: ""
    case D.Txt{s} <> t: s ++ "\n" ++ texts(t)
    case D.El{_, _, as, kids} <> t: attrs(as) ++ texts(kids) ++ texts(t)
    case _ <> t: texts(t)

def web(+label: String) -> String:
  texts([V.View.settings.loc(I.En{}, network(label), U.Ui.state.of(network(label)), Map.new(&2, String), "test", "")])

def has(+label: String, +s: String) -> String:
  Bool.show(String.contains(web(label), s))

def main() -> IO(Unit):
  do IO<Unit>:
    C.Check.str("the page is Network", U.Settings.page(network("")), "network")
    C.Check.str("no hub named: no Hub row", has("", "click:desktop-backend"), "False")
    C.Check.str("no hub named: the rest of Network is there", has("", "Tailscale"), "True")
    C.Check.str("the Windows app names its hub: the row says where it runs", has("WSL · Ubuntu", "Runs on WSL · Ubuntu."), "True")
    C.Check.str("and its button goes to the desktop shell", has("WSL · Ubuntu", "click:desktop-backend"), "True")
    C.Check.str("labelled Change…", has("Windows", "Change…"), "True")
    C.Check.str("Settings' search finds Network by wsl", String.join(U.Settings.found(U.Settings.menu.pages(), I.En{}, "wsl"), ","), "network")
