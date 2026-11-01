import { useEffect, useRef, useState } from 'react';
import { embeddedRuntime } from '../lib/embedded';

export function useUrlState() {
  const [params, setParams] = useState(() => new URLSearchParams(embeddedRuntime ? '' : window.location.search));
  const current = useRef(params);
  const inMemory = useRef(Boolean(embeddedRuntime));

  useEffect(() => {
    const update = () => {
      if (inMemory.current) return;
      current.current = new URLSearchParams(window.location.search);
      setParams(current.current);
    };
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(inMemory.current ? current.current : window.location.search);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    if (!inMemory.current) {
      try { window.history.pushState(null, '', `${window.location.pathname}?${next}`); }
      catch { inMemory.current = true; }
    }
    current.current = next;
    setParams(next);
  }

  return { params, update };
}
