# Backplane desktop

The Electron shell hosts the existing Bend web client at the standalone service's HTTP origin. Backend state, agents, browser automation and CAD remain in Bend. Electron is pinned to 44.9.2. No live install is changed by these commands.

From the worktree root:

```sh
(cd desktop && npm ci)
bend src/web/index.html -o build/electron-web
python3 scripts/js-unmarshal.py ../core/client.Ui build/electron-web/chunk-*.js
python3 scripts/js-native.py build/electron-web/chunk-*.js
cp src/web/sw.js build/electron-web/sw.js
BACKPLANE_HOME=/tmp/backplane-electron-dev \
BACKPLANE_SERVICE=/absolute/path/to/audited/backplane-serve \
BACKPLANE_WEB="$PWD/build/electron-web" desktop/node_modules/.bin/electron desktop
```

Use a fresh isolated home for development. The service filename must be exactly `backplane-serve` for the audited combined artifact's entry selector. No `--serve` flag exists. Set `BACKPLANE_SERVICE_VERSION` to require an exact greeting version. The service's exclusive home lock remains authoritative; an attached service is never killed by Electron. The service persists independently of desktop quit, reload and renderer crashes. Explicit managed service shutdown is a separate service-owned contract; Windows shutdown remains unqualified.

```sh
node --test desktop/test/*.test.cjs
BACKPLANE_SERVICE=/absolute/path/to/audited/backplane-serve \
BACKPLANE_WEB="$PWD/build/electron-web" node desktop/test/smoke.cjs
```

The smoke uses generated data in a new temporary home and blocked agent binaries. Its screenshots/results go to `build/electron-evidence/`. It does not modify live mail routing or copy the user's log/profile. See `docs/electron/parity.md` for incomplete coverage. Root alone installs/publishes the accepted product.

The desktop shows its local connection page before probing the service or reading any service history. That page has no folder/privileged IPC access. It loads the authenticated service UI once ready. Normal window close exits the Electron UI and leaves the resident Bend service running. Test harnesses must explicitly clean up only their own captured native child; production shutdown must use the approved separate protocol.

Focused lifecycle checks:

```sh
node desktop/test/lifecycle.cjs
BACKPLANE_SERVICE=/absolute/path/to/audited/backplane-serve \
BACKPLANE_WEB="$PWD/build/electron-web" node desktop/test/persistence.cjs
```

The delayed-service test is a startup-window fixture. The Linux persistence test launches the actual service, captures its native child identity through the owning Electron process, and verifies service-owned work completes after the UI exits. Neither qualifies Windows paths, DLL closure or shutdown.

A Linux review stage uses an exact matching standalone service and emitted web:

```sh
node desktop/stage-linux.cjs /absolute/backplane-serve /absolute/matching/web EXACT_VERSION /absolute/new-stage
BACKPLANE_HOME=/absolute/isolated/home /absolute/new-stage/backplane-electron
```

The stage includes the pinned Electron distribution and its notices, a strict shell file list, the index's emitted web assets, and the approved service. Its member hashes are in `MANIFEST.json`; `runtime/resources/backplane-service/BUILD.json` binds the service greeting version and optional source tree. It contains no user home, profile, fonts or experiments. Root selects the production home and performs the final install/rollback; this tool only assembles a new directory.

The minimal Mailroom packet preserves the existing Browser baseline. Direct Browser guests and full desktop parity are separate work. Quiet Mailroom acceptance requires the successor that separates human mailbox RPCs from `mail.on`; the old service cannot prove it. Never enable live automation to bypass that dependency. The smoke defaults to automation OFF and requires an exact `BACKPLANE_SERVICE_VERSION` for a successor.

The stable four-target artifact producer and standalone web adapter are callable;
see [RELEASE-PRODUCER.md](RELEASE-PRODUCER.md) for exact inputs, commands and
qualification boundaries. Local stage-linux.cjs remains a review tool.

## A hub in WSL (Windows)

The Windows app can use the hub inside a WSL distro instead of its own.
Settings → Network → Hub → Change… (also Ctrl+Shift+H, and Change hub on the
startup screen) leaves the hub's page for the startup screen's chooser:
Windows and each WSL distro, listed only then (docker's and rancher's left
out). The choice is one line in `<BACKPLANE_HOME>\electron-profile\backend`,
`windows` or `wsl:<distro>`, written by `main.cjs` alone. A hub in WSL is found
by its `hub.lock` and `token` read over `\\wsl.localhost` (`wsl.cjs`'s probe
starts the distro and makes the home inside it), started as a detached
`wsl.exe -d <distro> … backplane-serve --foreground` that outlives the app
(its output in `<home>/desktop-hub.log`), and accepted at any version. A
distro with nothing installed offers Install: the release's installer for the
app's own version, hub only, into `~/.local/share/backplane`.

A checkout's app, or any app given `BACKPLANE_HOME`, is isolated: it must also
name the hub's home and install folder inside the distro, and refuses the live
ones:

```sh
BACKPLANE_WSL_HOME=/tmp/bp-wsl/home BACKPLANE_WSL_PREFIX=/tmp/bp-wsl/prefix
BACKPLANE_WSL_INSTALLER=/tmp/bp-wsl/install.sh   # optional: what Install runs instead of the release's installer
```

`skills/backplane-e2e/win.sh` sets these up from inside the distro and runs
the app in the Windows Electron (stories S33-S38).
