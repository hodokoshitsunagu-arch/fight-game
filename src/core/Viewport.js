/**
 * Read the CSS-pixel box the renderer actually occupies.
 *
 * Window dimensions can disagree with a fixed canvas on mobile while browser
 * chrome is expanding/collapsing, or when the visual viewport changes.  The
 * canvas box is the shared truth for rendering, camera aspect and pointer NDC.
 */
export function measureViewport(element, fallback = globalThis.window) {
  const rect = element?.getBoundingClientRect?.();
  const width = rect?.width || element?.clientWidth || fallback?.innerWidth || 1;
  const height = rect?.height || element?.clientHeight || fallback?.innerHeight || 1;
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    left: Number.isFinite(rect?.left) ? rect.left : 0,
    top: Number.isFinite(rect?.top) ? rect.top : 0
  };
}

/** Convert a client-space pointer using the same box the renderer uses. */
export function pointerNdc(event, element, fallback = globalThis.window) {
  const box = measureViewport(element, fallback);
  return {
    x: ((event.clientX - box.left) / box.width) * 2 - 1,
    y: -((event.clientY - box.top) / box.height) * 2 + 1
  };
}
