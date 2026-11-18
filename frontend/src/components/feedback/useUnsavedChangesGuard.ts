import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useConfirm } from './feedback-context';

/**
 * While `dirty`, asks before in-app links leave the page and lets the browser warn on reload or tab close.
 * Pages with their own "Unsaved changes" dialog (forms, campaigns) don't need this.
 */
export function useUnsavedChangesGuard(dirty: boolean, what = 'changes') {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const asking = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = ''; }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      event.preventDefault(); event.stopPropagation();
      if (asking.current) return;
      asking.current = true;
      void confirm({
        title: 'Leave without saving?',
        message: `Your unsaved ${what} will be lost.`,
        confirmLabel: 'Discard and leave',
        tone: 'danger',
      }).then((ok) => {
        asking.current = false;
        if (ok) navigate(url.pathname + url.search + url.hash);
      });
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, what, confirm, navigate]);
}
