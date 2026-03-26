import React from 'react';

export const CATEGORY_PILL_CLASS =
  'inline-block px-2.5 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-xs text-zinc-300';

export default function CategoryPill({ children, className = '' }) {
  return <span className={[CATEGORY_PILL_CLASS, className].filter(Boolean).join(' ')}>{children}</span>;
}

