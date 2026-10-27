#!/bin/sh
# The Windows desktop app from this checkout with its hub in this WSL distro,
# for the DW stories (stories.md). Run it inside the distro on a Windows host:
# the app is the real Windows Electron, started through PowerShell and driven
# over CDP from here (WSL reaches Windows' 127.0.0.1). Every home is the
# story's own: a Windows temp home, and from hub.sh prep a distro home, an
# install prefix and stand-in agents. Install runs an installer that puts the
# build under test into that prefix. Never ~/.backplane-bend,
# ~/.local/share/backplane, ~/.local/bin or %USERPROFILE%\.backplane-bend.
#
#   win.sh start NAME [TOKEN]  the app on a fresh story (its Windows folder made
#                              anew); TOKEN ("windows" or
#                              "wsl:<distro>") is saved as its choice first
#                              (none: a fresh app, on Windows). Prints shell
#                              lines CDP= WINPID= WIN_HOME= HOME_DIR= PREFIX=
#                              PROJ= WPROJ= (a copy of PROJ on C:) DISTRO=
#   win.sh again NAME          the app again on the same homes; prints the same
#   win.sh keys NAME KEYS      real keys to the app's window (SendKeys syntax:
#                              '^+h' is Ctrl+Shift+H); CDP's key events never
#                              reach the app's own shortcuts
#   win.sh quit NAME           stop the app: the Windows PID it started, nothing
#                              else; the hub it started keeps running
#   win.sh stop NAME           quit, then stop the hub the app started (the pid
#                              in the story's hub.lock, only when its command
#                              line names that home)
#   win.sh explorer            every open Explorer window: its LocationURL, a
#                              tab, the paths selected in it
#   win.sh explorer-close URL  close the one Explorer window at that URL
#
# BP_E2E_BIN, BP_E2E_WEB, BP_E2E_FIXTURE, BP_E2E_ROOT  as hub.sh
# BP_E2E_ELECTRON  Windows electron.exe 44.9.2 (default
#                  %TEMP%\bp-wsl-test\electron\electron.exe; fetched and
#                  checked against Electron's SHASUMS256.txt when missing)
set -eu
here=$(cd "$(dirname "$0")" && pwd)
repo=$(cd "$here/../.." && pwd)
cmd=${1:-}; name=${2:-default}
ps() { powershell.exe -NoProfile -NonInteractive -Command "$1" | tr -d '\r'; }

case $cmd in
  explorer)
    ps '$s=New-Object -ComObject Shell.Application; foreach($w in @($s.Windows())){ try{ $w.LocationURL + [char]9 + (($w.Document.SelectedItems() | ForEach-Object { $_.Path }) -join ";") }catch{} }'
    exit 0 ;;
  explorer-close)
    url=${2:?URL}
    case $url in *"'"*) echo "a URL with a quote" >&2; exit 2 ;; esac
    ps "\$s=New-Object -ComObject Shell.Application; foreach(\$w in @(\$s.Windows())){ try{ if(\$w.LocationURL -eq '$url'){ \$w.Quit() } }catch{} }"
    exit 0 ;;
  start|again|keys|quit|stop) ;;
  *) sed -n '2,32p' "$0"; exit 2 ;;
esac

distro=${WSL_DISTRO_NAME:?run this inside the WSL distro the app should use}
root=${BP_E2E_ROOT:-${TMPDIR:-/tmp}/bp-e2e}/$name
bin=${BP_E2E_BIN:-$repo/dist/backplane-serve}
web=${BP_E2E_WEB:-$(dirname "$bin")/web}
temp=$(wslpath -u "$(ps '[IO.Path]::GetTempPath().TrimEnd([char]92)')")
win=$temp/bp-e2e-win/$name
electron=${BP_E2E_ELECTRON:-$temp/bp-wsl-test/electron/electron.exe}
ver=44.9.2

