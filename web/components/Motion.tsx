"use client";

import { LazyMotion, MotionConfig, domAnimation, m, useReducedMotion } from "framer-motion";

// One place for the page's motion settings. `reducedMotion="user"` makes Framer
// Motion drop transform animations for people who ask the OS for less motion;
// everything else (CSS animations, the hero canvas) checks the same media query.

export function MotionRoot({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Fade and rise into place, once, as it scrolls into view. Slow and quiet. */
export function Reveal({
  children,
  delay = 0,
  className,
  y = 18,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  y?: number;
}) {
  // Framer Motion drops the rise itself for reduced motion but still fades; make the fade instant too
  const reduce = useReducedMotion();
  return (
    <m.div
      data-reveal
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -10% 0px" }}
      transition={reduce ? { duration: 0 } : { duration: 1, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </m.div>
  );
}
