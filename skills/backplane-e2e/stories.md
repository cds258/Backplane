# Backplane user stories (end to end)

What a person does with Backplane, as short stories to drive through the real
UI. Platforms: **W** web page (headless Chromium), **D** desktop app
(Electron, driven over CDP), **A** Android app (emulator), **I** iOS app (only
on a Mac; skip otherwise), **DW** the Windows desktop app with its hub in a
WSL distro (only from inside WSL on Windows, `win.sh`; skip elsewhere). Each step is a press, a key or a gesture; time it
(SKILL.md, "Timing"). The hub is `hub.sh`'s: projects `proj` (the fixture)
and `multi` (boards `alpha`, `beta`, plus an archived copy and a build
snapshot), stand-in agents only.

## Getting started

**S01 First run** (W D A)
Open the hub fresh. The guided tour shows; Skip closes it. Settings → Tour →
Show the tour opens it again; Done closes it and it stays closed after a
reload.

**S02 Add a project** (W D)
Sidebar `+` → enter a folder path (a copy of the fixture) → Add. The project
appears in the sidebar with a new thread selected; pressing Board draws its
board.

**S03 Find a project or conversation** (W D A)
Type part of a project name in the sidebar search: only matching projects
stay; clearing it brings all back. The search icon (Ctrl+Shift+F) finds a
word from an earlier reply; clicking a result opens that thread at that
message, highlighted.

## Talking to an agent

**S04 Send and watch the reply** (W D A)
In `proj`'s thread type a message and press Enter (A: the send button). The
message shows at the end at once, the composer empties, the turn shows as
working, the reply streams in and ends with a "Finished hh:mm · Ns" stamp.

**S05 Stop a turn** (W D A)
Send a message; while the reply streams press Stop. The turn ends as
stopped within 2 s, and the composer takes a new message that then runs.

**S06 Follow-ups while busy** (W D)
Send a message, and while it runs send a second (Send reads "Steer" while a
turn runs). The second is taken at once and answered after the first reply,
which keeps streaming in place (it does not jump). Ctrl+Enter queues it
instead: it waits above the composer, then runs by itself.

**S07 Long history** (W D A)
`hub.sh long` makes an 80-exchange thread. Open it: it opens at the newest
message. Scroll up to the first message ("Question 1") and back down to the
newest: every step moves, nothing jumps, no stall. Scroll halfway up and send
a message: the view goes to the newest page with that message on screen.

**S08 Reading while it streams** (W D)
Send a message; while the reply streams, scroll up a few notches (D: mouse
wheel with smooth scrolling). The view stays where you scrolled, the text
under the pointer does not move. Scroll back to the bottom: it follows the
stream again.

**S09 Thread lifecycle** (W D A)
On a thread: Rename (title updates everywhere), Pin (moves to the top), Settle
(moves under "Settled N"), Unsettle, Snooze 1 h, Fork (a new thread with the
history), Archive, Delete (asks first; the thread goes). Right-click (A: long
press) opens the same menu on a sidebar row.

**S10 Pick the model** (W D A)
Open the model picker under the composer, choose another agent, model and
effort. The chip shows the choice; the next turn runs with it (the stand-in's
log in `hub.log`/its args shows the model).

**S11 Attach a file** (W D)
Attach an image with the paperclip (or drop it on the composer) and send. The
message shows the image; clicking it opens the lightbox; Esc closes it.

**S12 Token stats** (W D)
Settings → Usage → turn Token stats on. The chip beside Send shows tokens,
cost (when known) and context; clicking it opens the panel with the last
turn's and the thread's totals.

## Seeing the design

**S13 Board** (W D A)
Open the Board view: the board draws within 5 s. Fit fits it; the wheel zooms
at the pointer; drag pans. Layers lists KiCad's layers; turning one off hides
it; clicking a layer's name dims the others (high contrast).

**S14 Schematic and its sheets** (W D A)
Open the Schematic: the root sheet draws. Click a sheet symbol: that sheet
opens and the trail shows where you are; Up/Back return to the root.

**S15 3D** (W D A)
Open 3D: the board's model draws; drag turns it, the wheel zooms, Fit
recentres.

**S16 Pick a board** (W D A)
In `multi`, open the board picker: it offers `alpha` and `beta` only (not the
archive copy or the build snapshot), the default first. Pick `beta`: Board,
Schematic and 3D all show `beta`.

**S17 Design history** (W D)
Have the agent change the board (send `mode:toolhold` with a stand-in that
edits, or edit the board file by hand while a turn runs). A step tick appears
on the history bar; Play steps through; Compare shows the change marked.

**S18 Files, Diff, Review** (W D A)
Files lists the project folder; opening a board file shows it in the Board
view. Diff shows the project's changes. Review → BOM lists the parts.

**S19 Viewer layout** (W D)
Drag the viewer's left edge: it resizes and keeps that width after a reload;
a double-click resets it. Close the viewer; open it again from the rail.

## Settings and workspace

