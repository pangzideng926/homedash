import { ServerCog } from 'lucide-react';
import { BrowserRouter } from 'react-router';
import { NAV_ROUTES } from '@/config/navigation';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { AuthProvider, ShellRouter, ThemeProvider, type ShellBrand } from '@/shell';

const APP_BRAND: ShellBrand = {
  name: 'homedash',
  subtitle: '家庭服务器控制台',
  icon: ServerCog,
};

export function AppRoutes() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ShellRouter brand={APP_BRAND} routes={NAV_ROUTES} notFoundComponent={NotFoundPage} />
      </AuthProvider>
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
