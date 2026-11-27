export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export interface AuthUser {
  username: string;
}

export async function fetchCurrentUser(): Promise<AuthUser | null> {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new ApiError('获取登录状态失败', response.status);
  }

  const data = (await response.json()) as Partial<AuthUser>;
  if (typeof data.username !== 'string' || !data.username) {
    return null;
  }

  return { username: data.username };
}

export async function loginRequest(username: string, password: string): Promise<void> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({ username, password }),
  });

  if (response.status === 401) {
    throw new ApiError('用户名或密码错误', 401);
  }

  if (!response.ok) {
    let message = '登录失败，请稍后重试';
    try {
      const data = (await response.json()) as { error?: unknown };
      if (typeof data.error === 'string' && data.error.trim()) {
        message = data.error;
      }
    } catch {
      // 忽略非 JSON 错误响应
    }
    throw new ApiError(message, response.status);
  }
}

export async function logoutRequest(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
  });
}
