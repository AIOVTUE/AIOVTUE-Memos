/**
 * Desktop-only scroll damping (lerp inertia).
 * Keeps real document scrollY so IntersectionObserver / anchors still work.
 * Skips touch devices and prefers-reduced-motion.
 */

const DESKTOP_MQ = "(hover: hover) and (pointer: fine) and (min-width: 768px)";
const REDUCED_MQ = "(prefers-reduced-motion: reduce)";

function canUseDamping() {
  return window.matchMedia(DESKTOP_MQ).matches && !window.matchMedia(REDUCED_MQ).matches;
}

function isEditable(el) {
  if (!el || !(el instanceof Element)) return false;
  if (el.closest("textarea, input, select, [contenteditable='true']")) return true;
  return false;
}

/** Native scroll wins inside open overlays or nested scroll areas. */
function shouldIgnoreWheel(target) {
  if (!(target instanceof Element)) return false;
  if (document.querySelector(".sheet-mask.open, .lightbox.open")) return true;
  if (isEditable(target)) return true;

  let node = target;
  while (node && node !== document.body && node !== document.documentElement) {
    const style = window.getComputedStyle(node);
    const oy = style.overflowY;
    const scrollable =
      (oy === "auto" || oy === "scroll" || oy === "overlay") && node.scrollHeight > node.clientHeight + 1;
    if (scrollable) return true;
    node = node.parentElement;
  }
  return false;
}

function maxScroll() {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

export function initDesktopScrollDamping() {
  if (!canUseDamping()) return () => {};

  let target = window.scrollY;
  let current = window.scrollY;
  let raf = 0;
  let animating = false;
  let syncing = false;

  // Lower = heavier damping / softer stop
  const ease = 0.105;
  const wheelScale = 0.92;

  const stopAnim = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    animating = false;
  };

  const tick = () => {
    const max = maxScroll();
    target = Math.max(0, Math.min(max, target));
    current += (target - current) * ease;

    if (Math.abs(target - current) < 0.35) {
      current = target;
      syncing = true;
      window.scrollTo(0, current);
      syncing = false;
      stopAnim();
      return;
    }

    syncing = true;
    window.scrollTo(0, current);
    syncing = false;
    raf = requestAnimationFrame(tick);
  };

  const start = () => {
    if (!animating) {
      animating = true;
      raf = requestAnimationFrame(tick);
    }
  };

  const onWheel = (e) => {
    if (!canUseDamping()) return;
    if (e.ctrlKey || e.defaultPrevented) return;
    if (shouldIgnoreWheel(e.target)) return;

    e.preventDefault();
    // Normalize line/page deltas to pixels-ish
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    if (e.deltaMode === 2) dy *= window.innerHeight;
    target = Math.max(0, Math.min(maxScroll(), target + dy * wheelScale));
    start();
  };

  const onScroll = () => {
    if (syncing || animating) return;
    target = window.scrollY;
    current = window.scrollY;
  };

  const onResize = () => {
    target = Math.max(0, Math.min(maxScroll(), target));
    current = Math.max(0, Math.min(maxScroll(), current));
  };

  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize, { passive: true });
  document.documentElement.classList.add("has-scroll-damping");

  return () => {
    stopAnim();
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    document.documentElement.classList.remove("has-scroll-damping");
  };
}
