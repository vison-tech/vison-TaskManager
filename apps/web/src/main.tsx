import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { client } from './api/client';
import { LocaleProvider } from './lib/locale';
import { embeddedRuntime, prepareWebClient } from './lib/embedded';
import { embeddedPreferencesStore } from './lib/embeddedPreferences';
import './styles.css';
const queryClient=new QueryClient({defaultOptions:{queries:{retry:1,staleTime:3000}}});

function StartupError() {
  return <div className="app-loading" role="alert"><h1>任务面板暂时无法加载</h1><p>请确认本地任务服务仍在运行，然后关闭并重新打开面板。</p></div>;
}

class StartupBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { embeddedRuntime?.failed(); }
  render() { return this.state.failed ? <StartupError/> : this.props.children; }
}

function ReadyApp() {
  React.useEffect(() => { embeddedRuntime?.ready(); }, []);
  return <App/>;
}

void (async () => {
  const root = createRoot(document.getElementById('root')!);
  try {
    await prepareWebClient(client, embeddedRuntime, (snapshot) => queryClient.setQueryData(['snapshot', false], snapshot));
    await embeddedPreferencesStore?.initialize();
    root.render(<React.StrictMode><StartupBoundary><QueryClientProvider client={queryClient}><LocaleProvider><ReadyApp/></LocaleProvider></QueryClientProvider></StartupBoundary></React.StrictMode>);
  } catch { root.render(<StartupError/>); }
})();
