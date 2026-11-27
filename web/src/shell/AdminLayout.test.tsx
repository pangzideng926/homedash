import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderKanban, LayoutDashboard, Settings } from 'lucide-react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminLayout } from '@/shell/AdminLayout';
import { AuthContext, type AuthContextValue } from '@/shell/auth-context';
import { SIDEBAR_COLLAPSED_STORAGE_KEY, type NavRouteItem } from '@/shell/navigation';
import { ThemeProvider } from '@/shell/ThemeProvider';
import { THEME_STORAGE_KEY } from '@/shell/theme-context';

const MOCK_AUTH: AuthContextValue = {
  status: 'authenticated',
  username: '测试管理员',
  expiresAt: null,
  sessionExpired: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
  refreshAuth: vi.fn(),
  clearSessionExpired: vi.fn(),
};

function SamplePage({ label }: { label: string }) {
  return <div>{label}内容</div>;
}

const TEST_ROUTES: NavRouteItem[] = [
  {
    id: 'home',
    path: '/',
    title: '控制台首页',
    icon: LayoutDashboard,
    component: () => <SamplePage label="首页" />,
  },
  {
    id: 'group-ops',
    title: '运维中心',
    children: [
      {
        id: 'nodes',
        path: '/nodes',
        title: '节点列表',
        icon: FolderKanban,
        component: () => <SamplePage label="节点" />,
      },
      {
        id: 'prefs',
        path: '/prefs',
        title: '系统参数',
        icon: Settings,
        component: () => <SamplePage label="参数" />,
      },
    ],
  },
];

function renderLayout(initialPath = '/nodes') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ThemeProvider>
        <AuthContext.Provider value={MOCK_AUTH}>
          <Routes>
            <Route
              element={
                <AdminLayout
                  brand={{ name: '测试台', subtitle: '通用后台' }}
                  routes={TEST_ROUTES}
                />
              }
            >
              <Route path="/" element={<SamplePage label="首页" />} />
              <Route path="/nodes" element={<SamplePage label="节点" />} />
              <Route path="/prefs" element={<SamplePage label="参数" />} />
            </Route>
          </Routes>
        </AuthContext.Provider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('AdminLayout 通用后台骨架', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('根据菜单配置生成侧栏导航、嵌套面包屑与 document.title', () => {
    renderLayout('/nodes');

    const sidebarNav = screen.getByRole('navigation', { name: '主导航' });
    expect(within(sidebarNav).getByRole('link', { name: '控制台首页' })).toBeInTheDocument();
    expect(within(sidebarNav).getByText('运维中心')).toBeInTheDocument();
    expect(within(sidebarNav).getByRole('link', { name: '节点列表' })).toBeInTheDocument();
    expect(within(sidebarNav).getByRole('link', { name: '系统参数' })).toBeInTheDocument();

    const breadcrumbNav = screen.getByRole('navigation', { name: '面包屑' });
    expect(within(breadcrumbNav).getByText('运维中心')).toBeInTheDocument();
    expect(within(breadcrumbNav).getByText('节点列表')).toHaveAttribute('aria-current', 'page');

    expect(document.title).toBe('节点列表 - 测试台');
    expect(screen.getByText('节点内容')).toBeInTheDocument();
  });

  it('桌面端支持侧栏折叠与展开，并将状态持久化到 localStorage', async () => {
    const user = userEvent.setup();
    const { unmount } = renderLayout('/');

    const aside = screen.getByTestId('desktop-sidebar');
    expect(aside).toHaveAttribute('data-collapsed', 'false');

    await user.click(screen.getByRole('button', { name: '折叠侧边栏' }));
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('true');

    unmount();
    renderLayout('/');
    expect(screen.getByTestId('desktop-sidebar')).toHaveAttribute('data-collapsed', 'true');

    await user.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(screen.getByTestId('desktop-sidebar')).toHaveAttribute('data-collapsed', 'false');
    expect(localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY)).toBe('false');
  });

  it('移动端抽屉可通过顶栏汉堡按钮打开并通过遮罩关闭', async () => {
    const user = userEvent.setup();
    renderLayout('/');

    expect(screen.queryByRole('dialog', { name: '导航菜单' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '打开导航菜单' }));
    expect(screen.getByRole('dialog', { name: '导航菜单' })).toBeInTheDocument();

    await user.click(screen.getByTestId('sidebar-backdrop'));
    expect(screen.queryByRole('dialog', { name: '导航菜单' })).not.toBeInTheDocument();
  });

  it('支持亮色/暗色/跟随系统三档主题切换并同步 localStorage 与 dark class', async () => {
    const user = userEvent.setup();
    const matchMediaSpy = vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    renderLayout('/');

    await user.click(screen.getByRole('button', { name: '暗色主题' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await user.click(screen.getByRole('button', { name: '亮色主题' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    await user.click(screen.getByRole('button', { name: '跟随系统' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
    expect(matchMediaSpy).toHaveBeenCalled();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('顶栏与主布局具备移动端防右侧裁切 class（overflow-x-clip / flex-wrap / min-w-0 / 紧凑退出按钮）', () => {
    const { container } = renderLayout('/');

    const root = container.firstElementChild;
    expect(root?.className).toContain('overflow-x-clip');

    const main = screen.getByRole('main');
    expect(main.className).toContain('min-w-0');

    const header = container.querySelector('header');
    expect(header?.className).toContain('flex-wrap');

    const themeGroup = screen.getByRole('group', { name: '主题切换' });
    expect(themeGroup.className).toContain('max-w-full');

    const logoutBtn = screen.getByRole('button', { name: '退出登录' });
    expect(logoutBtn.className).toContain('px-2');
  });
});
