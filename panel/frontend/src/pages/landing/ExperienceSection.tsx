import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BriefcaseBusiness, Gamepad2, ShieldEllipsis } from 'lucide-react';
import { useAuth } from '../../api/auth';
import { LoadingButton } from '../../components/ui';

interface RoleCard {
  id: 'player' | 'owner' | 'admin';
  title: string;
  tag: string;
  path: string;
  desc: string;
  route: string;
  email: string;
  buttonText: string;
  accent: string;
  icon: typeof Gamepad2;
}

const roles: RoleCard[] = [
  {
    id: 'player',
    title: '先加入现有服务器体验',
    tag: '第一入口',
    path: '先看爽点，再决定要不要留下',
    desc: '逛商城、看礼包、看投票、感受活动氛围。先让自己变成玩家，再判断这个生态值不值得继续投入。',
    route: '/guild',
    email: 'user@local.dev',
    buttonText: '以玩家身份进入',
    accent: 'amber',
    icon: Gamepad2,
  },
  {
    id: 'owner',
    title: '自己有服务器就免费接入',
    tag: '接服经营',
    path: '把现成机器接进来，开始做活动和商业化',
    desc: '玩家来了以后，服主最关心的就是怎么接住热度。商品、礼包、CDK、活动配置和实例管理都会在这里闭环。',
    route: '/store',
    email: 'manager@local.dev',
    buttonText: '以服主身份进入',
    accent: 'emerald',
    icon: BriefcaseBusiness,
  },
  {
    id: 'admin',
    title: '没服务器也能租服开整',
    tag: '平台兜底',
    path: '没有现成机器，就从平台能力开始起盘',
    desc: '如果前两层已经打动你，但你还没有自己的服务器，那就看平台底盘怎么把实例、权限和全局管理托起来。',
    route: '/admin',
    email: 'admin@local.dev',
    buttonText: '以管理员身份进入',
    accent: 'cyan',
    icon: ShieldEllipsis,
  },
];

export default function ExperienceSection() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);

  const handleQuickLogin = async (role: RoleCard) => {
    setLoadingRole(role.id);
    try {
      await login(role.email, 'admin123');
      navigate(role.route);
    } catch (err: any) {
      alert(`登录失败: ${err.message || '请检查后端服务'}`);
    } finally {
      setLoadingRole(null);
    }
  };

  const accentStyles: Record<RoleCard['accent'], { border: string; glow: string; badge: string; icon: string; button: string }> = {
    amber: {
      border: 'border-amber-300/18',
      glow: 'bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.12),transparent_38%)]',
      badge: 'bg-amber-300/12 text-amber-200 border-amber-300/20',
      icon: 'bg-amber-300/12 text-amber-300',
      button: 'bg-amber-300 text-zinc-950 hover:bg-amber-200',
    },
    emerald: {
      border: 'border-emerald-300/18',
      glow: 'bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.12),transparent_38%)]',
      badge: 'bg-emerald-300/12 text-emerald-200 border-emerald-300/20',
      icon: 'bg-emerald-300/12 text-emerald-300',
      button: 'bg-emerald-400 text-zinc-950 hover:bg-emerald-300',
    },
    cyan: {
      border: 'border-cyan-300/18',
      glow: 'bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.12),transparent_38%)]',
      badge: 'bg-cyan-300/12 text-cyan-200 border-cyan-300/20',
      icon: 'bg-cyan-300/12 text-cyan-300',
      button: 'bg-cyan-300 text-zinc-950 hover:bg-cyan-200',
    },
  };

  return (
    <section id="experience" className="px-4 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-7xl rounded-2xl border border-zinc-800 bg-zinc-950/78 p-5 shadow-[0_30px_120px_-42px_rgba(0,0,0,0.95)] md:rounded-[2.4rem] md:p-10">
        <div className="max-w-3xl">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">Try The Product</p>
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-zinc-50 md:text-5xl lg:text-6xl">
            不用填密码，直接沿着真实路径进入
          </h2>
          <p className="mt-4 text-sm leading-6 text-zinc-400 md:mt-5 md:text-lg md:leading-8">
            这不是三张平级名片，而是三条递进路径:
            玩家先体验现成服务器，服主再接入自己的服，最后平台能力负责把没服的人也托起来。
          </p>
        </div>

        <div className="mt-8 grid gap-4 md:mt-10 md:gap-6 lg:grid-cols-[1.18fr_0.92fr_0.9fr]">
          {roles.map((role, index) => {
            const accent = accentStyles[role.accent];
            const Icon = role.icon;
            return (
              <motion.article
                key={role.id}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.48, delay: index * 0.08 }}
                className={`relative overflow-hidden rounded-2xl border bg-[linear-gradient(180deg,rgba(17,17,19,0.96),rgba(10,10,12,0.98))] p-5 md:rounded-[2rem] md:p-7 ${accent.border}`}
              >
                <div className={`absolute inset-0 opacity-100 ${accent.glow}`} />
                <div className="relative z-10 flex h-full flex-col">
                  <div className="flex items-start justify-between gap-4">
                    <span className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.24em] ${accent.badge}`}>
                      {role.tag}
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600">0{index + 1}</span>
                  </div>

                  <div className={`mt-5 flex h-12 w-12 items-center justify-center rounded-2xl md:mt-6 md:h-14 md:w-14 ${accent.icon}`}>
                    <Icon className="h-5 w-5 md:h-6 md:w-6" />
                  </div>

                  <h3 className="mt-5 text-xl font-bold leading-tight text-zinc-50 md:mt-8 md:text-2xl">{role.title}</h3>
                  <p className="mt-2 text-sm font-medium leading-6 text-zinc-300">{role.path}</p>
                  <p className="mt-3 flex-1 text-xs leading-5 text-zinc-400 md:text-sm md:leading-7">{role.desc}</p>

                  <LoadingButton
                    loading={loadingRole === role.id}
                    onClick={() => handleQuickLogin(role)}
                    className={`mt-6 w-full rounded-full px-5 py-3.5 text-sm font-bold uppercase tracking-[0.14em] transition md:mt-8 md:py-4 ${accent.button}`}
                  >
                    {role.buttonText}
                  </LoadingButton>
                </div>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
