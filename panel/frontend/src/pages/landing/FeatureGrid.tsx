import { motion } from 'framer-motion';
import {
  Boxes,
  Coins,
  Gamepad2,
  Gift,
  ShieldCheck,
  Sparkles,
  Store,
  TicketPercent,
  Vote,
  Wrench,
} from 'lucide-react';
import { GAME_CATALOG } from '../../data/game-catalog';

const playerHooks = [
  {
    title: '新手礼包先把开局抬起来',
    desc: '刚进服就有装备、资源和目标，玩家不会一进来就空着手发呆。',
    icon: Gift,
    tone: 'amber',
  },
  {
    title: '福利 CDKEY 让活动变成传播点',
    desc: '腐竹发码、主播发码、节日发码，福利有抓手，拉新也有理由。',
    icon: TicketPercent,
    tone: 'emerald',
  },
  {
    title: 'VIP、商城、投票让人有参与感',
    desc: '身份、消费、治理都摆在明面上，玩家会觉得自己不是路过，而是真的能影响服务器。',
    icon: Vote,
    tone: 'cyan',
  },
];

const ownerCapabilities = [
  {
    title: '玩家先加入现成服务器',
    desc: '先让人找到已经热闹、已经有玩法、已经有福利的服务器，而不是先让人看说明文档。',
    icon: Gamepad2,
  },
  {
    title: '不满意现有玩法就自己开',
    desc: '别人收费高、管理差、没有你想玩的内容，那就自己当腐竹，把兄弟都拉进来。',
    icon: Coins,
  },
  {
    title: '自己有服务器就免费接入',
    desc: '把已有机器和实例接进来，用商城、活动、运营能力继续做大。',
    icon: Wrench,
  },
  {
    title: '自己没服务器就直接租服',
    desc: '不需要先懂一堆运维，直接租到可用实例，先把服开起来再慢慢经营。',
    icon: Store,
  },
];

const operatorCapabilities = [
  {
    title: '把玩家热度变成订单',
    desc: '商品上架、活动定价、CDK 发放、订单追踪，都在同一套面板里闭环。',
    icon: Coins,
  },
  {
    title: '有效降低开服门槛',
    desc: '一键部署游戏、装包、换图、改配置，让服主更像经营者，不再像维修工。',
    icon: Wrench,
  },
  {
    title: '把扩张交给稳定底盘',
    desc: '玩家越多、实例越多，底层调度、隔离和集群能力才开始真正值钱。',
    icon: ShieldCheck,
  },
];

