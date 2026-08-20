import type { Block, Role } from "../types";

export const ROLE_LABEL: Record<Role, string> = {
  heading: "Heading",
  para: "Paragraph",
  bullet: "Bullet",
  numbered: "Numbered",
  alpha: "Lettered",
  roman: "Roman",
  image: "Figure",
  insert: "Inserted",
};

/** Colour per role — used by the overlay on the page and the gutter in the panel. */
export function roleColor(b: Block): { border: string; bg: string; text: string; badge: string } {
  if (b.hidden) return { border: "border-stone-600/60", bg: "bg-stone-700/10", text: "text-stone-500", badge: "bg-stone-700 text-stone-300" };
  switch (b.role) {
    case "heading":
      return { border: "border-blue-400/80", bg: "bg-blue-500/10", text: "text-blue-300", badge: "bg-blue-600 text-white" };
    case "bullet":
    case "numbered":
    case "alpha":
    case "roman":
      return { border: "border-emerald-400/70", bg: "bg-emerald-500/10", text: "text-emerald-300", badge: "bg-emerald-600 text-white" };
    case "image":
      return { border: "border-amber-400/80", bg: "bg-amber-500/10", text: "text-amber-300", badge: "bg-amber-500 text-black" };
    case "insert":
      return { border: "border-pink-400/80", bg: "bg-pink-500/10", text: "text-pink-300", badge: "bg-pink-600 text-white" };
    default:
      return { border: "border-stone-300/60", bg: "bg-stone-300/5", text: "text-stone-300", badge: "bg-stone-600 text-white" };
  }
}

export function shapeLabel(b: Block): string {
  if (b.role === "heading") return `H${b.level || 2}`;
  if (b.role === "bullet") return `• d${b.depth}`;
  if (b.role === "numbered") return `1. d${b.depth}`;
  if (b.role === "alpha") return `a. d${b.depth}`;
  if (b.role === "roman") return `i. d${b.depth}`;
  if (b.role === "image") return "fig";
  if (b.role === "insert") return "ins";
  return "¶";
}
