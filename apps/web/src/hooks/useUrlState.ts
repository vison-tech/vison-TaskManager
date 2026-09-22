import { useEffect, useState } from 'react';

export function useUrlState() {
  const [params, setParams] = useState(() => new URLSearchParams(location.search));

  useEffect(() => {
    const update = () => setParams(new URLSearchParams(location.search));
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(location.search);
    Object.entries(values).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    history.pushState(null, '', `${location.pathname}?${next}`);
    setParams(next);
  }

  return { params, update };
}
