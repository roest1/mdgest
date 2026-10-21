/** Where things live in a workspace, and what a name is allowed to be. */

/** The last name in a path. */
export function basename(path: string): string {
  return path.split("/").at(-1) ?? path;
}

/** The visible manifest an exported workspace carries at its root. Its
 *  presence is what makes a folder or archive a project to continue rather
 *  than PDFs to add. */
export const MANIFEST = "mdgest.json";
