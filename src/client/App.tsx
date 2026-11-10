import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { startOfflineSync } from './lib/offline';
import { startPwa } from './lib/pwa';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { api, ApiError, onUnauthorized } from './lib/api';
import { ToastProvider } from './components/Toast';
import { Login, SetupNeeded } from './routes/Login';
import { Layout } from './routes/Layout';
import { Pack } from './routes/Pack';
import { Trips } from './routes/Trips';
import { NewTrip } from './routes/NewTrip';
import { TripSettings } from './routes/TripSettings';
import { Catalog, ItemEditor } from './routes/Catalog';
import { Templates, TemplateEditor } from './routes/Templates';
import { People } from './routes/People';
import { Suitcases } from './routes/Suitcases';
import { Settings } from './routes/Settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && [401, 403, 404, 503].includes(e.status)) && n < 2,
      refetchOnWindowFocus: true,
    },
  },
});

startPwa();
startOfflineSync(queryClient);

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <Trips /> },
      { path: '/trips', element: <Trips /> },
      { path: '/trips/new', element: <NewTrip /> },
      { path: '/trips/:id', element: <Pack /> },
      { path: '/trips/:id/details', element: <TripSettings /> },
      { path: '/catalog', element: <Catalog /> },
      { path: '/catalog/item/:id', element: <ItemEditor /> },
      { path: '/catalog/bags', element: <Suitcases /> },
      { path: '/catalog/people', element: <People /> },
      { path: '/templates', element: <Templates /> },
      { path: '/templates/:id', element: <TemplateEditor /> },
      { path: '/settings', element: <Settings /> },
      { path: '*', element: <Trips /> },
    ],
  },
]);

function Gate() {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api.get<{ ok: true; instance_name: string }>('/session'),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  useEffect(
    () =>
      onUnauthorized(() => {
        qc.setQueryData(['session'], null);
        qc.invalidateQueries({ queryKey: ['session'] });
      }),
    [qc],
  );
  if (session.isPending) return <div className="h-full bg-bg" />;
  const err = session.error;
  if (err instanceof ApiError && err.status === 503) return <SetupNeeded message={err.message} />;
  if (err instanceof ApiError && err.status === 0) {
    // Offline before we could confirm the session: show the app and let cached data fill in.
    return <RouterProvider router={router} />;
  }
  if (err || !session.data) return <Login />;
  return <RouterProvider router={router} />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </QueryClientProvider>
  );
}
