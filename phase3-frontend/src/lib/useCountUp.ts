import { useEffect, useRef, useState } from "react";

/**
 * Animates a number from its previous value to a new target whenever the
 * target changes, using an ease-out curve. Used for the half-second "roll
 * up" feel when a calculation completes instead of numbers snapping in.
 * No extra dependency needed - plain requestAnimationFrame.
 */
export function useCountUp(target: number, durationMs = 700): number {
  const [value, setValue] = useState(target);
  const prevTarget = useRef(target);
  const frame = useRef<number>();

  useEffect(() => {
    // requestAnimationFrame ignores the CSS prefers-reduced-motion media
    // query (that only pauses CSS transitions/animations), so a JS-driven
    // "roll up" like this one needs its own check - jump straight to the
    // target instead of animating when the user has asked for less motion.
    const reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion) {
      prevTarget.current = target;
      setValue(target);
      return;
    }

    const start = prevTarget.current;
    const startTime = performance.now();
    if (frame.current) cancelAnimationFrame(frame.current);

    function tick(now: number) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(start + (target - start) * eased);
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        prevTarget.current = target;
      }
    }
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}
