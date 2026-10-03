/** Put every glint on one clock.
 *
 * Glints begin when React mounts a `.selection`, so ones born a click
 * apart would shimmer out of phase. One document-level listener zeroes
 * each glint animation's start the moment it begins, which puts it on the
 * clock every earlier glint is already on -- and nothing that renders a
 * glint has to remember to sync it. Imported for this effect alone. */

document.addEventListener("animationstart", (e) => {
  if (!e.animationName.startsWith("glint")) return;
  for (const animation of (e.target as Element).getAnimations()) {
    if (animation instanceof CSSAnimation && animation.animationName === e.animationName) {
      animation.startTime = 0;
    }
  }
});
