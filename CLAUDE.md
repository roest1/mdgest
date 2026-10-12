# mdgest

## When pdf.js changes

`pdfjs-dist` is part of the reader. When its version changes — an upgrade in
`package.json` or `bun.lock`, or the test *pdf.js is the version READER was
checked against* failing — do not just move `READ_WITH` up to make it pass.
Follow docs/storage.md, *pdf.js is part of the reader*: find out whether any
block moved, merged or split under the new version, bump `READER` in
`src/lib/analysis.ts` if one did, and only then set `READ_WITH` to the new
version. Say which it was, and on what evidence.
