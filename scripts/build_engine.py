"""Package the engine into the desktop app's sidecar binary.

    uv run --project engine --extra build python scripts/build_engine.py

PyInstaller, one file, entry = the full mdgest CLI (so the same binary that
serves the desktop app is also the CLI on machines with no Python). The traps
this script exists to step around:

- pdfium is a shared library loaded through ctypes: the dependency analyzer
  cannot see it, so pypdfium2_raw is collected wholesale;
- uvicorn resolves its event loop and protocol classes from import strings,
  so its submodules are collected wholesale;
- starlette imports python-multipart lazily, on the first multipart form.

The output lands where tauri's bundle.externalBin expects it:
src-tauri/binaries/mdgest-engine-<target triple>[.exe].
"""

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "engine"
WORK = ENGINE / ".pyinstaller"


def target_triple() -> str:
    out = subprocess.run(["rustc", "-vV"], capture_output=True, text=True, check=True).stdout
    for line in out.splitlines():
        if line.startswith("host: "):
            return line.split()[1]
    raise SystemExit("could not read the target triple from `rustc -vV`")


def main() -> None:
    WORK.mkdir(exist_ok=True)
    entry = WORK / "entry.py"
    entry.write_text("from mdgest.cli import main\n\nmain()\n")
    subprocess.run(
        [
            sys.executable,
            "-m",
            "PyInstaller",
            "--onefile",
            "--clean",
            "--noconfirm",
            "--name",
            "mdgest-engine",
            "--distpath",
            str(WORK / "dist"),
            "--workpath",
            str(WORK / "build"),
            "--specpath",
            str(WORK),
            "--collect-all",
            "pypdfium2_raw",
            "--collect-all",
            "pypdfium2",
            "--collect-submodules",
            "uvicorn",
            "--hidden-import",
            "python_multipart",
            "--hidden-import",
            "multipart",
            str(entry),
        ],
        check=True,
        cwd=ENGINE,
    )
    exe = ".exe" if sys.platform == "win32" else ""
    built = WORK / "dist" / f"mdgest-engine{exe}"
    dest = ROOT / "src-tauri" / "binaries" / f"mdgest-engine-{target_triple()}{exe}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(built, dest)
    print(f"{dest}  ({dest.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
