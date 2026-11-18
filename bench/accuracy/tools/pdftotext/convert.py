"""pdftotext over a job's PDFs: the text layer in reading order, as plain
text. What any converter should beat."""

import pathlib
import subprocess
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent.parent))

from peer import run  # noqa: E402


def version() -> str:
    said = subprocess.run(["pdftotext", "-v"], capture_output=True, text=True)
    return said.stderr.splitlines()[0].removeprefix("pdftotext version ")


def convert(pdf: pathlib.Path) -> tuple[str, int]:
    text = subprocess.run(
        ["pdftotext", "-q", "-enc", "UTF-8", str(pdf), "-"],
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8", "replace")
    # A form feed ends each page.
    return text.replace("\f", "\n\n"), text.count("\f")


if __name__ == "__main__":
    run(version(), convert)
