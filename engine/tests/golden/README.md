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

Until the pipeline lands there is nothing to compare them against, so no test
reads them yet. The test arrives with `emit`, which is the first point at which
the engine can produce markdown at all.
