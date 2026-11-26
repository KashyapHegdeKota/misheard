"use client";

import { useEffect, useRef } from "react";

/**
 * Marks its wrapper `data-armed` once mounted and `data-inview` the first time it
 * scrolls into view, so CSS can play an entrance (like bars growing) exactly once.
 * Without JavaScript neither attribute is ever set and the content simply shows.
 * The attributes are set on the element directly, so React never re-renders for them.
 */
export function InView({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => {
      el.dataset.armed = "true";
      el.dataset.inview = "true";
    };
    // people who ask for less motion get no entrance at all
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") {
      show();
      return;
    }
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.9 && r.bottom > 0) {
      show();
      return;
    }
    el.dataset.armed = "true";
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.dataset.inview = "true";
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