**S20 Appearance** (W D A)
Settings → Appearance: switch the theme (applies at once), the text size
(text grows), the language to 日本語 where it is offered (labels change; on
the web it is a preview, opened with `?lang=ja`) and back, and the sidebar
to Active (one list of live threads).

**S21 Folding the sidebars** (W D)
Ctrl+B (Cmd+B) folds the sidebar to a strip and back; the rail's chevron makes
the rail icons only. Both stay after a reload.

**S22 Command palette and shortcuts** (W D)
With a thread open: Ctrl+K opens the palette; typing filters; Enter runs
"New thread". Ctrl+N makes a thread in the open thread's project (with none
open it goes to the uberbot's chat), Ctrl+J opens the floating terminal (it runs `echo hi`), Ctrl+1 jumps
to the first thread, Ctrl+Shift+S settles it.

**S23 API keys** (W D A)
Settings → API keys: add `E2E_KEY` with a value. Only the name is listed,
never the value; Remove deletes it.

**S24 Settings stick** (W D)
Change Threads → notifications and Time zone; reload: both kept.

## Bots and routines

**S25 A bot** (W D)
Bots `+` → make a bot; it appears with its cat. Open it and send a message:
it answers (stand-in). Rooms `+` → make a room, post in it; the post shows.

**S26 A routine** (W D)
Make a routine "in 1 minute: say hello" on a thread. It shows in Routines with
its time in your zone, and fires: the thread gets the message.

## Phone

**S27 Pair a phone** (A)
Open the hub's pairing link (`PAIR` from `hub.sh`) on the phone: it pairs and
lists the projects and threads ("Connected").

**S28 Wrong pairing** (A)
Pair with the link without its token: the banner says "Hub rejected
credentials; check the pairing link", below the status bar; pairing again
with the right link clears it.

**S29 Phone thread** (A)
Open a thread, send a message: it shows at once, the reply streams. Swipe up
through the history and back down; while a reply streams, a swipe up holds.

**S30 Phone viewer** (A)
Open the viewer from a thread: the board draws; pinch zooms; the Sheet menu
picks a schematic sheet and, in `multi`, a board.

## Windows app, hub in WSL

The app is this checkout's, so Windows as the choice has no hub of its own:
it shows the startup error ("Set absolute BACKPLANE_SERVICE…") with Change
hub. `win.sh` prints `HOME_DIR` (the distro hub's home), `PROJ` (the fixture
in the distro) and `WPROJ` (a copy on C:).

**S33 Run the hub in WSL** (DW)
`win.sh start S33`: Windows' startup error with Change hub. Change hub lists
Windows (now) and WSL · <distro>. Pick WSL: "Starting <distro>…", then
"Backplane is not installed in <distro>." with Install and Change hub.
Install: its lines show, then the hub's page (≤ 60 s). The hub is the one in
the distro: `HOME_DIR/hub.lock` names a pid whose command line is the build
under test. Settings → Network: the first row is Hub, "Runs on WSL ·
<distro>.", and its Change… shows the chooser with WSL · <distro> (now);
picking it brings the same hub back.

**S34 Switch with the shortcut** (DW, after S33 in the same app)
Ctrl+Shift+H on the hub's page: the chooser. Pick Windows: its startup
error with Change hub. Ctrl+Shift+H → WSL · <distro>: the hub's page is back
≤ 5 s with the same threads (its hub kept running). `win.sh quit`, then
`win.sh again`: the app opens straight on the hub in WSL.

**S35 Windows folders** (DW)
Sidebar `+`: "Choose folder…" is there (Windows' own dialog, which CDP
cannot press: look once by hand that it opens in the distro user's home).
Type `WPROJ` (`C:\…`) in the field, Go to: the picker lists
`/mnt/c/…/proj`; Add: the project shows with a thread. Type
`\\wsl.localhost\<distro>` + `PROJ` with backslashes and Add: the project
is `PROJ`. `\\wsl.localhost\NoSuchDistro\x` says "not a folder this hub
can open".

**S36 Explorer** (DW)
In the `WPROJ` project's thread send `see <its /mnt/c path>/demo.kicad_pcb`;
right-click the path in the message → Show in folder: a new Explorer window
on the project's folder (`win.sh explorer` lists its LocationURL). Close
exactly that window (`win.sh explorer-close URL`).

**S37 The hub outlives the app** (DW)
Send a message; while it streams, `win.sh quit` (the app's process is
stopped). 5 s later the hub still answers `/hello` with the pid in
`HOME_DIR/hub.lock` from before the quit. `win.sh again`: the hub's page;
the thread holds the message and the reply, finished or still streaming.

**S38 A distro that is gone** (DW)
`win.sh start S38 wsl:NoSuchDistro`: "NoSuchDistro: There is no
distribution with the supplied name." with Retry and Change hub. Change hub
→ WSL · <distro> recovers (Install as in S33).

## Coming back

**S31 Hub restart** (W D A)
With a draft typed (not sent), `hub.sh restart`: the page says Connecting…,
then comes back by itself within 10 s with the draft and the thread intact.

**S32 Reload keeps your place** (W D)
Open a thread, type a draft, open the Schematic. Reload: the same thread,
draft and viewer tab are back.
