import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, type SessionUser, type SignupInput } from '../lib/api';

interface AuthContextValue {
  user: SessionUser | null;
  /** False until the first /api/auth/me call has answered. */
  ready: boolean;
  /** `identifier` is an email address or the admin username. */
  signIn: (identifier: string, password: string) => Promise<SessionUser>;
  signUp: (input: SignupInput) => Promise<SessionUser>;
  /** Replace the starter admin credentials with the admin's own. */
  updateAdminCredentials: (input: {
    currentPassword: string;
    username: string;
    password: string;
  }) => Promise<SessionUser>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    authApi
      .me()
      .then((session) => {
        if (alive) setUser(session);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const session = await authApi.login(identifier, password);
    setUser(session);
    return session;
  }, []);

  const updateAdminCredentials = useCallback(
    async (input: { currentPassword: string; username: string; password: string }) => {
      const session = await authApi.updateAdminCredentials(input);
      setUser(session);
      return session;
    },
    [],
  );

  const signUp = useCallback(async (input: SignupInput) => {
    const session = await authApi.signup(input);
    setUser(session);
    return session;
  }, []);

  const signOut = useCallback(async () => {
    await authApi.logout().catch(() => undefined);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, ready, signIn, signUp, updateAdminCredentials, signOut }),
    [user, ready, signIn, signUp, updateAdminCredentials, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
