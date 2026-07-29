// ============================================================================
// GameThemeContext — 游戏主题切换状态管理
// 支持 13 种主题：default + 12 款游戏（与 packs/ 目录对齐）
// 提供 switchGame(gameId) 触发粒子转场 + 主题切换
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type GameThemeId =
  | 'default'
  | 'minecraft'
  | 'factorio'
  | 'palworld'
  | 'ark'
  | 'rust'
  | 'terraria'
  | 'valheim'
  | 'zomboid';

export const ALL_GAME_IDS: GameThemeId[] = [
  'default',
  'minecraft',
  'factorio',
  'palworld',
  'ark',
  'rust',
  'terraria',
  'valheim',
  'zomboid',
];

export interface GameThemeConfig {
  id: GameThemeId;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  bgGlow1: string;
  bgGlow2: string;
  glowColor: string;
  particleColor: string;
  particleShape: 'square' | 'circle';
  gradientText: string;
}

export const GAME_THEMES: Record<GameThemeId, GameThemeConfig> = {
  default: {
    id: 'default',
    name: '通用',
    primary: '#06b6d4',
    secondary: '#a855f7',
    accent: '#22d3ee',
    bgGlow1: 'rgba(168, 85, 247, 0.13)',
    bgGlow2: 'rgba(6, 182, 212, 0.12)',
    glowColor: 'rgba(34, 211, 238, 0.4)',
    particleColor: '#22d3ee',
    particleShape: 'circle',
    gradientText: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 40%, #a855f7 100%)',
  },
  minecraft: {
    id: 'minecraft',
    name: 'Minecraft',
    primary: '#22c55e',
    secondary: '#16a34a',
    accent: '#4ade80',
    bgGlow1: 'rgba(34, 197, 94, 0.18)',
    bgGlow2: 'rgba(22, 163, 74, 0.10)',
    glowColor: 'rgba(34, 197, 94, 0.45)',
    particleColor: '#22c55e',
    particleShape: 'square',
    gradientText: 'linear-gradient(135deg, #22c55e 0%, #4ade80 50%, #86efac 100%)',
  },
  factorio: {
    id: 'factorio',
    name: 'Factorio',
    primary: '#f97316',
    secondary: '#ea580c',
    accent: '#fb923c',
    bgGlow1: 'rgba(249, 115, 22, 0.18)',
    bgGlow2: 'rgba(234, 88, 12, 0.10)',
    glowColor: 'rgba(249, 115, 22, 0.45)',
    particleColor: '#f97316',
    particleShape: 'circle',
    gradientText: 'linear-gradient(135deg, #f97316 0%, #fb923c 50%, #fdba74 100%)',
  },
  palworld: {
    id: 'palworld',
    name: 'Palworld',
    primary: '#06b6d4',
    secondary: '#0891b2',
    accent: '#22d3ee',
    bgGlow1: 'rgba(6, 182, 212, 0.18)',
    bgGlow2: 'rgba(8, 145, 178, 0.10)',
    glowColor: 'rgba(6, 182, 212, 0.45)',
    particleColor: '#22d3ee',
    particleShape: 'circle',
    gradientText: 'linear-gradient(135deg, #06b6d4 0%, #22d3ee 50%, #67e8f9 100%)',
  },
  ark: {
    id: 'ark',
    name: 'ARK',
    primary: '#a855f7',
    secondary: '#9333ea',
    accent: '#c084fc',
    bgGlow1: 'rgba(168, 85, 247, 0.18)',
    bgGlow2: 'rgba(147, 51, 234, 0.10)',
    glowColor: 'rgba(168, 85, 247, 0.45)',
    particleColor: '#c084fc',
    particleShape: 'circle',
    gradientText: 'linear-gradient(135deg, #a855f7 0%, #c084fc 50%, #d8b4fe 100%)',
  },
  rust: {
    id: 'rust',
    name: 'RUST',
    primary: '#ef4444',
    secondary: '#dc2626',
    accent: '#f87171',
    bgGlow1: 'rgba(239, 68, 68, 0.18)',
    bgGlow2: 'rgba(220, 38, 38, 0.10)',
    glowColor: 'rgba(239, 68, 68, 0.45)',
    particleColor: '#f87171',
    particleShape: 'square',
    gradientText: 'linear-gradient(135deg, #ef4444 0%, #f87171 50%, #fca5a5 100%)',
  },
  terraria: {
    id: 'terraria',
    name: 'Terraria',
    primary: '#10b981',
    secondary: '#059669',
    accent: '#34d399',
    bgGlow1: 'rgba(16, 185, 129, 0.18)',
    bgGlow2: 'rgba(5, 150, 105, 0.10)',
    glowColor: 'rgba(16, 185, 129, 0.45)',
    particleColor: '#34d399',
    particleShape: 'square',
    gradientText: 'linear-gradient(135deg, #059669 0%, #10b981 50%, #34d399 100%)',
  },
  valheim: {
    id: 'valheim',
    name: 'Valheim',
    primary: '#64748b',
    secondary: '#475569',
    accent: '#94a3b8',
    bgGlow1: 'rgba(100, 116, 139, 0.18)',
    bgGlow2: 'rgba(71, 85, 105, 0.10)',
    glowColor: 'rgba(148, 163, 184, 0.45)',
    particleColor: '#94a3b8',
    particleShape: 'circle',
    gradientText: 'linear-gradient(135deg, #475569 0%, #64748b 50%, #94a3b8 100%)',
  },
  zomboid: {
    id: 'zomboid',
    name: 'Project Zomboid',
    primary: '#84cc16',
    secondary: '#65a30d',
    accent: '#a3e635',
    bgGlow1: 'rgba(132, 204, 22, 0.18)',
    bgGlow2: 'rgba(101, 163, 13, 0.10)',
    glowColor: 'rgba(132, 204, 22, 0.45)',
    particleColor: '#a3e635',
    particleShape: 'square',
    gradientText: 'linear-gradient(135deg, #65a30d 0%, #84cc16 50%, #a3e635 100%)',
  },
};

