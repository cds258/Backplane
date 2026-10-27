# Windows

On Windows, Backplane is the Electron desktop app over `backplane-serve.exe`,
the hub as a JS service on Bun ([the JS service](js-service.md)). There is no
C build for Windows and no Cygwin compiler step: the hub is cross-built from
Linux or a Mac in seconds once its JS is emitted.

```sh
BACKPLANE_JS_TARGET=windows-x64 scripts/build-js.sh src/server/main.bend dist/backplane-serve
# writes dist/backplane-serve.exe
```

The hub's files, sockets, processes and terminals go through Bend's JS
runtime, which has no Win32 syscalls yet (fast-hub J4, io_sys): the binary
builds but cannot serve until that lands. CI's `js-native` job runs
`scripts/js-smoke.sh` on `windows-2025` (`--version`, an unknown flag's exit
2, `/hello` on a throwaway home); it reports, and gates once J4 is in. That does not cover the
desktop window, provider logins or an authenticated agent turn; check those by
hand in a Windows guest. Do not treat a Linux build as Windows validation.

Releases go through `scripts/service-release.py js` with target
`windows-x64`: the pinned Bun runtime for Windows, the version and
credentials baked in, and a PE check (x64). Its BUILD.json says
`serviceRuntime: "bun"`. `desktop/produce-release.cjs` takes the service the
same way as on the other targets, as
`resources/backplane-service/backplane-serve.exe`. See
[service releases](service-release.md).

The release's Google client and telemetry key are compiled into a private
prelude of the binary (`scripts/google-header.py`, `scripts/telemetry-header.py`)
and removed after; they never enter the emitted JS or an artifact.
`BACKPLANE_GOOGLE_BAKE=0` bakes none.

The helpers are separate Windows programs, built from Linux with Bun
(`scripts/build-windows-helpers.sh`: `backplane-kipc.exe`,
`backplane-step2glb.exe`, their licenses). CAD on Windows is in
[windows-cad.md](windows-cad.md). `scripts/install-windows-providers.ps1`
installs the Claude and Codex CLIs; `scripts/setup-windows.ps1` installs the
Cygwin shell tools (bash, git, coreutils) that shell commands the hub runs
still expect.

## A hub in WSL

The desktop app can run its hub in a WSL distro instead of its own
(desktop/README.md, "A hub in WSL"). That hub is the Linux install, hub only.
On a hub where `wslpath` answers, a folder given as `C:\…`, `C:/…` or
`\\wsl.localhost\…` is the distro's own path, and one `wslpath` refuses
(another distro's, a share) is "not a folder this hub can open" (links.bend's
`Link.wsl.path.sh`, run first by the folder shell `Folder.*`). Open and Show
in folder hand the file to Windows Explorer, before the `$DISPLAY` check that
WSLg would pass (`Link.file.explorer`); `BACKPLANE_OPEN` still wins.

Measured with WSL 2 in mirrored networking: the app reaches the hub at
127.0.0.1; the hub under the app's detached `wsl.exe` still answers after the
app's process is stopped; Electron reads `hub.lock` and `token` over
`\\wsl.localhost` in 3-4 ms. Windows cannot bind a port in the distro's
ephemeral range (`/proc/sys/net/ipv4/ip_local_port_range`). NAT networking is
untested.
