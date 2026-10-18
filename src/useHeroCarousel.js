import { useEffect, useRef, useState } from 'react';

export function useHeroCarousel(items, selectedId, onSelect, elementRef) {
  const current = useRef({ items, selectedId, onSelect });
  current.current = { items, selectedId, onSelect };
  const [paused, setPaused] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [hidden, setHidden] = useState(document.hidden);
  const [reduced, setReduced] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState(0);
  const [restart, setRestart] = useState(0);
  const gesture = useRef(null);
  const suppressClick = useRef(0);
  const ids = items.map((item) => item.id).join(',');
  const select = (id) => {
    current.current.onSelect(id);
    setRestart((value) => value + 1);
  };
  const move = (step) => {
    const { items, selectedId } = current.current;
    if (items.length < 2) return;
    const index = Math.max(
      0,
      items.findIndex((item) => item.id === selectedId),
    );
    select(items[(index + step + items.length) % items.length].id);
  };
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () =>
      setReduced(media.matches || document.documentElement.dataset.reduceMotion === 'true');
    const visibility = () => setHidden(document.hidden);
    const preference = new MutationObserver(motion);
    preference.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-reduce-motion'],
    });
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    observer.observe(elementRef.current);
    media.addEventListener('change', motion);
    document.addEventListener('visibilitychange', visibility);
    motion();
    return () => {
      observer.disconnect();
      preference.disconnect();
      media.removeEventListener('change', motion);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [elementRef]);
  useEffect(() => {
    if (items.length < 2 || paused || focused || dragging || !visible || hidden || reduced) return;
    const timer = setTimeout(() => move(1), 30000);
    return () => clearTimeout(timer);
  }, [ids, selectedId, restart, paused, focused, dragging, visible, hidden, reduced]);
  const end = (event, cancelled = false) => {
    const start = gesture.current;
    if (!start || event.pointerId !== start.id) return;
    gesture.current = null;
    if (start.active) {
      suppressClick.current = Date.now() + 400;
      const dx = event.clientX - start.x;
      const threshold = Math.min(100, event.currentTarget.clientWidth * 0.15);
      if (!cancelled && Math.abs(dx) >= threshold) move(dx < 0 ? 1 : -1);
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
    setOffset(0);
    setRestart((value) => value + 1);
  };
  return {
    select,
    move,
    paused,
    reduced,
    dragging,
    offset,
    togglePause: () => setPaused((value) => !value),
    bindings: {
      onFocusCapture: () => setFocused(true),
      onBlurCapture: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      },
      onDragStart: (event) => event.preventDefault(),
      onPointerDown: (event) => {
        // A fresh click must work immediately after a completed drag.
        suppressClick.current = 0;
        if (
          items.length < 2 ||
          !event.isPrimary ||
          event.button !== 0 ||
          event.target.closest('a,button,input,select,textarea')
        )
          return;
        gesture.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          active: false,
        };
      },
      onPointerMove: (event) => {
        const start = gesture.current;
        if (!start || start.id !== event.pointerId) return;
        if (event.buttons === 0) {
          end(event, true);
          return;
        }
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (!start.active) {
          if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
            gesture.current = null;
            return;
          }
          if (Math.abs(dx) < 10) return;
          start.active = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }
        event.preventDefault();
        setOffset(Math.max(-80, Math.min(80, dx * 0.3)));
      },
      onPointerUp: (event) => end(event),
      onPointerCancel: (event) => end(event, true),
      onLostPointerCapture: (event) => {
        // Touch starts with implicit capture on a child; taking it over must not cancel the drag.
        if (event.target === event.currentTarget) end(event, true);
      },
      onClickCapture: (event) => {
        if (event.detail !== 0 && Date.now() < suppressClick.current) {
          event.preventDefault();
          event.stopPropagation();
          suppressClick.current = 0;
        }
      },
    },
  };
}
