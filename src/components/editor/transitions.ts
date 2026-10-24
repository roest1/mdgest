/** The Transition types the editor's layout changes are started with, so
 *  a <ViewTransition> anywhere in it can answer the ones that move it. The
 *  classes they map to are in index.css. */

/** The tab bar appearing or going: see openDoc in routes/Editor.tsx. */
export const TABS = "tabs";

/** The explorer being shown or hidden. */
export const SIDEBAR = "sidebar";

/** What a bar holds as the explorer moves the bar's edges: each group of
 *  controls slides to where it ends up, drawn once rather than faded out
 *  and in again. */
export const SLIDE = { [SIDEBAR]: "slide", default: "none" } as const;
