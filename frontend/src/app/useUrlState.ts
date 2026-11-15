import { useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

type Update<T> = T | ((current: T) => T);

export type UrlField<T> = {
  key: string;
  defaultValue: T;
  parse: (raw: string) => T | null;
  serialize?: (value: T) => string;
  /** true: changing the value adds a browser history entry (Back undoes it); false: replaces it. */
  push?: boolean;
};

/**
 * Keeps page state (tab, filters, open drawer...) in the query string, so a link or a refresh
 * restores the same view. Several updates in one event are combined into a single navigation;
 * default values are left out of the URL to keep links short.
 */
export function useUrlState() {
  const location = useLocation();
  const navigate = useNavigate();
  const pending = useRef<{ params: URLSearchParams; push: boolean } | null>(null);

  const update = useCallback((change: (params: URLSearchParams) => void, push: boolean) => {
    if (!pending.current) {
      pending.current = { params: new URLSearchParams(window.location.search), push: false };
      queueMicrotask(() => {
        const next = pending.current;
        pending.current = null;
        if (!next) return;
        const search = next.params.toString();
        if (`?${search}` === window.location.search || (!search && !window.location.search)) return;
        navigate({ search: search ? `?${search}` : '', hash: window.location.hash },
          { replace: !next.push, preventScrollReset: true });
      });
    }
    change(pending.current.params);
    if (push) pending.current.push = true;
  }, [navigate]);

  function read<T>(spec: UrlField<T>, params: URLSearchParams): T {
    const raw = params.get(spec.key);
    return raw === null ? spec.defaultValue : spec.parse(raw) ?? spec.defaultValue;
  }

  function field<T>(spec: UrlField<T>): [T, (value: Update<T>, options?: { replace?: boolean }) => void] {
    const value = read(spec, new URLSearchParams(location.search));
    const set = (next: Update<T>, options?: { replace?: boolean }) => {
      update((params) => {
        const resolved = typeof next === 'function' ? (next as (current: T) => T)(read(spec, params)) : next;
        const text = spec.serialize ? spec.serialize(resolved) : String(resolved);
        const defaultText = spec.serialize ? spec.serialize(spec.defaultValue) : String(spec.defaultValue);
        if (resolved === null || text === defaultText) params.delete(spec.key);
        else params.set(spec.key, text);
      }, (spec.push ?? false) && !options?.replace);
    };
    return [value, set];
  }

  return { field };
}

export const parseText = (raw: string) => raw;

export const parsePositiveInt = (raw: string) => {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
};
