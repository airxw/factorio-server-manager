// ============================================================================
// DemoShowcase — 动态演示组件
// 左侧：游戏内对话框（像素风）
// 右侧：浏览器商城面板
// 自动循环演示：登录欢迎、新手礼包、商城购物、投票踢人、CDK兑换、礼包领取
// ============================================================================

import { useEffect, useState } from 'react';
import { Check, Crown, Gift, Package, ShoppingBag } from 'lucide-react';

// ============================================================================
// 演示场景定义
// ============================================================================

interface DemoScene {
  id: string;
  title: string;
  duration: number; // 毫秒
  gameMessages: { text: string; delay: number; type?: 'system' | 'success' | 'warning' | 'player' }[];
  shopAction?: {
    type: 'browse' | 'buy' | 'success' | 'vote' | 'redeem';
    item?: string;
    price?: string;
    delay: number;
  };
}

const DEMO_SCENES: DemoScene[] = [
  // 场景 1：登录欢迎 + 新手礼包
  {
    id: 'welcome',
    title: '登录欢迎 + 新手礼包',
    duration: 8000,
    gameMessages: [
      { text: '§e§l[系统] §7欢迎玩家 Steve 加入服务器！', delay: 500, type: 'system' },
      { text: '§a§l[礼包] §7你获得了 §e新手礼包§7！', delay: 2000, type: 'success' },
      { text: '§7  × 钻石剑 ×1', delay: 2500, type: 'success' },
      { text: '§7  × 金苹果 ×5', delay: 3000, type: 'success' },
      { text: '§7  × 经验瓶 ×10', delay: 3500, type: 'success' },
      { text: '§b[提示] §7输入 §e/gift §7查看礼包详情', delay: 5000, type: 'system' },
    ],
  },
  // 场景 2：商城购物
  {
    id: 'shop',
    title: '商城购物',
    duration: 10000,
    gameMessages: [
      { text: '§7[Steve] 我要买个VIP', delay: 500, type: 'player' },
      { text: '§e[系统] §7正在处理订单...', delay: 2000, type: 'system' },
      { text: '§a§l[商城] §7购买成功！', delay: 4000, type: 'success' },
      { text: '§7  §6VIP 黄金会员 §7× 30天', delay: 4500, type: 'success' },
      { text: '§a§l[商城] §7权限已自动激活', delay: 5500, type: 'success' },
      { text: '§b[提示] §7输入 §e/vip §7查看VIP状态', delay: 7000, type: 'system' },
    ],
    shopAction: {
      type: 'buy',
      item: 'VIP 黄金会员',
      price: '¥98',
      delay: 3000,
    },
  },
  // 场景 3：投票踢人
  {
    id: 'vote',
    title: '投票踢人',
    duration: 9000,
    gameMessages: [
      { text: '§7[Alex] 有人开挂！', delay: 500, type: 'player' },
      { text: '§7[Steve] 发起投票：踢出 Hacker123', delay: 1500, type: 'player' },
      { text: '§e§l[投票] §7投票进行中... 3/5 同意', delay: 3000, type: 'warning' },
      { text: '§a§l[投票] §7投票通过！', delay: 5000, type: 'success' },
      { text: '§c§l[系统] §7Hacker123 已被踢出服务器', delay: 6000, type: 'success' },
      { text: '§b[提示] §7输入 §e/vote §7发起新投票', delay: 7500, type: 'system' },
    ],
    shopAction: {
      type: 'vote',
      item: '踢出 Hacker123',
      delay: 2500,
    },
  },
  // 场景 4：CDK 兑换
  {
    id: 'cdk',
    title: 'CDK 兑换',
    duration: 8000,
    gameMessages: [
      { text: '§7[Steve] 兑换码：GSP-2024-GOLD', delay: 500, type: 'player' },
      { text: '§e[系统] §7验证兑换码...', delay: 2000, type: 'system' },
      { text: '§a§l[CDK] §7兑换成功！', delay: 3500, type: 'success' },
      { text: '§7  §6金币 ×1000', delay: 4000, type: 'success' },
      { text: '§7  §5钻石 ×50', delay: 4500, type: 'success' },
      { text: '§b[提示] §7输入 §e/cdk §7查看兑换历史', delay: 6000, type: 'system' },
    ],
    shopAction: {
      type: 'redeem',
      item: 'GSP-2024-GOLD',
      delay: 1500,
    },
  },
  // 场景 5：礼包领取
  {
    id: 'gift',
    title: '礼包领取',
    duration: 7000,
    gameMessages: [
      { text: '§7[Steve] 领取每日礼包', delay: 500, type: 'player' },
      { text: '§a§l[礼包] §7领取成功！', delay: 2000, type: 'success' },
      { text: '§7  §e经验 ×500', delay: 2500, type: 'success' },
      { text: '§7  §a绿宝石 ×3', delay: 3000, type: 'success' },
      { text: '§7  §c附魔书 ×1', delay: 3500, type: 'success' },
      { text: '§b[提示] §7每日礼包已刷新：明天 00:00', delay: 5000, type: 'system' },
    ],
    shopAction: {
      type: 'success',
      item: '每日礼包',
      delay: 1500,
    },
  },
];

