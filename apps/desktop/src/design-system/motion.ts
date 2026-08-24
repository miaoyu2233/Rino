import type { Transition } from "motion/react";

export const motionDurations = {
  micro: 0.12,
  standard: 0.19,
  panel: 0.25,
} as const;

/** Whether the user has asked the operating system for reduced motion.
 *
 * Motion components read the preference through `MotionConfig`. Movement produced outside
 * that system, such as a viewport animation owned by the graph library, has to ask here.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export const motionTransitions = {
  micro: {
    duration: motionDurations.micro,
    ease: [0.16, 1, 0.3, 1],
  } satisfies Transition,
  standard: {
    duration: motionDurations.standard,
    ease: [0.16, 1, 0.3, 1],
  } satisfies Transition,
  panel: {
    duration: motionDurations.panel,
    ease: [0.22, 1, 0.36, 1],
  } satisfies Transition,
  spatialSpring: {
    type: "spring",
    stiffness: 420,
    damping: 34,
    mass: 0.8,
  } satisfies Transition,
} as const;