export default function FeatureGrid() {
  const supportedGames = GAME_CATALOG.slice(0, 10);

  return (
    <section className="px-4 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          id="hooks"
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.45 }}
          className="mb-10 max-w-3xl md:mb-12"
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">Player Hooks First</p>
          <h2 className="mt-4 text-3xl font-black tracking-[-0.04em] text-zinc-50 md:text-5xl lg:text-6xl">
            先让玩家看到爽点，才有后面的所有转化
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400 md:mt-5 md:text-lg md:leading-8">
            真正有吸引力的首页，不是先说你用了什么技术，而是让人一眼明白:
            这里有礼包、有福利、有身份感、有购物、有活动，还有玩家自己能参与治理的氛围。
          </p>
        </motion.div>

        <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
          {playerHooks.map(({ title, desc, icon: Icon, tone }, index) => {
            const toneMap: Record<string, string> = {
              amber: 'border-amber-300/18 bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.12),transparent_35%),linear-gradient(180deg,rgba(24,17,7,0.95),rgba(10,10,12,0.95))] text-amber-300',
              emerald: 'border-emerald-300/18 bg-[radial-gradient(circle_at_top,rgba(74,222,128,0.12),transparent_35%),linear-gradient(180deg,rgba(10,22,16,0.95),rgba(10,10,12,0.95))] text-emerald-300',
              cyan: 'border-cyan-300/18 bg-[radial-gradient(circle_at_top,rgba(103,232,249,0.12),transparent_35%),linear-gradient(180deg,rgba(8,20,24,0.95),rgba(10,10,12,0.95))] text-cyan-300',
            };

            return (
              <motion.article
                key={title}
                initial={{ opacity: 0, y: 22 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-80px' }}
                transition={{ duration: 0.48, delay: index * 0.08 }}
                className={`rounded-2xl border p-5 shadow-[0_26px_90px_-48px_rgba(0,0,0,0.95)] md:rounded-[2rem] md:p-7 ${toneMap[tone]}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="rounded-2xl bg-black/25 p-3">
                    <Icon className="h-5 w-5 md:h-6 md:w-6" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-zinc-500">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-6 text-xl font-bold leading-tight text-zinc-50 md:mt-8 md:text-2xl">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-zinc-400 md:mt-4 md:text-[15px] md:leading-7">{desc}</p>
              </motion.article>
            );
          })}
        </div>

        <motion.div
          id="journey"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.52 }}
          className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 md:mt-8 md:rounded-[2rem] md:p-10"
        >
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">Join Then Build</p>
              <h2 className="mt-4 text-2xl font-black tracking-[-0.04em] text-zinc-50 md:text-4xl lg:text-5xl">
                先进现成服务器，觉得不爽就自己开一个
              </h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400 md:mt-5 md:text-base md:leading-8">
                这才是自然的增长路径。玩家先因为玩法和福利进来，接着发现自己也可以免费接入已有服务器，
                或者干脆租一台新服，自己定规则，自己带兄弟玩。
              </p>

              <div className="mt-6 grid gap-3 sm:grid-cols-3 md:mt-8">
                {[
                  ['先加入', '现成热服先体验'],
                  ['再判断', '不满意现状就自己开'],
                  ['后放大', '接服或租服开始经营'],
                ].map(([title, desc]) => (
                  <div key={title} className="rounded-xl border border-zinc-800 bg-black/20 p-3 md:rounded-2xl md:p-4">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-zinc-500">运营节点</p>
                    <h3 className="mt-2 text-base font-semibold text-zinc-100 md:mt-3 md:text-lg">{title}</h3>
                    <p className="mt-1 text-xs leading-5 text-zinc-400 md:text-sm md:leading-6">{desc}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:gap-4">
              {ownerCapabilities.map(({ title, desc, icon: Icon }, index) => (
                <div
                  key={title}
                  className="rounded-xl border border-zinc-800 bg-[linear-gradient(135deg,rgba(255,255,255,0.02),rgba(255,255,255,0.00))] p-4 md:rounded-[1.6rem] md:p-5"
                >
                  <div className="flex items-start gap-3 md:gap-4">
                    <div className="rounded-2xl bg-zinc-800/90 p-2.5 text-zinc-100 md:p-3">
                      <Icon className="h-4 w-4 md:h-5 md:w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-4">
                        <h3 className="text-base font-semibold text-zinc-50 md:text-lg">{title}</h3>
                        <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600 sm:inline">
                          Step 0{index + 1}
                        </span>
                      </div>
                      <p className="mt-1 text-xs leading-5 text-zinc-400 md:mt-2 md:text-sm md:leading-7">{desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          id="games"
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.52 }}
          className="mt-6 rounded-2xl border border-zinc-800 bg-[linear-gradient(120deg,rgba(20,13,7,0.94),rgba(9,9,11,0.96))] p-5 md:mt-8 md:rounded-[2rem] md:p-10"
        >
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="max-w-3xl">
              <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">Supported Games</p>
              <h2 className="mt-4 text-2xl font-black tracking-[-0.04em] text-zinc-50 md:text-4xl lg:text-5xl">
                支持这些游戏，接服和开服都不是空话
              </h2>
              <p className="mt-4 text-sm leading-6 text-zinc-400 md:mt-5 md:text-base md:leading-8">
                不只是讲概念，首页直接把能接入、能经营、能上线的游戏摆出来。
                你有现成服可以接，你没有现成服也知道自己能从哪里开局。
              </p>
            </div>
            <div className="shrink-0 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm font-medium text-amber-100">
              已覆盖 {supportedGames.length}+ 款主流生存 / 沙盒 / 建造类游戏
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 md:mt-8 md:gap-4 max-[479px]:grid-cols-1">
            {supportedGames.map((game, index) => (
              <div
                key={game.id}
                className="rounded-xl border border-zinc-800 bg-black/20 p-4 shadow-[0_26px_90px_-48px_rgba(0,0,0,0.95)] md:rounded-[1.6rem] md:p-5"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xl md:text-2xl">{game.icon}</p>
                    <h3 className="mt-2 text-base font-semibold text-zinc-50 md:text-lg">{game.name}</h3>
                    <p className="mt-0.5 text-xs text-zinc-500 md:text-sm">{game.tagline}</p>
                  </div>
                  <span className="hidden font-mono text-[10px] uppercase tracking-[0.24em] text-zinc-600 sm:inline">G{index + 1}</span>
                </div>
                <p className="mt-3 text-xs leading-5 text-zinc-400 md:mt-4 md:text-sm md:leading-7">{game.desc}</p>
                <div className="mt-3 flex flex-wrap gap-1.5 md:mt-4 md:gap-2">
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 md:px-3 md:py-1 md:text-xs">{game.category}</span>
                  <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-300 md:px-3 md:py-1 md:text-xs">{game.features}</span>
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 22 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.52 }}
          className="mt-6 rounded-2xl border border-zinc-800 bg-[linear-gradient(120deg,rgba(14,17,22,0.94),rgba(9,9,11,0.96))] p-5 md:mt-8 md:rounded-[2rem] md:p-10"
        >
          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr] lg:items-center">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-zinc-500">Platform Backbone</p>
              <h2 className="mt-4 text-2xl font-black tracking-[-0.04em] text-zinc-50 md:text-4xl lg:text-5xl">
                等玩家和服主都来了，平台底盘再出来兜底
              </h2>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-400 md:mt-5 md:text-base md:leading-8">
                Panel-Daemon 不是首页第一句话，但它必须是最后的信任背书。
                它负责把成百上千个实例、订单和实时消息，稳稳地托起来。
              </p>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-black/20 p-4 md:rounded-[1.6rem] md:p-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-zinc-800 p-2.5 text-zinc-100 md:p-3">
                  <Boxes className="h-4 w-4 md:h-5 md:w-5" />
                </div>
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.26em] text-zinc-500">Cluster Summary</p>
                  <h3 className="mt-1 text-base font-semibold text-zinc-50 md:text-lg">稳定不是口号，是产品的最后一层说服力</h3>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:mt-6 md:gap-4">
                {operatorCapabilities.map(({ title, desc, icon: Icon }) => (
                  <div key={title} className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 md:rounded-2xl md:p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-2xl bg-zinc-800 p-2 text-zinc-100 md:p-2.5">
                        <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
                        <p className="mt-1 text-xs leading-5 text-zinc-300 md:text-sm md:leading-7">{desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
                {[
                  '分布式 Panel-Daemon 调度，实例和节点可以拆开扩容',
                  'RCON 指令隔离沙箱，把危险操作关在边界里',
                  '实时事件流和状态同步，让商城、聊天、投票都能及时反馈',
                ].map((line) => (
                  <div key={line} className="flex items-start gap-3 rounded-xl border border-zinc-800 bg-zinc-950/70 p-3 md:rounded-2xl md:p-4">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300 md:h-4 md:w-4" />
                    <p className="text-xs leading-5 text-zinc-300 md:text-sm md:leading-7">{line}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
