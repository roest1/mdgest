/** What is too large to take, and where these numbers come from.
 *
 * Two different ceilings, and the smaller one is not the disk. OPFS gives an
 * origin a share of the disk -- 60% of it in Chrome, and in Safari since 17;
 * the lesser of 10% and 10 GiB per site in Firefox until persistence is
 * granted -- which on any ordinary machine is tens of gigabytes. Worker
 * memory is what actually runs out first. A zip is inflated whole, so the
 * archive and its entries are two corpus-sized allocations before a byte is
 * staged, against a hard engine limit of 4 GB for any single allocation in
 * Chrome and Safari and a tab budget well under that. A phone runs out in the
 * hundreds of megabytes.
 *
 * Which is why these are fixed rather than a fraction of the quota. Sizing a
 * drop against the quota would be the wrong instrument twice over: it would
 * wave through an archive no tab can inflate, and `estimate()` is padded on
 * purpose -- usage would otherwise be a fingerprint -- so a threshold set
 * close to it is inside its own error bar. The quota is checked separately,
 * at commit, and for headroom rather than for the last byte: `space` in opfs
 * and `commit` in stage.
 */

/** One document. `HASH_WIDTH` of these are resident at once while a drop is
 *  hashed, because Web Crypto has to be handed a whole buffer. */
export const MAX_FILE = 512 * 1024 * 1024;

/** A zip's entries, added up from the central directory before anything is
 *  inflated. The archive itself is about this size again -- a PDF is already
 *  compressed, so a zip of PDFs barely shrinks -- so this is half of what an
 *  archive costs, and the other half is why it is not larger. */
export const MAX_INFLATED = 512 * 1024 * 1024;

/** Files in one archive, counted over the ones `MAX_INFLATED` adds up, and
 *  files in one drop. No byte cap bounds this, because a file can be empty,
 *  and every file is still an allocation -- and every PDF among them a digest
 *  and a row in the listing. Ten thousand is far past a corpus anyone reads
 *  down a listing of. */
export const MAX_ENTRIES = 10_000;

/** Everything in one drop of loose files. Larger than an archive's cap
 *  because these are the browser's own file-backed blobs rather than worker
 *  memory: the bytes arrive a few at a time and leave again. */
export const MAX_DROP = 4 * 1024 * 1024 * 1024;

/** An `mdgest.json`. It carries decisions and never bytes -- a sixty-document
 *  corpus is a few hundred kilobytes, see docs/storage.md -- so a file near
 *  this size is not a manifest. Checked before it is read: decoding it to a
 *  string and parsing that string each cost a multiple of its size, and
 *  otherwise the only ceiling on it would be `MAX_FILE`. */
export const MAX_MANIFEST = 16 * 1024 * 1024;

/** How much room a commit asks for, as a multiple of what it is about to
 *  write. The sources are only the half that arrives: markdown, its figures
 *  and the analysis cache are all derived afterwards, and a figure-heavy
 *  document derives more than it came in as. Committing into the last free
 *  byte would leave a workspace that cannot be opened. */
export const RESERVE = 2;
