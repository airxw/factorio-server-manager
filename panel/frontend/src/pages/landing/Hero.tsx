import { motion } from 'framer-motion';
import { ArrowRight, Crown, Gift, Server, ShoppingBag, TicketPercent, Vote } from 'lucide-react';

const reveal = {
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
};

export default function Hero() {
  const hookCards = [
    { name: '新手礼包', desc: '上线就能拿装备和起步资源', icon: Gift, tag: '刚进服就爽' },
    { name: '福利 CDKEY', desc: '活动、腐竹、社区都能发兑换码', icon: TicketPercent, tag: '福利丰厚' },
    { name: 'VIP 点券', desc: '充值、活动、签到都能变成购物能力', icon: Crown, tag: '有身份感' },
    { name: '网页商城', desc: '不进游戏也能先看能买什么', icon: ShoppingBag, tag: '消费更顺手' },
  ];

  const joinFlow = [
    '先挑一个已经在跑的服务器加入，直接感受礼包、商城和活动。',
    '别人收费不合理，或者根本没有你想要的玩法，那就自己开一个。',
    '你自己有服务器就免费接入，没有就直接租服当腐竹。',
  ];

  return (
    <section className="relative px-4 pb-16 pt-24 md:px-8 md:pb-24 md:pt-36">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)] lg:items-center">
        <div className="relative z-10 order-2 lg:order-1">
          <motion.div
            {...reveal}
            viewport={{ once: true }}
            transition={{ duration: 0.45 }}
            className="mb-5 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-4 py-2 font-mono text-xs uppercase tracking-[0.28em] text-amber-200"
          >
            先把爽点摆在玩家眼前
          </motion.div>

          <motion.h1
            {...reveal}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.06 }}
            className="max-w-4xl text-4xl font-black leading-[1.05] tracking-[-0.04em] text-zinc-50 sm:text-5xl sm:leading-[0.98] md:text-6xl md:leading-[0.95] lg:text-7xl lg:tracking-[-0.05em]"
          >
            新手礼包、VIP、商城、投票踢人
            <span className="mt-2 block text-amber-300">一眼就知道这个服有得玩</span>
          </motion.h1>

          <motion.p
            {...reveal}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.12 }}
            className="mt-6 max-w-2xl text-base leading-7 text-zinc-300 md:mt-8 md:text-lg md:leading-8"
          >
            先别讲架构，先讲欲望。玩家上线能领礼包，腐竹能发 CDKEY，VIP 能拿点券去商城买东西，
            有人作恶还能直接发起投票。
            <span className="font-semibold text-zinc-50">GameServer Panel</span>
            把这些最具吸引力的功能，直接做成进服前就能看见的产品入口。
          </motion.p>

          <motion.div
            {...reveal}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.18 }}
            className="mt-8 flex flex-col gap-3 sm:flex-row md:mt-10"
          >
            <button
              onClick={() => document.getElementById('journey')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-amber-300 px-6 py-3.5 text-sm font-bold uppercase tracking-[0.16em] text-zinc-950 transition hover:bg-amber-200 md:px-7 md:py-4"
            >
              先看怎么进服
              <ArrowRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => document.getElementById('games')?.scrollIntoView({ behavior: 'smooth' })}
              className="inline-flex items-center justify-center rounded-full border border-zinc-700 bg-zinc-900/70 px-6 py-3.5 text-sm font-semibold uppercase tracking-[0.16em] text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 md:px-7 md:py-4"
            >
              看支持哪些游戏
            </button>
          </motion.div>

          <motion.div
            {...reveal}
            viewport={{ once: true }}
            transition={{ duration: 0.55, delay: 0.24 }}
            className="mt-8 flex max-w-4xl flex-wrap gap-2 md:mt-10 md:gap-3"
          >
            {[
              '上线先领新手礼包',
              '腐竹发福利 CDKEY',
              'VIP 送点券进商城',
              '玩家投票踢人',
              '活动奖励送 VIP',
              '网页也能感受服内热闹',
            ].map((title) => (
              <div
                key={title}
                className="rounded-full border border-zinc-800 bg-zinc-900/55 px-3 py-2 text-xs font-medium text-zinc-200 shadow-[0_16px_60px_-36px_rgba(0,0,0,0.9)] md:px-4 md:py-3 md:text-sm"
              >
                {title}
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.65, delay: 0.12 }}
          className="relative order-1 lg:order-2"
        >
          <div className="absolute inset-0 -z-10 rounded-[2rem] bg-[radial-gradient(circle_at_top,rgba(251,191,36,0.18),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(34,211,238,0.16),transparent_36%)]" />

          <div className="rounded-[1.6rem] border border-zinc-800 bg-zinc-950/90 p-3 shadow-[0_30px_120px_-40px_rgba(0,0,0,0.95)] md:rounded-[2rem] md:p-4">
            <div className="grid gap-3 md:gap-4">
              <div className="rounded-[1.2rem] border border-amber-300/20 bg-[linear-gradient(145deg,rgba(39,24,7,0.95),rgba(11,12,16,0.95))] p-4 md:rounded-[1.6rem] md:p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber-200/70">Player Hooks</p>
                    <h2 className="mt-2 text-xl font-bold text-zinc-50 md:text-2xl">玩家为什么会点进来</h2>
                  </div>
                  <div className="rounded-2xl bg-amber-300/12 p-2.5 text-amber-300 md:p-3">
                    <Gift className="h-5 w-5" />
                  </div>
                </div>
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2 md:mt-5 md:gap-3">
                  {hookCards.map(({ name, desc, icon: Icon, tag }) => (
                    <div key={name} className="rounded-xl border border-amber-200/10 bg-black/25 p-3 md:rounded-2xl md:p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-zinc-50">{name}</h3>
                          <p className="mt-1 text-xs leading-5 text-zinc-400 md:text-sm md:leading-6">{desc}</p>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="rounded-full bg-amber-300/12 p-1.5 text-amber-300 md:p-2">
                            <Icon className="h-3.5 w-3.5 md:h-4 md:w-4" />
                          </span>
                          <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-zinc-950 md:px-3 md:py-1 md:text-xs">
                            {tag}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-[0.92fr_1.08fr] md:gap-4">
                <div className="rounded-[1.2rem] border border-emerald-300/15 bg-[linear-gradient(180deg,rgba(10,25,20,0.95),rgba(10,10,12,0.95))] p-4 md:rounded-[1.6rem] md:p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-emerald-200/70">Vote to Kick</p>
                      <h2 className="mt-2 text-lg font-bold leading-tight text-zinc-50 md:text-xl">服内出现违规行为，玩家自己能处理</h2>
                    </div>
                    <div className="rounded-2xl bg-emerald-300/12 p-2.5 text-emerald-300 md:p-3">
                      <Vote className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4 md:mt-5">
                    <div className="flex items-center justify-between text-sm text-zinc-300">
                      <span>投票进度</span>
                      <span>18 / 24</span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white/8 md:mt-3 md:h-3">
                      <div className="h-full w-3/4 rounded-full bg-[linear-gradient(90deg,#bef264,#4ade80)]" />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-zinc-400 md:mt-4 md:text-sm md:leading-6">
                      这不是后台功能，而是玩家会讨论、会参与、会感觉这个服真的有人气的地方。
                    </p>
                  </div>
                </div>

                <div className="rounded-[1.2rem] border border-cyan-300/15 bg-[linear-gradient(180deg,rgba(8,22,30,0.96),rgba(10,10,12,0.96))] p-4 md:rounded-[1.6rem] md:p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cyan-200/70">Join Flow</p>
                      <h2 className="mt-2 text-lg font-bold leading-tight text-zinc-50 md:text-xl">先加入现成服务器，不爽就自己开</h2>
                    </div>
                    <div className="rounded-2xl bg-cyan-300/12 p-2.5 text-cyan-300 md:p-3">
                      <Server className="h-5 w-5" />
                    </div>
                  </div>
                  <div className="mt-4 space-y-2 md:mt-5 md:space-y-3">
                    {joinFlow.map((line, index) => (
                      <div key={line} className="rounded-xl border border-white/8 bg-black/20 px-3 py-2.5 md:rounded-2xl md:px-4 md:py-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cyan-200/60">
                          Step 0{index + 1}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-zinc-200 md:mt-2 md:text-sm md:leading-6">
                          {line}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
