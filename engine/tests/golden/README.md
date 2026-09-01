# Golden output

`doc-a.md` and `doc-b.md` are the markdown that `engine/tests/fixtures/`
produces with no edits applied. They are the behavioral contract: whatever the
engine looks like inside, these are the bytes it has to emit.

They were cut from the working implementation on `spike/tauri` at `9d331ed`,
before any of it was carried across, so they describe behavior that was
verified rather than behavior that was assumed. Regenerating them from a new
implementation would prove nothing — that is the one thing not to do with them.

The output is deterministic: the same PDF yields the same bytes on every run
and in every workspace, which is what makes a byte comparison a fair test
rather than a flaky one.

These bytes are still current on this branch: `ops.write_markdown` reproduces
both files exactly at `0d02d29`, four commits after they were cut. Nothing
compares them automatically -- `test_fixtures.py` checks only that they are
present, because the branch they were cut for has no engine to run. Wherever
this corpus lands next, that comparison is the test to write.
