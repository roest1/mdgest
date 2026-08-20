import { ArrowDownToLine, ArrowUpToLine, Bold, CornerDownLeft, Eraser, IndentDecrease, IndentIncrease, Italic, Merge, Scissors, Stamp, Trash2, Undo2 } from "lucide-react";
import { useEffect, useState } from "react";
import { findBlock, useStore } from "../store";
import type { Role } from "../types";
import { ROLE_LABEL } from "../lib/roles";

/**
 * A contextual tool: floats over the panes when a block is selected — on the
 * page or in the panel — and acts on it. Every button has a key so the fast
 * path is click a box, tap a key.
 */
export function ShapeBar() {
  const activeDoc = useStore((s) => s.activeDoc);
  const view = useStore((s) => (activeDoc ? s.docs[activeDoc] : undefined));
  const selection = useStore((s) => s.selection);
  const selected = useStore((s) => s.selected);
  const patchBlockOne = useStore((s) => s.patchBlock);
  const patchMany = useStore((s) => s.patchBlocks);
  const group = selected.length > 1 ? selected : selection ? [selection] : [];
  const patchBlock = (id: string, fields: Parameters<typeof patchBlockOne>[1]) =>
    group.length > 1 && group.includes(id) ? patchMany(group, fields) : patchBlockOne(id, fields);
  const resetBlock = useStore((s) => s.resetBlock);
  const moveBlock = useStore((s) => s.moveBlock);
  const joinBlock = useStore((s) => s.joinBlock);
  const splitBlock = useStore((s) => s.splitBlock);
  const busy = useStore((s) => s.busy);
  const found = findBlock(view, selection);
  const [moveTo, setMoveTo] = useState("");

  useEffect(() => setMoveTo(found ? String(found.block.n) : ""), [found?.block.id, found?.block.n]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!found) return null;
  const b = found.block;
  const page = view!.pages[found.pageIndex];
  const prev = page.blocks[page.blocks.findIndex((x) => x.id === b.id) - 1];
  const isList = ["bullet", "numbered", "alpha", "roman"].includes(b.role);
  const setRole = (role: Role, extra: Record<string, unknown> = {}) => patchBlock(b.id, { role, ...extra } as never);
  const Btn = ({ on, onClick, title, children, disabled }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) => (
    <button className={`btn btn-sm ${on ? "btn-active" : ""}`} onClick={onClick} title={title} disabled={disabled || busy}>
      {children}
    </button>
  );
  // the markdown's own glyphs, set in the mono so they read as a family
  const Glyph = ({ on, onClick, title, children, disabled }: { on?: boolean; onClick: () => void; title: string; children: React.ReactNode; disabled?: boolean }) => (
    <button className={`btn font-mono w-7 h-7 !p-0 justify-center ${on ? "btn-active" : ""}`} onClick={onClick} title={title} disabled={disabled || busy}>
      {children}
    </button>
  );

  return (
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-30 max-w-[min(96%,1080px)] animate-fade-in">
      <div className="glass rounded-xl shadow-2xl shadow-black/50 px-2 py-1.5 flex items-center gap-1 overflow-x-auto whitespace-nowrap">
        <span className="text-[11px] font-mono text-muted mr-1 shrink-0">
          p{b.page}{" "}
          {group.length > 1 ? (
            <span className="text-ink">{group.length} selected</span>
          ) : (
            <>
              <span className="text-ink">#{b.n}</span> <span className="text-faint">{b.id}</span>
            </>
          )}
        </span>
        {b.kind !== "image" && b.kind !== "insert" && (
          <>
            <span className="w-px h-5 bg-edge mx-1 shrink-0" />
            {[1, 2, 3, 4].map((l) => (
              <Glyph key={l} on={b.role === "heading" && b.level === l} onClick={() => setRole("heading", { level: l })} title={`Heading ${l} (${l})`}>
                H{l}
              </Glyph>
            ))}
            <Glyph on={b.role === "para"} onClick={() => setRole("para")} title="Paragraph (p)">
              ¶
            </Glyph>
            <span className="w-px h-5 bg-edge mx-1 shrink-0" />
            <Glyph on={b.role === "bullet"} onClick={() => setRole("bullet")} title="Bullet (-)">
              •
            </Glyph>
            <Glyph on={b.role === "numbered"} onClick={() => setRole("numbered")} title="Numbered 1. 2. 3. (n)">
              1.
            </Glyph>
            <Glyph on={b.role === "alpha"} onClick={() => setRole("alpha")} title="Lettered a. b. c. (a)">
              a.
            </Glyph>
            <Glyph on={b.role === "roman"} onClick={() => setRole("roman")} title="Roman i. ii. iii. (r)">
              i.
            </Glyph>
            <Btn onClick={() => patchBlock(b.id, { depth: Math.max(0, (b.depth || 0) - 1) })} title="Outdent ([)" disabled={!isList || !b.depth}>
              <IndentDecrease className="w-3.5 h-3.5" />
            </Btn>
            <span className="text-[11px] text-muted font-mono w-4 text-center shrink-0">{isList ? b.depth : ""}</span>
            <Btn onClick={() => patchBlock(b.id, { depth: (b.depth || 0) + 1 })} title="Indent (])" disabled={!isList}>
              <IndentIncrease className="w-3.5 h-3.5" />
            </Btn>
            <span className="w-px h-5 bg-edge mx-1 shrink-0" />
            <Btn on={b.bold} onClick={() => patchBlock(b.id, { bold: !b.bold })} title="Bold (b)">
              <Bold className="w-3.5 h-3.5" />
            </Btn>
            <Btn on={b.italic} onClick={() => patchBlock(b.id, { italic: !b.italic })} title="Italic (i)">
              <Italic className="w-3.5 h-3.5" />
            </Btn>
          </>
        )}
        <span className="w-px h-5 bg-edge mx-1 shrink-0" />
        <Btn on={!!b.break_before} onClick={() => patchBlock(b.id, { break_before: !b.break_before })} title="Page break (---) before this block (<)">
          <ArrowUpToLine className="w-3.5 h-3.5" />
        </Btn>
        <Btn on={!!b.break_after} onClick={() => patchBlock(b.id, { break_after: !b.break_after })} title="Page break (---) after this block (>)">
          <ArrowDownToLine className="w-3.5 h-3.5" />
        </Btn>
        <span className="w-px h-5 bg-edge mx-1 shrink-0" />
        <Btn on={!!b.hidden} onClick={() => patchBlock(b.id, { hidden: !b.hidden })} title={b.hidden ? "Restore (h)" : "Delete from the markdown — the page keeps it, struck through (h)"}>
          {b.hidden ? <Undo2 className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
          {b.hidden ? " restore" : ""}
        </Btn>
        {b.kind === "text" && prev && prev.kind === "text" && (
          <Btn onClick={() => joinBlock(b.id, prev.id)} title={`Join onto #${prev.n} (the block before it)`}>
            <Merge className="w-3.5 h-3.5" /> join ↑
          </Btn>
        )}
        {b.joined && b.joined.length > 0 && (
          <Btn onClick={() => splitBlock(b.joined![b.joined!.length - 1])} title="Split the last joined block back out">
            <Scissors className="w-3.5 h-3.5" /> split
          </Btn>
        )}
        <span className="w-px h-5 bg-edge mx-1 shrink-0" />
        <form
          className="flex items-center gap-1 shrink-0"
          onSubmit={(e) => {
            e.preventDefault();
            const n = parseInt(moveTo, 10);
            if (n && n !== b.n) moveBlock(group.length > 1 ? group : b.id, { to: n });
          }}
        >
          <span className="text-[11px] text-faint">move to</span>
          <input value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="w-10 bg-ground border border-edge rounded px-1 py-0.5 text-[11px] font-mono text-center text-ink outline-none focus:border-blue-500" />
          <button className="btn btn-icon" type="submit" title="Move to this number" disabled={busy}>
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </form>
        {b.edited && (
          <Btn onClick={() => resetBlock(b.id)} title="Forget the overrides on this block">
            <Eraser className="w-3.5 h-3.5" /> reset
          </Btn>
        )}
        <span className="text-[11px] text-faint shrink-0 pl-2 flex items-center gap-1">
          {b.rule && (
            <span className="text-amber-300/90 flex items-center gap-0.5" title={`shaped by a learned rule in ${b.rule.folder || "the workspace"}: ${b.rule.key}`}>
              <Stamp className="w-3.5 h-3.5" /> rule
            </span>
          )}
          {ROLE_LABEL[b.role]}{b.edited ? " · edited" : ""}{b.origin === "person" ? " · not on the page" : ""}
        </span>
      </div>
    </div>
  );
}
