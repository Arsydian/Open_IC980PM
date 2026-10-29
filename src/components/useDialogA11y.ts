/**
 * @file src/components/useDialogA11y.ts
 * @description Keyboard and focus behaviour shared by the modal dialogs: focus moves into the dialog
 * when it opens, Tab stays inside it, Escape closes it (unless `canClose` is false, e.g. during a
 * radio transfer), and focus returns to where it was when the dialog closes.
 */

import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]):not([type="file"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Returns a ref for the dialog panel; give that element `tabIndex={-1}`. */
export function useDialogA11y(isOpen: boolean, onClose: () => void, canClose: boolean = true) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const latest = useRef({ onClose, canClose });
  latest.current = { onClose, canClose };

  useEffect(() => {
    if (!isOpen) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === 'Escape') {
        if (latest.current.canClose) {
          e.preventDefault();
          latest.current.onClose();
        }
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('.hidden'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  return dialogRef;
}
