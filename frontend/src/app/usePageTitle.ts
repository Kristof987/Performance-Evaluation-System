import { useEffect } from 'react';

const APP_NAME = 'PerfEval';

/** Sets the browser tab title, most specific part first: "Q3 Review · Campaigns · PerfEval". */
export function usePageTitle(...parts: (string | null | undefined | false)[]) {
  const title = [...parts.filter((part): part is string => Boolean(part && part.trim())), APP_NAME].join(' · ');
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/** Route-level title; a page that knows a more specific name (e.g. a campaign) overrides it. */
export function PageTitle({ parts }: { parts: string[] }) {
  usePageTitle(...parts);
  return null;
}
