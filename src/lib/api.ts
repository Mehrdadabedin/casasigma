export type Role = 'buyer' | 'seller' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  role: Role;
  /** The admin signs in as `admin`; ordinary accounts sign in with their email. */
  username: string | null;
  /** What the account may do, derived from the role it signed up with. */
  canBuy: boolean;
  canSell: boolean;
  /** Suspended accounts cannot sign in and are blocked from every API call. */
  suspended: boolean;
  /** True while the admin still uses the public starter password. */
  mustSetPassword: boolean;
  createdAt: string;
}

export class ApiError extends Error {
  status: number;
  field?: string;

  constructor(message: string, status: number, field?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.field = field;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = (await response.json().catch(() => null)) as
    | { error?: string; field?: string }
    | null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? 'Something went wrong. Try again.', response.status, payload?.field);
  }

  return payload as T;
}

export interface SignupInput {
  name: string;
  email: string;
  password: string;
  role: Role;
}

export const authApi = {
  me: () => request<{ user: SessionUser }>('/api/auth/me').then((data) => data.user),
  /** `identifier` is an email address or the admin username. */
  login: (identifier: string, password: string) =>
    request<{ user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    }).then((data) => data.user),
  /** Replace the starter admin credentials with the admin's own. */
  updateAdminCredentials: (input: { currentPassword: string; username: string; password: string }) =>
    request<{ user: SessionUser }>('/api/auth/admin-credentials', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.user),
  signup: (input: SignupInput) =>
    request<{ user: SessionUser }>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((data) => data.user),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
};

export interface AdminStats {
  total: number;
  buyers: number;
  sellers: number;
  admins: number;
  suspended: number;
}

export const adminApi = {
  users: (query = '') =>
    request<{ users: SessionUser[]; stats: AdminStats }>(
      `/api/admin/users${query ? `?q=${encodeURIComponent(query)}` : ''}`,
    ),
  setSuspended: (id: string, suspended: boolean) =>
    request<{ user: SessionUser }>(`/api/admin/users/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ suspended }),
    }).then((data) => data.user),
  remove: (id: string) =>
    request<{ deleted: string; email: string }>(
      `/api/admin/users/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    ),
};