electron_exe() { # the pinned Windows Electron, checked before first use
  [ -f "$electron" ] && return 0
  d=$(dirname "$(dirname "$electron")"); zip=electron-v$ver-win32-x64.zip
  mkdir -p "$d"
  curl -fsSL -o "$d/SHASUMS256.txt" "https://github.com/electron/electron/releases/download/v$ver/SHASUMS256.txt"
  curl -fsSL -o "$d/$zip" "https://github.com/electron/electron/releases/download/v$ver/$zip"
  want=$(grep " \*$zip\$" "$d/SHASUMS256.txt" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$(sha256sum "$d/$zip" | cut -d' ' -f1)" = "$want" ] || { echo "$zip does not match SHASUMS256.txt" >&2; exit 1; }
  python3 -I -c 'import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$d/$zip" "$(dirname "$electron")"
}

app_files() { # the app as packaging takes it (prepare-components.cjs), and ws
  rm -rf "$win/app" && mkdir -p "$win/app/node_modules"
  ( cd "$repo/desktop" && node -e "process.stdout.write(require('./prepare-components.cjs').appFiles('.').join('\n') + '\n')" ) |
    while IFS= read -r f; do mkdir -p "$win/app/$(dirname "$f")"; cp "$repo/desktop/$f" "$win/app/$f"; done
  cp -R "$repo/desktop/node_modules/ws" "$win/app/node_modules/ws"
}

installer() { # what Install runs here: the build under test into the story's prefix, with stand-in agents
  [ -x "$bin" ] && [ -d "$web" ] || { echo "no hub build at $bin with web/ beside it (set BP_E2E_BIN)" >&2; exit 1; }
  cat > "$root/install.sh" <<EOF
set -eu
p=\$BACKPLANE_PREFIX
[ "\$p" = "$root/prefix" ] || { echo "refusing to install outside $root/prefix: \$p"; exit 1; }
echo "Installing the build under test into \$p"
mkdir -p "\$p"; rm -rf "\$p/web" "\$p/backplane-serve.real"
cp "$bin" "\$p/backplane-serve.real"; cp -R "$web" "\$p/web"
cat > "\$p/backplane-serve" <<'W'
#!/bin/sh
exec env HOME="$root/userhome" PATH="$root/fake:\$PATH" DISPLAY= WAYLAND_DISPLAY= BACKPLANE_NO_UPDATE=1 BACKPLANE_PEERS= \\
  BACKPLANE_AGENTS="$root/fake" BACKPLANE_VAULT_KEYRING=file BP_STANDIN_MODE=stream BP_STREAM_N=60 BP_STREAM_MS=50 \\
  "$root/prefix/backplane-serve.real" "\$@"
W
chmod +x "\$p/backplane-serve"
echo "Installed"
EOF
}

launch() {
  # the CDP port is Windows' choice: with mirrored networking Windows cannot
  # bind a port in the distro's ephemeral range
  set -- $(ps "\$l=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0); \$l.Start(); \$port=\$l.LocalEndpoint.Port; \$l.Stop();
    \$env:BACKPLANE_HOME='$(wslpath -w "$win/home")'; \$env:BACKPLANE_WSL_HOME='$root/home'; \$env:BACKPLANE_WSL_PREFIX='$root/prefix';
    \$env:BACKPLANE_WSL_INSTALLER='$root/install.sh'; Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue;
    \$p=Start-Process -PassThru -FilePath '$(wslpath -w "$electron")' -ArgumentList \"--remote-debugging-port=\$port\",'\"$(wslpath -w "$win/app")\"'; \"\$(\$p.Id) \$port\"")
  winpid=${1:-}; port=${2:-}
  case $winpid$port in ''|*[!0-9]*) echo "the app did not start: $*" >&2; exit 1 ;; esac
  echo "$winpid" > "$win/winpid"; echo "$port" > "$win/cdp"
  i=0; until curl -s -o /dev/null "http://127.0.0.1:$port/json/version"; do
    i=$((i+1)); [ $i -lt 150 ] || { echo "no CDP on $port from Windows PID $winpid" >&2; exit 1; }; sleep 0.2; done
  # Windows paths quoted, so the lines can be sourced
  printf "CDP=http://127.0.0.1:%s\nWINPID=%s\nWIN_HOME='%s'\nHOME_DIR=%s\nPREFIX=%s\nPROJ=%s\nWPROJ='%s'\nDISTRO=%s\n" \
    "$port" "$winpid" "$(wslpath -w "$win/home")" "$root/home" "$root/prefix" "$root/proj" "$(wslpath -w "$win/proj")" "$distro"
}

quit() { # the captured Windows PID, and only it
  [ -f "$win/winpid" ] || return 0
  p=$(cat "$win/winpid")
  ps "Stop-Process -Id $p -ErrorAction SilentlyContinue; try { Wait-Process -Id $p -Timeout 15 -ErrorAction Stop } catch {}"
  rm -f "$win/winpid" "$win/cdp"
}

stop_hub() { # the hub the app started: the pid in the story's own lock, checked like hub.sh
  [ -f "$root/home/hub.lock" ] || return 0
  read -r p _ < "$root/home/hub.lock"
  case "$(tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null)" in *"--home $root/home "*) kill "$p" ;; esac
  i=0; while kill -0 "$p" 2>/dev/null && [ $i -lt 50 ]; do sleep 0.1; i=$((i+1)); done
}

case $cmd in
  start)
    [ ! -e "$root/home/hub.lock" ] || { echo "already set up: $root (win.sh stop $name, then remove it)" >&2; exit 1; }
    "$here/hub.sh" prep "$name" > /dev/null
    rm -rf "$win"
    electron_exe; app_files; installer
    mkdir -p "$win/home/electron-profile" "$win/proj"
    cp "$root/proj"/* "$win/proj/"
    [ -z "${3:-}" ] || printf '%s\n' "$3" > "$win/home/electron-profile/backend"
    launch ;;
  again) launch ;;
  keys)
    keys=${3:?KEYS}
    case $keys in *"'"*) echo "keys with a quote" >&2; exit 2 ;; esac
    ps "Add-Type -AssemblyName Microsoft.VisualBasic; Add-Type -AssemblyName System.Windows.Forms;
      [Microsoft.VisualBasic.Interaction]::AppActivate($(cat "$win/winpid")); Start-Sleep -Milliseconds 300; [System.Windows.Forms.SendKeys]::SendWait('$keys')" ;;
  quit) quit ;;
  stop) quit; stop_hub ;;
esac
