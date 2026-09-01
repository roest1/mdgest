"""The fixture corpus is generated, and the generator has to be reproducible.

`make_fixtures.py` claims byte-for-byte determinism so that a regenerated
fixture only shows up in `git status` when the generator actually changed. If
that stops being true, every test that selects a block by its wording starts
failing for reasons unrelated to what it was checking.
"""

import subprocess
import sys
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"


def test_the_generator_reproduces_the_committed_fixtures(tmp_path):
    before = {p.name: p.read_bytes() for p in sorted(FIXTURES.glob("*.pdf"))}
    assert before, "no fixtures committed"

    subprocess.run(
        [sys.executable, str(FIXTURES / "make_fixtures.py")],
        cwd=FIXTURES,
        check=True,
        capture_output=True,
    )
    after = {p.name: p.read_bytes() for p in sorted(FIXTURES.glob("*.pdf"))}

    assert after == before, "regenerating the fixtures changed them"


def test_the_golden_output_is_committed():
    """The behavioral contract has to be present before anything claims to
    satisfy it. It was cut from a working implementation; regenerating it from
    a new one would prove nothing."""
    golden = Path(__file__).parent / "golden"
    cut = [p for p in golden.glob("*.md") if p.name != "README.md"]
    assert {p.stem for p in cut} == {p.stem for p in FIXTURES.glob("*.pdf")}
    assert all(p.stat().st_size > 0 for p in cut)
