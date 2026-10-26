import Base
import ../src/core/links.bend as LK

# The hub's own shell for folders and files, as it runs it. The driver
# (test/tools/wsl_shell.mjs) runs each under sh with a stand-in wslpath and
# explorer.exe first on PATH (a hub in WSL), and with neither (any other hub).

def resolve_sh() -> String:
  LK.Folder.resolve.sh()

def mkdir_sh() -> String:
  LK.Folder.mkdir.sh()

def list_sh() -> String:
  LK.Folder.list.sh()

def open_sh() -> String:
  LK.Link.file.cmd("open")

def reveal_sh() -> String:
  LK.Link.file.cmd("reveal")
