import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadStores } from './stores.ts';
import '@fontsource-variable/quicksand';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// /admin: tela de quem opera o servidor, em pacote separado (não pesa no app).
const Admin = lazy(() => import('./admin/Admin.tsx').then((m) => ({ default: m.Admin })));

if (location.pathname === '/admin' || location.pathname.startsWith('/admin/')) {
  root.render(
    <StrictMode>
      <Suspense fallback={null}>
        <Admin />
      </Suspense>
    </StrictMode>,
  );
} else {
  loadStores()
    .then(() =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    )
    .catch(() =>
      root.render(
        <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-center text-zinc-600 dark:bg-zinc-950 dark:text-zinc-300">
          <p>
            Não foi possível carregar agora.{' '}
            <button className="font-medium text-accent-600 underline" onClick={() => location.reload()}>
              Tentar de Novo
            </button>
          </p>
        </div>,
      ),
    );
}
