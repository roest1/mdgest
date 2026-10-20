import {
  AlertCircle,
  CheckCircle2,
  File,
  FileText,
  Folder,
  Upload,
} from "lucide-react";
import { Spinner } from "src/components/shared/Spinner";
import { ACCEPT_ATTR, useDropZone } from "./useDropZone";

/** The five visual states, in priority order. One table rather than a parallel
 * ternary chain per property: adding a state is a row here instead of four
 * edits nothing checks stay aligned.
 *
 * `tone` is background only — the dashed border is an SVG rect, and `dash` is
 * its stroke color. `loading` keeps the idle chrome, since a drop in flight
 * is not yet anything. `error` has no label of its own: its message is the
 * hook's. */
const IDLE = {
  icon: Upload,
  icons: "text-muted",
  copy: "text-ink/90",
  label: "Drag and drop, or pick:",
  tone: "bg-raised/40 hover:bg-raised/60",
  halo: "bg-raised/60",
  dash: "text-edge-strong/70",
} as const;

const STATES = {
  loading: { ...IDLE, icon: Spinner, icons: "text-accent", copy: "text-accent", label: "Adding…" },
  error: {
    icon: AlertCircle,
    icons: "text-red-400",
    copy: "text-red-300",
    label: null,
    tone: "bg-red-950/20",
    halo: "bg-red-500/15",
    dash: "text-red-500/60",
  },
  success: {
    icon: CheckCircle2,
    icons: "text-emerald-400",
    copy: "text-emerald-300",
    label: "Added.",
    tone: "bg-emerald-950/20",
    halo: "bg-emerald-500/15",
    dash: "text-emerald-500/60",
  },
  dragging: {
    icon: FileText,
    icons: "text-accent",
    copy: "text-accent",
    label: "Drop PDFs, a zip, or a folder",
    tone: "bg-accent/10",
    halo: "bg-accent/20",
    dash: "text-accent/70",
  },
  idle: IDLE,
} as const;

/** Each control names the dialog it opens *and* what that dialog accepts —
 * the browser gives us no way to filter a folder pick, so "folder of PDFs" is
 * the only place a person learns the folder is walked for PDFs and everything
 * else is dropped.
 *
 * `nudge` exists because neither glyph's interior is centered on its viewBox:
 * the file's folded corner and the folder's tab both sit above the cavity the
 * text goes in, so centering on the box alone rides it too high. The file needs
 * more than the folder because its corner is the deeper intrusion. */
const PICKERS = [
  {
    icon: File,
    label: "File",
    caption: ".pdf · .zip",
    nudge: "translate-y-[10px]",
    open: "file",
  },
  {
    icon: Folder,
    label: "Folder",
    caption: "folder of PDFs",
    nudge: "translate-y-[6px]",
    open: "folder",
  },
] as const;

/** The glyph is the button — there is no chrome around it, so the outline has
 * to carry the whole affordance. It is sized by its *contents*: 96px is what
 * it takes for "folder of PDFs" to sit inside the folder's cavity, which is
 * the widest thing either shape has to hold.
 *
 * The stroke override has to be a class, not lucide's `strokeWidth` prop:
 * index.css sets `svg.lucide { stroke-width: 1.75 }`, and a stylesheet rule
 * beats a presentation attribute however specific the attribute looks. Stroke
 * width is in user units, so it multiplies by 96/24 — 1.75 would paint a 7px
 * slab. Utilities win over the base rule because @layer utilities comes
 * after @layer base. */
const GLYPH = `h-24 w-24 [stroke-width:0.6] text-muted transition-colors
   group-hover:text-accent group-disabled:group-hover:text-muted`;

/** Drop PDFs, zips of PDFs, or whole folders (with PDFs in them).
 *
 * Presentation only — every handler and every piece of state comes from
 * useDropZone.
 */
export function DropZone({
  onFiles,
}: {
  onFiles: (files: File[]) => Promise<void>;
}) {
  const {
    isDragging,
    isLoading,
    error,
    success,
    dropProps,
    fileInputProps,
    dirInputProps,
    openFilePicker,
    openFolderPicker,
  } = useDropZone({ onFiles });

  const s = isLoading
    ? STATES.loading
    : error
      ? STATES.error
      : success
        ? STATES.success
        : isDragging
          ? STATES.dragging
          : STATES.idle;
  const Icon = s.icon;
  const message = s.label ?? error;

  return (
    <div
      {...dropProps}
      aria-busy={isLoading}
      className={`upload-zone relative select-none rounded-xl border-2
        border-transparent px-6 py-8 transition-colors duration-200
        ${s.tone}`}
    >
      {/* -inset-px puts the rect's outer edge on the border box (absolute
          inset-0 would land on the padding box, 2px in), so the 2px stroke
          lands exactly where the CSS border was. rx is 11, not the box's 12,
          because the stroke is centered a pixel inside that outer edge.
          overflow-visible keeps the outer half of the stroke from clipping.

          The explicit size is not redundant with -inset-px: an <svg> is a
          replaced element, so with width/height auto it keeps its intrinsic
          300x150 and ignores the insets rather than stretching to them. 100%
          resolves against the padding box, hence the +2px to reach the
          border box. */}
      <svg
        className="pointer-events-none absolute -inset-px h-[calc(100%+2px)]
          w-[calc(100%+2px)] overflow-visible"
        aria-hidden
      >
        <rect
          className={`dash fill-none ${s.dash}`}
          width="100%"
          height="100%"
          rx="11"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      <input
        {...fileInputProps}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
      />
      <input
        {...dirInputProps}
        type="file"
        multiple
        className="hidden"
        // @ts-expect-error non-standard attribute, no React typing
        webkitdirectory=""
      />

      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full
            transition-colors duration-200 ${s.halo}`}
        >
          <Icon className={`h-6 w-6 ${s.icons}`} aria-hidden />
        </div>

        <div className="min-w-0">
          <p className={`text-xs ${s.copy}`}>{message}</p>
        </div>

        <div className="flex items-start justify-center gap-8">
          {PICKERS.map(({ icon: PickIcon, label, caption, nudge, open }) => (
            <button
              key={open}
              type="button"
              disabled={isLoading}
              onClick={open === "file" ? openFilePicker : openFolderPicker}
              className="group flex cursor-pointer flex-col items-center gap-1
                disabled:cursor-default disabled:opacity-40"
            >
              <span className="relative block">
                <PickIcon className={GLYPH} aria-hidden />
                <span
                  className={`pointer-events-none absolute inset-0 flex flex-col
                    items-center justify-center gap-1 leading-tight ${nudge}`}
                >
                  <span className="text-[11px] font-medium text-ink">
                    {label}
                  </span>
                  <span className="whitespace-nowrap text-[10px] text-faint">
                    {caption}
                  </span>
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
