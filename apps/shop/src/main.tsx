import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readShopConfig, type ShopConfig } from './config';
import { ShopStateProvider } from './state';
import './styles.css';

function boot(): void {
  const container = document.getElementById('root');
  if (!container) throw new Error('#root is missing from index.html');
  const root = createRoot(container);

  let config: ShopConfig;
  try {
    config = readShopConfig();
  } catch (error) {
    root.render(
      <main>
        <h1>Shop misconfigured</h1>
        <p role="alert">{error instanceof Error ? error.message : String(error)}</p>
      </main>,
    );
    return;
  }

  document.documentElement.dataset.ui = config.ui;
  root.render(
    <StrictMode>
      <ShopStateProvider>
        <App ui={config.ui} />
      </ShopStateProvider>
    </StrictMode>,
  );
}

boot();