interface GameThemeContextValue {
  theme: GameThemeId;
  config: GameThemeConfig;
  isTransitioning: boolean;
  pendingTheme: GameThemeId | null;
  switchGame: (gameId: GameThemeId) => void;
  goDefault: () => void;
}

const GameThemeContext = createContext<GameThemeContextValue | null>(null);

const STORAGE_KEY = 'gsp-game-theme';

function isGameThemeId(value: string | null): value is GameThemeId {
  if (!value) return false;
  return ALL_GAME_IDS.includes(value as GameThemeId);
}

function getInitialTheme(): GameThemeId {
  if (typeof window === 'undefined') return 'default';
  const hash = window.location.hash.replace('#', '');
  if (isGameThemeId(hash)) {
    return hash;
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && isGameThemeId(saved)) {
      return saved;
    }
  } catch {
    /* ignore */
  }
  return 'default';
}

export function GameThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<GameThemeId>(getInitialTheme);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const pendingThemeRef = useRef<GameThemeId | null>(null);

  const config = useMemo(() => GAME_THEMES[theme], [theme]);

  // 同步到 data-theme 属性 + localStorage + hash
  useEffect(() => {
    document.documentElement.setAttribute('data-game-theme', theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    if (theme === 'default') {
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } else {
      history.replaceState(null, '', `#${theme}`);
    }
  }, [theme]);

  // 监听 hashchange（浏览器前进后退）
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#', '');
      if (isGameThemeId(hash)) {
        setTheme(hash);
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const switchGame = useCallback((gameId: GameThemeId) => {
    if (gameId === theme || isTransitioning) return;
    pendingThemeRef.current = gameId;
    setIsTransitioning(true);
  }, [theme, isTransitioning]);

  const goDefault = useCallback(() => {
    switchGame('default');
  }, [switchGame]);

  // 供转场组件在中途调用，标记"已到 commit 点"（闪光等视觉锚点用）
  const commitTheme = useCallback(() => {
    // 不在这里 setTheme——否则 GameTransition 的 effect 会因 theme 依赖变化
    // 而重新执行，导致 creeper 等动画对象被重置 → 双重爆炸 bug。
    // theme 在 finishTransition 中与 setIsTransitioning(false) 一起变更，
    // React 18 自动批处理，一次渲染同时消化两个变更。
  }, []);

  // 供转场组件在结束时调用，实际切换主题 + 重置 transitioning 状态
  const finishTransition = useCallback(() => {
    if (pendingThemeRef.current) {
      setTheme(pendingThemeRef.current);
      pendingThemeRef.current = null;
    }
    setIsTransitioning(false);
  }, []);

  const value = useMemo<GameThemeContextValue>(
    () => ({
      theme,
      config,
      isTransitioning,
      pendingTheme: isTransitioning ? pendingThemeRef.current : null,
      switchGame,
      goDefault,
    }),
    [theme, config, isTransitioning, switchGame, goDefault],
  );

  // 通过 ref 暴露内部方法给转场组件（避免 context 膨胀）
  useEffect(() => {
    (window as unknown as { __gspThemeCommit?: () => void; __gspThemeFinish?: () => void }).__gspThemeCommit =
      commitTheme;
    (window as unknown as { __gspThemeCommit?: () => void; __gspThemeFinish?: () => void }).__gspThemeFinish =
      finishTransition;
  }, [commitTheme, finishTransition]);

  return (
    <GameThemeContext.Provider value={value}>{children}</GameThemeContext.Provider>
  );
}

export function useGameTheme() {
  const ctx = useContext(GameThemeContext);
  if (!ctx) {
    throw new Error('useGameTheme must be used within GameThemeProvider');
  }
  return ctx;
}
