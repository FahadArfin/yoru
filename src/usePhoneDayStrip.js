import { useLayoutEffect, useRef } from 'react';

// Keep the selected date in a horizontally scrolling phone calendar, without
// scrolling the document or changing the desktop calendar's position.
export default function usePhoneDayStrip(day) {
  const strip = useRef(null);
  useLayoutEffect(() => {
    const reveal = () => {
      const node = strip.current;
      const selected = node?.querySelector('[aria-pressed="true"]');
      if (!node || !selected || !window.matchMedia('(max-width: 760px)').matches) return;
      const bounds = node.getBoundingClientRect();
      const target = selected.getBoundingClientRect();
      node.scrollLeft += target.left - bounds.left - (bounds.width - target.width) / 2;
    };
    reveal();
    window.addEventListener('resize', reveal);
    return () => window.removeEventListener('resize', reveal);
  }, [day]);
  return strip;
}
