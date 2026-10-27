import Base
import ./host.bend as H

# Local setup only, on selection/use of an installed runtime. The shared
# service build embeds the pinned payload; ordinary boot and plot parsing
# do not decode it. Returns an error, or "" after activating the process env.
def Library.setup(root: String, home: String, config: String) -> IO(String):
  import "./effects/kicad_library.js"

# Explicit environment for a newly spawned provider. On a setup error it
# clears the bundled path and uses the original profile so repair work stays
# possible without claiming an unvalidated library is active.
def Library.child_env() -> IO(List<&2, String>):
  import "./effects/kicad_library.js"

def Library.env(name: String) -> IO(String):
  do IO<String>:
    r : Result<&1, &1, U32 & String, String> <- IO.get_env(name)
    return Result.default(&1, &1, U32 & String, String, r, "")

def Library.prepare(root: String) -> IO(String):
  do IO<String>:
    +h : String <- Library.env("BACKPLANE_HOME")
    user : String <- Library.env("HOME")
    c : String <- Library.env("KICAD_CONFIG_HOME")
    nr : String <- H.Sys.native_path(root)
    nh : String <- H.Sys.native_path(Bool.pick(String, String.is_empty(h), user ++ "/.backplane-bend", h))
    nc : String <- H.Sys.native_path(c)
    Library.setup(nr, nh, nc)
