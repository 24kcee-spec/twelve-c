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
