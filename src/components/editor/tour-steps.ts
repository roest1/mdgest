import type { Edits } from "src/lib/edits";
import { useEditor, type Boxes } from "src/lib/store";
import { TOUR_DOC } from "src/lib/tour-doc";

/** The walkthrough's script: each step's words, what it points at, where
 *  the words sit, and what it waits for. The drawing of it lives in
 *  `Tour.tsx`; this is the part that changes when the tour does.
 *
 * The example never changes, so where each callout sits is written down
 * here, as an offset from the thing it points at, and so is whether it
 * sits on paper or on a pane. */

export interface State {
  /** How many blocks are selected in the example, and which was clicked
   *  last. */
  selected: number;
  focus: string | null;
  boxes: Boxes;
  notes: boolean;
  /** The example's edits, for the steps that ask for one. */
  edits: Edits | null;
}

export interface Actions {
  select: (ids: string[]) => void;
  clear: () => void;
  boxes: (boxes: Partial<Boxes>) => void;
  notes: (on: boolean) => void;
}

/** Where a step's callout sits, relative to the thing: on the `side` of it,
 *  `dx` out from that edge and `dy` down from its top; and how the arrow
 *  arrives -- at the near side, over the top and down, under and up, or
 *  dropped from words that sit above it. A drop ignores `side`: the words
 *  start `dx` along from the thing's left edge. */
export interface Spot {
  side: "left" | "right";
  dx: number;
  dy: number;
  arrow: "side" | "over" | "under" | "drop";
}

export interface Step {
  /** The handwritten words beside the arrow: a few, never a sentence. */
  callout: string;
  /** What the arrow points at, given the example's blocks in order. */
  anchor: (order: string[]) => string | null;
  /** Something beside the thing that the spotlight takes in too. */
  also?: string;
  spot: Spot;
  /** Whether the callout sits on the page (white) or on a pane (dark). */
  paper: boolean;
  /** Whether the thing has an index note hanging off its corner, which
   *  the spotlight then takes in. */
  noted?: boolean;
  /** Whether the spotlight takes in the words and the arrow as well as the
   *  thing, and dims the rest harder: for the small controls on the dock
   *  and the header, too small a light to find alone, and on panes too
   *  dark for a light dimming to show. */
  wide?: boolean;
  /** Whether the block tools float during the step. They hide for the
   *  rest: a bar rising over the panes would cover what those point at. */
  tools?: boolean;
  /** Put the example in the state the step talks about. */
  prepare?: (order: string[], act: Actions) => void;
  /** When true, the step is done. */
  done?: (state: State) => boolean;
  /** When true, the person did something else -- a plain click where a
   *  ctrl-click was asked for -- and the step sets itself up again, and
   *  says `hint` instead of its callout from then on. */
  reset?: (state: State, order: string[]) => boolean;
  hint?: string;
  /** How long the step shows, in ms, once its arrow is drawn. A step with
   *  neither `done` nor `after` would never end. */
  after?: number;
}

const block = (order: string[], i: number) =>
  order[i] ? `[data-block="${CSS.escape(order[i])}"]` : null;

/** The example's first paragraph, for the edit steps to work on: the role
 *  glyphs only show for text, and a paragraph turning into a heading is
 *  a change anyone can see. */
function para(): string | null {
  const reading = useEditor.getState().readings[TOUR_DOC];
  if (reading?.status !== "ready") return null;
  for (const page of reading.analysis.pages)
    for (const b of page.blocks)
      if (b.kind === "text" && b.role === "para") return b.id;
  return null;
}

const beside: Spot = { side: "right", dx: 90, dy: -14, arrow: "side" };
/** Above the dock, over the markdown pane's last lines, with the arrow
 *  coming down onto the toggle. */
const inDock: Spot = { side: "left", dx: 60, dy: -58, arrow: "over" };
/** Right above the toggle, and so over the right of the markdown pane,
 *  which is empty more often than its left: an image there would sit
 *  under the words of `inDock`. The block tools' buttons sit in the same
 *  place, floating where the dock is docked, and take the same spot. */
const overDock: Spot = { side: "right", dx: -40, dy: -84, arrow: "drop" };

