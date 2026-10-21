export function Brand() {
  return (
    <header className="flex flex-col items-center gap-2 pb-6 text-center">
      <div className="flex items-center gap-3">
        {/* The outlines in mark.svg were set in Literata 600 at -0.028em, and
            nothing else records that — the wordmark beside it has to match. */}
        <img
          src="/mark.svg"
          alt=""
          width={44}
          height={44}
          className="rounded-[10px] shadow-lg shadow-brand/20"
        />
        <span className="font-serif text-4xl font-semibold tracking-[-0.028em] text-ink">
          mdgest
        </span>
      </div>
      <p className="text-sm text-muted">Turn PDFs into clean Markdown.</p>
    </header>
  );
}
