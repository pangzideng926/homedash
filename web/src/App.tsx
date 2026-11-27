import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { ConsoleLayout } from '@/components/ConsoleLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AuthProvider } from '@/contexts/AuthProvider';
import { ComingSoonPage } from '@/pages/ComingSoonPage';
import { LoginPage } from '@/pages/LoginPage';
import { OverviewPage } from '@/pages/OverviewPage';

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<ConsoleLayout />}>
            <Route index element={<OverviewPage />} />
            <Route
              path="nas"
              element={<ComingSoonPage title="NAS" description="NAS 状态与磁盘用量监控" />}
            />
            <Route
              path="seeding"
              element={
                <ComingSoonPage
                  title="刷流做种"
                  description="qBittorrent / MoviePilot 刷流与做种数据"
                />
              }
            />
            <Route
              path="pc"
              element={
                <ComingSoonPage title="家用电脑" description="家用 Windows 主机状态与资源监控" />
              }
            />
            <Route
              path="vps"
              element={<ComingSoonPage title="VPS" description="云服务器状态与到期提醒管理" />}
            />
            <Route
              path="alerts"
              element={<ComingSoonPage title="告警" description="账号登录与安全异常告警汇总" />}
            />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