export const STEPS: Step[] = [
  {
    callout: "click a block",
    anchor: (order) => block(order, 0),
    spot: { side: "right", dx: 90, dy: -4, arrow: "side" },
    paper: true,
    noted: true,
    prepare: (_order, act) => {
      act.clear();
      act.boxes({ text: true, images: true });
    },
    done: ({ selected }) => selected > 0,
  },
  {
    callout: "and the markdown follows",
    anchor: () => '[data-tour="selected"]',
    // Far enough left to sit on the page, clear of the divider.
    spot: { side: "left", dx: 150, dy: -6, arrow: "side" },
    paper: true,
    noted: true,
    // Whatever was clicked, the arrow needs a selection to land on.
    prepare: (order, act) => {
      if (useEditor.getState().selection?.docId !== TOUR_DOC) act.select([order[0]]);
    },
    after: 2500,
  },
  {
    callout: "shift-click for a range",
    hint: "hold shift, then click",
    anchor: (order) => block(order, 2),
    spot: beside,
    paper: true,
    noted: true,
    prepare: (order, act) => act.select([order[0]]),
    done: ({ selected }) => selected > 1,
    // A click without shift moves the one selected block instead of
    // ranging from it. Back to the first block, and say how.
    reset: ({ selected, focus }, order) => selected === 1 && focus !== order[0],
  },
  {
    callout: "ctrl-click adds one",
    hint: "hold ctrl, then click",
    anchor: (order) => block(order, 4),
    spot: beside,
    paper: true,
    noted: true,
    prepare: (order, act) => act.select(order.slice(0, 3)),
    done: ({ selected }) => selected === 4,
    // A plain click leaves one; a ctrl-click on a selected block leaves
    // two; a shift-click leaves five. Back to three, and try again.
    reset: ({ selected }) => selected !== 3 && selected !== 4,
  },
  {
    // The selection stays as the person made it: the boxes going off
    // shows what selection looks like without them.
    callout: "turn off the text boxes",
    wide: true,
    anchor: () => '[data-tour="boxes-text"]',
    spot: overDock,
    paper: false,
    done: ({ boxes }) => !boxes.text,
  },
  {
    callout: "and the image boxes",
    wide: true,
    anchor: () => '[data-tour="boxes-images"]',
    spot: overDock,
    paper: false,
    // Back on, in case the last step's click landed here instead.
    prepare: (_order, act) => act.boxes({ images: true }),
    done: ({ boxes }) => !boxes.images,
  },
  {
    callout: "and the indices",
    wide: true,
    anchor: () => '[data-tour="indices"]',
    spot: inDock,
    paper: false,
    prepare: (_order, act) => act.notes(true),
    done: ({ notes }) => !notes,
  },
  {
    // Last of the page steps, so the ones before it have a selection to
    // show. The cross, not Escape: Escape would end the tour as well.
    callout: "clear the selection",
    anchor: () => '[data-tour="clear"]',
    // And what it clears, so the light shows what the cross is about.
    also: '[data-tour="selection"]',
    // On the dock, in the space right of the cross, with the arrow straight
    // across: one coming down would land on the page's bottom edge.
    spot: { side: "right", dx: 64, dy: -2, arrow: "side" },
    paper: false,
    wide: true,
    // The cross is only there while something is selected.
    prepare: (order, act) => {
      if (useEditor.getState().selection?.docId !== TOUR_DOC) act.select([order[0]]);
    },
    done: ({ selected }) => selected === 0,
  },
  {
    // The edit steps. A selection of text brings the tools up; the step
    // selects for the person, and only says what appeared.
    callout: "select text and the tools rise",
    anchor: () => '[data-tour="tools"]',
    spot: { side: "right", dx: 120, dy: -72, arrow: "drop" },
    paper: false,
    wide: true,
    tools: true,
    prepare: (_order, act) => {
      const id = para();
      if (id) act.select([id]);
    },
    after: 2500,
  },
  {
    // One of the roles stands for all of them: the rest of the bar reads
    // the same way, and every tool says what it is under the pointer.
    callout: "make it a heading",
    anchor: () => '[data-tour="tool-h2"]',
    spot: overDock,
    paper: false,
    wide: true,
    tools: true,
    prepare: (_order, act) => {
      const id = para();
      if (id) act.select([id]);
    },
    done: ({ edits }) => {
      const id = para();
      return id !== null && edits?.blocks[id]?.role === "heading";
    },
  },
  {
    callout: "undo takes it back",
    anchor: () => '[data-tour="tool-undo"]',
    spot: overDock,
    paper: false,
    wide: true,
    tools: true,
    done: ({ edits }) => (edits?.undo.length ?? 0) === 0,
  },
  {
    // Done locks the document and puts its markdown in the export. The
    // tools go with the selection the step clears, so the bar is not in
    // the way of the arrow.
    callout: "mark it done to lock it",
    anchor: () => '[data-tour="done"]',
    spot: { side: "left", dx: 30, dy: 34, arrow: "under" },
    paper: false,
    wide: true,
    prepare: (_order, act) => act.clear(),
    done: ({ edits }) => edits?.done === true,
  },
  {
    // Shown, not asked for: the menu explains itself, and a real export
    // mid-tour would hand over the person's whole workspace.
    callout: "export is the copy you keep",
    anchor: () => '[data-tour="export"]',
    spot: { side: "left", dx: 36, dy: -2, arrow: "under" },
    paper: false,
    wide: true,
    after: 3000,
  },
  {
    callout: "come back any time",
    anchor: () => '[data-tour="help"]',
    spot: { side: "left", dx: 36, dy: -2, arrow: "under" },
    paper: false,
    wide: true,
    after: 2500,
  },
];

/** Whether the block tools float during `step`: the edit steps talk about
 *  them, and they would cover what the other steps point at. */
export function tourShowsTools(step: number): boolean {
  return STEPS[step]?.tools === true;
}
