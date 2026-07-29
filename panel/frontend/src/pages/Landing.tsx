import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import BackgroundEffects from './landing/BackgroundEffects';
import Hero from './landing/Hero';
import FeatureGrid from './landing/FeatureGrid';
import ExperienceSection from './landing/ExperienceSection';

const NAV_LINKS = [
  { label: '玩家爽点', href: '#hooks' },
  { label: '开服路径', href: '#journey' },
  { label: '支持游戏', href: '#games' },
  { label: '角色体验', href: '#experience' },
];

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const handleNavClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    e.preventDefault();
    const target = document.querySelector(href);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100 selection:bg-amber-300/30 font-sans">
      <BackgroundEffects />

      {/* 顶部开发模式横幅 */}
      <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-300/15 bg-black/60 px-4 py-2 text-center text-xs text-amber-100 md:text-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
          </span>
          <span className="hidden sm:inline">当前为开发模式，主页会持续迭代，体验入口保持开放</span>
          <span className="sm:hidden">开发模式 · 体验入口开放</span>
        </div>
      </div>

      <header
        className={`sticky top-11 z-40 px-4 py-3 transition-all duration-300 md:top-0 md:px-8 md:py-5 ${
          scrolled ? 'bg-zinc-950/80' : 'bg-transparent'
        }`}
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between rounded-2xl border border-zinc-800 bg-black/50 px-4 py-3 md:rounded-full md:px-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-zinc-500">GameServer Panel</p>
            <h1 className="mt-1 text-sm font-semibold text-zinc-100 md:text-base">先让玩家想进服，再让服主愿意开服</h1>
          </div>

          {/* 桌面导航 */}
          <nav className="hidden items-center gap-6 text-sm text-zinc-400 md:flex">
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                onClick={(e) => handleNavClick(e, href)}
                className="transition hover:text-zinc-100"
              >
                {label}
              </a>
            ))}
          </nav>

          {/* 移动端菜单按钮 */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="flex h-11 w-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900/70 text-zinc-300 md:hidden"
            aria-label={mobileMenuOpen ? '关闭菜单' : '打开菜单'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* 移动端导航抽屉 */}
        {mobileMenuOpen && (
          <div className="mt-2 rounded-2xl border border-zinc-800 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-xl md:hidden">
            <nav className="flex flex-col gap-1">
              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={href}
                  href={href}
                  onClick={(e) => handleNavClick(e, href)}
                  className="rounded-lg px-4 py-3 text-sm font-medium text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-50"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main className="relative z-10">
        <Hero />
        <FeatureGrid />
        <ExperienceSection />
      </main>

      <footer className="relative z-10 mt-8 border-t border-zinc-900/80 px-4 py-10 md:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-zinc-500 md:flex-row md:items-center md:justify-between">
          <p>&copy; {new Date().getFullYear()} GameServer Panel</p>
          <p className="max-w-md leading-6 md:text-right">
            先让玩家看到爽点，再把人自然引到进服、接服和开服。
          </p>
        </div>
      </footer>
    </div>
  );
}
