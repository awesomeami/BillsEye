import { RefObject, useEffect, useRef } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

let activeScrollLocks = 0;
let previousBodyOverflow = '';

function lockDocumentScroll() {
  if (activeScrollLocks === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  activeScrollLocks += 1;
}

function unlockDocumentScroll() {
  activeScrollLocks = Math.max(0, activeScrollLocks - 1);
  if (activeScrollLocks === 0) document.body.style.overflow = previousBodyOverflow;
}

function getFocusable(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
}

/** Gives a modal dialog focus management, Escape support, and scroll locking. */
export function useDialogA11y<T extends HTMLElement>({
  isOpen,
  onClose,
  initialFocusRef,
}: {
  isOpen: boolean;
  onClose: () => void;
  initialFocusRef?: RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    lockDocumentScroll();
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      (initialFocusRef?.current ?? getFocusable(dialog)[0] ?? dialog).focus();
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      unlockDocumentScroll();
      restoreFocusRef.current?.focus();
    };
  }, [initialFocusRef, isOpen]);

  return dialogRef;
}
