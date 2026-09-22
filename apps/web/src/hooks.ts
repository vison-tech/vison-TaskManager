import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
export function useWorkspace(includeArchived = false) {
 const client = useQueryClient();
 const query = useQuery({
  queryKey:['snapshot', includeArchived],
  queryFn: async () => {
   const snapshot = await api.snapshot();
   if (!includeArchived) return snapshot;
   return { ...snapshot, tasks: await api.tasks({ archived: 'all' }) };
  },
  refetchInterval:30000,
 });
 useEffect(()=>{const events = new EventSource('/api/v1/events'); const refresh=()=>{void client.invalidateQueries();}; events.addEventListener('revision',refresh); events.onopen=refresh; return ()=>events.close();},[client]);
 return query;
}
export function useUrlState() {
 const [params,setParams]=useState(()=>new URLSearchParams(location.search));
 useEffect(()=>{const update=()=>setParams(new URLSearchParams(location.search)); window.addEventListener('popstate',update);return ()=>window.removeEventListener('popstate',update);},[]);
 function update(values:Record<string,string|null>) { const next=new URLSearchParams(location.search);Object.entries(values).forEach(([key,value])=>value?next.set(key,value):next.delete(key));history.pushState(null,'',`${location.pathname}?${next}`);setParams(next); }
 return {params,update};
}
