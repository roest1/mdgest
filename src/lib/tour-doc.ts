/** The document the walkthrough runs on: a two-page synthetic manual
 *  bundled with the app, so the tour never touches a person's own work,
 *  and always has the same blocks to point at.
 *
 * It has an id like any document's, so every path helper accepts it, but
 * it is never in the workspace: the page pane takes its bytes from here
 * instead of the engine, its reading stays in memory instead of the
 * cache, and the explorer lists it only while the tour runs. */

import exampleUrl from "src/components/editor/example.pdf?url";

/** Named for what it is. It is listed in the explorer only while the tour
 *  runs, so it is not taken for a document of the person's own. */
export const TOUR_DOC = "example-pdf";

export function isTourDoc(docId: string): boolean {
  return docId === TOUR_DOC;
}

export async function tourSource(): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(exampleUrl);
  if (!response.ok) throw new Error("The example document could not be fetched.");
  return new Uint8Array(await response.arrayBuffer());
}
