import { useEffect, useRef, useState } from 'react';
import { isBannerSharp } from './banner-quality';

export function useBannerArtwork(candidates) {
  const ref = useRef(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [images, setImages] = useState({});
  const urls = JSON.stringify([...new Set(candidates.map((x) => x.banner).filter(Boolean))]);
  useEffect(() => {
    const element = ref.current;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      setBox({ width, height, density: window.devicePixelRatio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  useEffect(() => {
    let active = true;
    const cleanups = JSON.parse(urls).map((url) => {
      const image = new Image();
      const settle = (value) => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (active) setImages((previous) => ({ ...previous, [url]: value }));
      };
      // End the skeleton on slow connections, but still accept a late successful load.
      const timer = setTimeout(() => {
        if (active) setImages((previous) => ({ ...previous, [url]: null }));
      }, 10000);
      image.onload = () => settle({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => settle(null);
      image.src = url;
      return () => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
      };
    });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [urls]);
  return {
    ref,
    featured: candidates.filter((x) => isBannerSharp(images[x.banner], box)),
    loading: JSON.parse(urls).some((url) => images[url] === undefined),
    reject: (url) => setImages((previous) => ({ ...previous, [url]: null })),
  };
}
