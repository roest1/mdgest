/** A page's tree drawn as React elements, as react-markdown drew one: the
 *  options it gave `toJsxRuntime`, so the pane and the test that holds it
 *  to react-markdown's HTML draw with the same ones. */

import type { Root } from "hast";
import { toJsxRuntime, type Options } from "hast-util-to-jsx-runtime";
import type { ReactElement } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

export function drawTree(
  tree: Root,
  components: Options["components"],
): ReactElement {
  return toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    components,
    ignoreInvalidStyle: true,
    passKeys: true,
    passNode: true,
  });
}
