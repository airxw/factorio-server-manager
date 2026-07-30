// ============================================================================
// 鉴权上下文 — useAuth hook + AuthProvider
// token 存 localStorage（key: panel_token），登录后拉取 /auth/me 维持 user 状态
// 4.3: 401 触发导航到登录页（携带来源路径）
// 4.6: api.me() 缓存——登录后 sessionStorage 暂存 user，刷新时先恢复再校验
// 注：本文件含 JSX，故使用 .tsx 扩展名（JSX 不允许出现在 .ts 中）
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { LoginResponse, RegisterResponse, UserInfo, UserRole } from '@public/schema/panel-api-types';
import { createApiClient, PanelApiError, type PanelApiClient } from './client';
import { notificationStore } from '../stores/notificationStore';

export const TOKEN_KEY = 'panel_token';
const USER_CACHE_KEY = 'panel_user_cache';

/** 从 localStorage 读取 token（供非组件代码使用，如 WS hook） */
export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

interface AuthContextValue {
  user: UserInfo | null;
  token: string | null;
  initializing: boolean;
  /**
   * v3.8.0-S8: 登录成功后若后端返回 password_expired=true（管理员密码已过期），
   * 此 Promise resolve 携带该标记，调用方（如 Login.tsx）可据此提示用户修改密码。
   * v4.x: 同时返回 user，供调用方在登录后立即做角色判断与智能跳转（无需等待 state 刷新）。
   */
  login: (email: string, password: string) => Promise<{ passwordExpired?: boolean; user: UserInfo }>;
  register: (email: string, username: string, password: string) => Promise<void>;
  logout: () => void;
  /** 一.10: 重新拉取 /auth/me 刷新全局 user，供资料编辑后同步全局状态 */
  refreshUser: () => Promise<void>;
  /**
   * v4.17.0: 切换会话级活动角色。
   *
   * 用途：多角色账号（roles.length > 1）在已登录状态下切换 active_role。
   * 后端会进行二次密码校验（防 session hijack 提权），成功后签发新 JWT。
   *
   * @param email 当前账号邮箱（二次校验）
   * @param password 当前账号密码（二次校验）
   * @param activeRole 目标活动角色（必须 ∈ user.roles）
   * @throws PanelApiError 401/403/400
   */
  selectRole: (email: string, password: string, activeRole: UserRole) => Promise<void>;
  /**
   * v4.28.0: 免密切换同级身份（全员服主快捷互切）。
   *
   * 与 selectRole 的区别：无需 email+password 二次校验，仅凭当前 JWT
   * 切换 user ↔ instance_admin。server_admin 目标被后端 403 拒绝
   * （须走 selectRole 密码通道）。同层互切不撤销其他设备会话（SB-4）。
   *
   * @param activeRole 目标活动角色（仅 user / instance_admin，必须 ∈ user.roles）
   * @throws PanelApiError 400/401/403
   */
  switchActiveRole: (activeRole: UserRole) => Promise<void>;
  /**
   * v4.28.2: 角色切换进行中标记。
   * switchActiveRole/selectRole 更新 user 后到调用方 navigate 目标页之间存在渲染窗口——
   * 当前页 RequireRole 会以新 active_role 重新判定并把用户重定向到 /forbidden
   * （E2E 实测：/store 切回玩家后被 /store 守卫弹到 403）。
   * 切换期间 RequireRole 暂缓重定向，待调用方完成导航后由 switchActiveRole 自动清除。
   */
  roleSwitching: boolean;
  api: PanelApiClient;
  /** 4.9: 会话 key——登录/登出时递增，下游 useEffect 依赖此 key 可重置业务状态 */
  sessionKey: number;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getToken());
  // 4.6: 初始化时优先从 sessionStorage 恢复缓存的 user，避免白屏闪烁
  const [user, setUser] = useState<UserInfo | null>(() => {
    try {
      const cached = sessionStorage.getItem(USER_CACHE_KEY);
      return cached ? (JSON.parse(cached) as UserInfo) : null;
    } catch {
      return null;
    }
  });
  const [initializing, setInitializing] = useState(true);
  const [sessionKey, setSessionKey] = useState(0);
  const navigate = useNavigate();

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_CACHE_KEY);
    } catch {
      // ignore
    }
    setToken(null);
    setUser(null);
    // 4.9: 登出时递增 sessionKey，下游依赖此 key 的 useEffect 会重置业务状态
    setSessionKey((k) => k + 1);
  }, []);

  const api = useMemo(
    () =>
      createApiClient({
        token,
        // 4.3: 401 统一处理——登出 + 导航到登录页（携带来源路径）
        onUnauthorized: () => {
          logout();
          navigate('/login', {
            state: { from: window.location.pathname + window.location.search },
            replace: true,
          });
        },
      }),
    [token, logout, navigate],
  );

  // token 变化时拉取当前用户信息；无 token 直接清空
  useEffect(() => {
    if (!token) {
      setUser(null);
      setInitializing(false);
      return;
    }
    let cancelled = false;
    // v4.34.0-W7: /auth/me 初始化加载对非 401 失败做有限重试（429 限流/网络抖动）。
    // 此前任何错误都直接结束 initializing → ProtectedRoute 见 user=null 强制跳 /login，
    // E2E 全量并发触发后端 50req/s 限流时复现（真实用户遇限流也会被误踢）。
    // 401 由 createApiClient({ onUnauthorized }) 统一登出处理，不在此重试。
    const ME_RETRY_DELAYS_MS = [400, 1200];
    const fetchMe = (attempt: number): void => {
      api
        .me()
        .then((res) => {
          if (!cancelled) {
            setUser(res.user);
            // 4.6: 缓存 user 到 sessionStorage，刷新页面时先恢复
            try {
              sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
            } catch {
              // ignore
            }
            setInitializing(false);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          const is401 = err instanceof PanelApiError && err.status === 401;
          if (!is401 && attempt < ME_RETRY_DELAYS_MS.length) {
            const delay = ME_RETRY_DELAYS_MS[attempt];
            setTimeout(() => {
              if (!cancelled) fetchMe(attempt + 1);
            }, delay);
            return;
          }
          // 一.5: 不再在此清理 token，401 由 createApiClient({ onUnauthorized }) 统一处理。
          // 重试耗尽后结束 initializing；网络错误等情况保留 token 以便后续重试。
          setInitializing(false);
        });
    };
    fetchMe(0);
    return () => {
      cancelled = true;
    };
  }, [token, api]);

  const login = useCallback(async (email: string, password: string): Promise<{ passwordExpired?: boolean; user: UserInfo }> => {
    const tempApi = createApiClient({ token: null });
    const res: LoginResponse = await tempApi.login({ email, password });
    // v3.8.0-S8: 后端在管理员密码已过期时附加 password_expired 字段
    const passwordExpired = (res as LoginResponse & { password_expired?: boolean }).password_expired === true;
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
    } catch {
      // ignore
    }
    setToken(res.token);
    setUser(res.user);
    setSessionKey((k) => k + 1);
    return { user: res.user, ...(passwordExpired ? { passwordExpired: true } : {}) };
  }, []);

  const register = useCallback(async (email: string, username: string, password: string) => {
    // 注册入口无需 token（公开 API），使用临时无 token 客户端避免任何鉴权拦截
    const tempApi = createApiClient({ token: null });
    const res: RegisterResponse = await tempApi.register({ email, username, password });
    try {
      localStorage.setItem(TOKEN_KEY, res.token);
      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
    } catch {
      // ignore
    }
    setToken(res.token);
    setUser(res.user);
    setSessionKey((k) => k + 1);
  }, []);

  // 一.10: 资料编辑后刷新全局 user 状态
  const refreshUser = useCallback(async () => {
    const res = await api.me();
    setUser(res.user);
    try {
      sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
    } catch {
      // ignore
    }
  }, [api]);

  // v4.17.0: 切换会话级活动角色
  //   调用 /api/auth/select-role（带二次密码校验）→ 用新 token 替换旧 token + 更新 user
  //   失败时抛 PanelApiError，由调用方（RoleSwitcherModal）展示错误
  const selectRole = useCallback(
    async (email: string, password: string, activeRole: UserRole): Promise<void> => {
      const res = await api.selectRole({ email, password, active_role: activeRole });
      try {
        localStorage.setItem(TOKEN_KEY, res.token);
        sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
      } catch {
        // ignore
      }
      setToken(res.token);
      setUser(res.user);
      // 切换角色视为新会话——递增 sessionKey 触发下游 useEffect 重置业务状态
      // （避免缓存的服务器列表/钱包等以旧角色视角展示）
      setSessionKey((k) => k + 1);
    },
    [api],
  );

  // v4.28.0: 免密切换同级身份（全员服主快捷互切）
  //   调用 /api/auth/switch-role（JWT-only，免密）→ 用新 token 替换旧 token + 更新 user
  //   server_admin 目标被后端 403 拒绝；失败时抛 PanelApiError，由调用方展示错误
  const [roleSwitching, setRoleSwitching] = useState(false);
  const location = useLocation();
  // v4.28.2: roleSwitching 的清除时机——不能用 setTimeout(0)（E2E 实测：React 渲染宏任务
  //   可能排在 timeout 之后，标记被提前清除导致守卫仍旧误弹 /forbidden）。
  //   改为「路由变化即清除」：切换成功后调用方 navigate 到目标工作台，location 变化后的
  //   首个 commit 已落在新路由上，此时清除标记安全；另设 3s 兜底防调用方未导航导致标记卡死。
  const roleSwitchingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!roleSwitching) return;
    setRoleSwitching(false);
    if (roleSwitchingFallbackRef.current) {
      clearTimeout(roleSwitchingFallbackRef.current);
      roleSwitchingFallbackRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);
  const switchActiveRole = useCallback(
    async (activeRole: UserRole): Promise<void> => {
      // v4.28.2: 切换期间挂起路由守卫重定向，消除"user 已更新、URL 仍在旧工作台"
      // 渲染窗口内 RequireRole 把用户弹到 /forbidden 的竞态（E2E role-switching 实测捕获）
      setRoleSwitching(true);
      try {
        const res = await api.switchRole({ active_role: activeRole });
        try {
          localStorage.setItem(TOKEN_KEY, res.token);
          sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(res.user));
        } catch {
          // ignore
        }
        setToken(res.token);
        setUser(res.user);
        // 切换角色视为新会话——递增 sessionKey 触发下游 useEffect 重置业务状态
        setSessionKey((k) => k + 1);
      } catch (err) {
        setRoleSwitching(false);
        throw err;
      }
      // 兜底：调用方未触发导航时 3s 后强制清除，避免守卫长期挂起
      if (roleSwitchingFallbackRef.current) clearTimeout(roleSwitchingFallbackRef.current);
      roleSwitchingFallbackRef.current = setTimeout(() => {
        roleSwitchingFallbackRef.current = null;
        setRoleSwitching(false);
      }, 3000);
    },
    [api],
  );

  // v4.14.2: notificationStore 生命周期由 AuthProvider 管理（从 Layout 迁出）
  // user 非 null → init（幂等，refreshUser 导致的 user 引用变化不会重复连接）
  // user 变 null → destroy（登出/token失效时断开 WS + 清理状态）
  // 这样路由切换导致 Layout unmount/remount 不再影响 WS 连接和轮询
  useEffect(() => {
    if (user) {
      notificationStore.init();
    } else {
      notificationStore.destroy();
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({ user, token, initializing, login, register, logout, refreshUser, selectRole, switchActiveRole, roleSwitching, api, sessionKey }),
    [user, token, initializing, login, register, logout, refreshUser, selectRole, switchActiveRole, roleSwitching, api, sessionKey],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 AuthProvider 内部使用');
  }
  return ctx;
}