// ============================================================================
// 游戏对话框组件（像素风）
// ============================================================================

function GameChatBox({ messages, sceneTitle }: { messages: DemoScene['gameMessages']; sceneTitle: string }) {
  const [visibleMessages, setVisibleMessages] = useState<typeof messages>([]);

  useEffect(() => {
    setVisibleMessages([]);
    const timers: ReturnType<typeof setTimeout>[] = [];

    messages.forEach((msg) => {
      const timer = setTimeout(() => {
        setVisibleMessages((prev) => [...prev, msg]);
      }, msg.delay);
      timers.push(timer);
    });

    return () => timers.forEach(clearTimeout);
  }, [messages, sceneTitle]);

  const formatMessage = (text: string) => {
    // 解析 Minecraft 风格的颜色代码
    const parts = text.split(/§[0-9a-fk-or]/gi);
    let formatted = '';
    let color = '#aaaaaa';

    const colorMap: Record<string, string> = {
      '§0': '#000000', '§1': '#0000aa', '§2': '#00aa00', '§3': '#00aaaa',
      '§4': '#aa0000', '§5': '#aa00aa', '§6': '#ffaa00', '§7': '#aaaaaa',
      '§8': '#555555', '§9': '#5555ff', '§a': '#55ff55', '§b': '#55ffff',
      '§c': '#ff5555', '§d': '#ff55ff', '§e': '#ffff55', '§f': '#ffffff',
    };

    let i = 0;
    for (const part of parts) {
      if (i > 0) {
        const code = text.match(/§[0-9a-fk-or]/gi)?.[i - 1];
        if (code && colorMap[code]) {
          color = colorMap[code];
        }
      }
      formatted += `<span style="color: ${color}">${part}</span>`;
      i++;
    }

    return formatted;
  };

  return (
    <div className="demo-game-chat">
      <div className="demo-game-chat-header">
        <span className="demo-game-chat-title">游戏内对话框</span>
        <span className="demo-game-chat-server">Minecraft-1</span>
      </div>
      <div className="demo-game-chat-body">
        {visibleMessages.map((msg, idx) => (
          <div
            key={idx}
            className={`demo-game-chat-message demo-game-chat-${msg.type || 'system'}`}
            dangerouslySetInnerHTML={{ __html: formatMessage(msg.text) }}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// 商城面板组件
// ============================================================================

function ShopPanel({ action, sceneTitle }: { action?: DemoScene['shopAction']; sceneTitle: string }) {
  const [state, setState] = useState<'idle' | 'browsing' | 'buying' | 'success'>('idle');
  const [selectedItem, setSelectedItem] = useState<string>('');

  useEffect(() => {
    setState('idle');
    setSelectedItem('');

    if (!action) return;

    const browseTimer = setTimeout(() => {
      setState('browsing');
      setSelectedItem(action.item || '');
    }, 1000);

    const buyTimer = setTimeout(() => {
      setState('buying');
    }, action.delay);

    const successTimer = setTimeout(() => {
      setState('success');
    }, action.delay + 1500);

    return () => {
      clearTimeout(browseTimer);
      clearTimeout(buyTimer);
      clearTimeout(successTimer);
    };
  }, [action, sceneTitle]);

  const shopItems = [
    { name: 'VIP 黄金会员', price: '¥98', icon: Crown, color: '#facc15' },
    { name: '钻石礼包', price: '¥38', icon: Gift, color: '#c084fc' },
    { name: '经验加成', price: '¥18', icon: Package, color: '#22d3ee' },
  ];

  return (
    <div className="demo-shop-panel">
      <div className="demo-shop-header">
        <ShoppingBag size={16} />
        <span>玩家商城</span>
      </div>
      <div className="demo-shop-body">
        <div className="demo-shop-items">
          {shopItems.map((item) => {
            const Icon = item.icon;
            const isSelected = selectedItem === item.name;
            const isBuying = state === 'buying' && isSelected;
            const isSuccess = state === 'success' && isSelected;

            return (
              <div
                key={item.name}
                className={`demo-shop-item ${isSelected ? 'selected' : ''} ${isBuying ? 'buying' : ''} ${isSuccess ? 'success' : ''}`}
                style={{ ['--item-color' as string]: item.color }}
              >
                <div className="demo-shop-item-icon">
                  <Icon size={20} style={{ color: item.color }} />
                </div>
                <div className="demo-shop-item-info">
                  <div className="demo-shop-item-name">{item.name}</div>
                  <div className="demo-shop-item-price">{item.price}</div>
                </div>
                {isBuying && <div className="demo-shop-item-loading">购买中...</div>}
                {isSuccess && <div className="demo-shop-item-check"><Check size={16} /></div>}
              </div>
            );
          })}
        </div>

        {state === 'success' && action && (
          <div className="demo-shop-success-banner">
            <Check size={20} />
            <span>购买成功！物品已自动发放</span>
          </div>
        )}

        {action?.type === 'vote' && state !== 'idle' && (
          <div className="demo-shop-vote-banner">
            <div className="demo-shop-vote-title">投票：{action.item}</div>
            <div className="demo-shop-vote-progress">
              <div className="demo-shop-vote-bar" style={{ width: state === 'success' ? '100%' : '60%' }} />
            </div>
            <div className="demo-shop-vote-count">
              {state === 'success' ? '5/5 通过' : '3/5 进行中'}
            </div>
          </div>
        )}

        {action?.type === 'redeem' && state !== 'idle' && (
          <div className="demo-shop-redeem-banner">
            <div className="demo-shop-redeem-input">{action.item}</div>
            <div className="demo-shop-redeem-status">
              {state === 'success' ? '✓ 兑换成功' : '验证中...'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 主组件
// ============================================================================

export default function DemoShowcase() {
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const currentScene = DEMO_SCENES[currentSceneIdx];

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentSceneIdx((prev) => (prev + 1) % DEMO_SCENES.length);
    }, currentScene.duration);

    return () => clearInterval(timer);
  }, [currentScene.duration]);

  return (
    <div className="demo-showcase" data-reveal>
      <div className="demo-showcase-header">
        <h3 className="demo-showcase-title">实时演示</h3>
        <div className="demo-showcase-scene-indicator">
          {DEMO_SCENES.map((scene, idx) => (
            <div
              key={scene.id}
              className={`demo-scene-dot ${idx === currentSceneIdx ? 'active' : ''}`}
            />
          ))}
        </div>
      </div>

      <div className="demo-showcase-content">
        <GameChatBox messages={currentScene.gameMessages} sceneTitle={currentScene.title} />
        <ShopPanel action={currentScene.shopAction} sceneTitle={currentScene.title} />
      </div>

      <div className="demo-showcase-scene-name">{currentScene.title}</div>
    </div>
  );
}
