# mdgest

## When pdf.js changes

`pdfjs-dist` is part of the reader. When its version changes — an upgrade in
`package.json` or `bun.lock`, or the test *pdf.js is the version READER was
made with* failing — bump `READER` in `src/lib/analysis.ts` and set
`READ_WITH` to the new version, together. Never move `READ_WITH` alone: no
check here says whether blocks moved, so every pdf.js change is taken to
have moved them (docs/storage.md, *pdf.js is part of the reader*).
