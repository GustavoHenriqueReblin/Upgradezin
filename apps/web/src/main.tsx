import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { ProductPage } from './components/ProductPage.tsx';
import { productKeyFromUrl } from './product.ts';
import { loadStores } from './stores.ts';
import '@fontsource-variable/quicksand';
import './index.css';

const root = createRoot(document.getElementById('root')!);

/** Site fora do ar para quem usa (só o admin funciona) enquanto o banco de fichas é montado. */
const MAINTENANCE = true;

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
} else if (productKeyFromUrl()) {
  // Página do produto: no ar mesmo com o resto do site em manutenção.
  const key = productKeyFromUrl()!;
  loadStores()
    .catch(() => undefined)
    .then(() =>
      root.render(
        <StrictMode>
          <ProductPage productKey={key} />
        </StrictMode>,
      ),
    );
} else if (MAINTENANCE) {
  // Site em manutenção enquanto as fichas técnicas são refeitas (o admin continua no ar).
  root.render(
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-center text-zinc-700 dark:bg-zinc-950 dark:text-zinc-200">
      <div className="max-w-md space-y-2">
        <p className="text-2xl font-bold tracking-tight">
          Upgradezin<span className="text-accent-500">.</span>
        </p>
        <p className="text-lg font-semibold">Em manutenção</p>
      </div>
    </div>,
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
