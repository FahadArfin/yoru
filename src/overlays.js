const scrollLocks = new Set();
let originalOverflow = '';

export function lockDocumentScroll() {
  const token = Symbol('scroll-lock');
  if (!scrollLocks.size) originalOverflow = document.body.style.overflow;
  scrollLocks.add(token);
  document.body.style.overflow = 'hidden';
  return () => {
    scrollLocks.delete(token);
    if (!scrollLocks.size) document.body.style.overflow = originalOverflow;
  };
}

export const dialogStack = [];
