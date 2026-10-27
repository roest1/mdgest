/** Every reader case, by what it covers. A new default gets a file here and
 *  an entry below; `bun run fixtures` writes each case out as a PDF. */

import { blocks } from "./blocks";
import type { Case } from "./case";
import { headings } from "./headings";
import { links } from "./links";
import { lists } from "./lists";
import { pages } from "./pages";
import { pictures } from "./pictures";
import { style } from "./style";

export const cases: Record<string, Case[]> = {
  headings,
  lists,
  blocks,
  style,
  links,
  pictures,
  pages,
};
