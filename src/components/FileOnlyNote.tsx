/**
 * @file src/components/FileOnlyNote.tsx
 * @description Marks a setting that is saved in the `.Ysf` file but not written to the radio,
 * because its location in radio memory has not been mapped yet.
 */

import React from 'react';
import { FileWarning } from 'lucide-react';

export const FileOnlyNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p role="note" className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-amber-300/90">
    <FileWarning className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
    <span>{children}</span>
  </p>
);
