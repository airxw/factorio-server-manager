// ============================================================================
// AppVersionContext — 单一 fetch version，App 内任意位置 useAppVersion() 复用
// 替换 Home.tsx 中 Hero + Footer 双请求
// ============================================================================

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getVersion, APP_VERSION } from '../api/client';

export interface AppVersionValue {
  /** 后端返回的版本号；未就绪或失败时为 null */
  version: string | null;
  /** 构建期 fallback 版本号（package.json） */
  fallback: string;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否最终失败（用了 fallback） */
  failed: boolean;
}

const Ctx = createContext<AppVersionValue | null>(null);

export function AppVersionProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((res) => {
        if (!cancelled) {
          setVersion(res.version);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Ctx.Provider value={{ version, fallback: APP_VERSION, loading, failed }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAppVersion(): AppVersionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppVersion must be used within AppVersionProvider');
  return v;
}
