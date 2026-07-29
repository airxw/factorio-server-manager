// ============================================================================
// LandingV6 — V6 风格浅色苹果风首页
// 包含：Hero区 + 双视角演示剧场 + 核心能力 + 支持游戏 + CTA三入口
// BUILD: 20260725-V6.3-LANDING
// ============================================================================

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../landing-v6.css';
import { APP_VERSION } from '../api/client';
import { getBuildFooterText } from '../utils/buildFooterText';

// ── SVG icon markup in lucide style (24×24, stroke-based, currentColor) ──
const I = (d: string) => `<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;

const ICONS: Record<string, string> = {
  '🎮': I('M6 11h4a2 2 0 012 2v6a2 2 0 01-2 2H6a2 2 0 01-2-2v-6a2 2 0 012-2zm8-2h4a2 2 0 012 2v10a2 2 0 01-2 2h-4a2 2 0 01-2-2V11a2 2 0 012-2zM8 7V5a1 1 0 011-1h3l3-2h3'),
  '⚙️': I('M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2zM12 15a3 3 0 100-6 3 3 0 000 6z'),
  '💎': I('M6 3h12l4 6-10 12L2 9zM2 9h20'),
  '🎫': I('M2 9a3 3 0 010 6v2a2 2 0 002 2h16a2 2 0 002-2v-2a3 3 0 010-6V7a2 2 0 00-2-2H4a2 2 0 00-2 2zM9 12h.01M15 12h.01'),
  '💬': I('M7.9 20A9 9 0 104 16.1L2 22zM12 8v4M12 16h.01'),
  '🗳': I('M9 22h6M12 2v9m0 0l-3-3m3 3l3-3M4 15h16v4a2 2 0 01-2 2H6a2 2 0 01-2-2z'),
  '📊': I('M3 3v18h18M18 9V5M13 15v-6M8 13V9'),
  '⛏': I('M14.5 2L5.5 12h0a5 5 0 107 7L21 10M5.5 12l4 4'),
  '🌲': I('M14 18v-6M14 6l3 4M17 10l4 4M4 22h16M12 2v10M12 12l3-4m-3 4l-3-4'),
  '🧟': I('M3 22a2 2 0 012-2h14a2 2 0 012 2M12 2a6 6 0 00-6 6v2M12 10a6 6 0 016 6v2M10 14h4'),
  '🦖': I('M14 2h6l-4 6h4l-8 12 4-10H8zM3 22l3-8'),
  '🔫': I('M22 2L2 22M16 4l4 4M2 2l7 7M12 22a10 10 0 100-20 10 10 0 000 20zm0-4a6 6 0 100-12 6 6 0 000 12z'),
  '🌍': I('M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20'),
  '🔥': I('M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1 0-3.5-1.5-3.5-5.5 0-2 1-4 3.5-5.5 3 1.5 4 3.5 4 5.5 0 2-1 4-3.5 5.5'),
  '🌳': I('M17 22v-2L12 2 7 20v2M7 22h10'),
  '🏰': I('M4 22V10l8-6 8 6v12M4 22h16M10 22V14h4v8'),
  '🏭': I('M3 21V7l5-3 5 3 5-3 5 3v14M3 21h20M8 13v4M12 10v7M16 13v4'),
  '📖': I('M4 19.5A2.5 2.5 0 016.5 17H20M4 19.5A2.5 2.5 0 006.5 22H20M20 2H8a4 4 0 00-4 4v12'),
  '🔌': I('M22 2L13.5 10.5M16 5l-5 5M2 12a5 5 0 015-5 5 5 0 015 5v8M12 12v8'),
  '🌐': I('M12 2a10 10 0 100 20 10 10 0 000-20zM2 12h20M12 2a15 15 0 010 20'),
  '👥': I('M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2M22 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75M9 11a4 4 0 100-8 4 4 0 000 8z'),
  '✍️': I('M17 3a2.85 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5zM15 5l4 4'),
  '🔒': I('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  '📋': I('M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 12h6M9 16h6'),
  '🛒': I('M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4zM3 6h18M16 10a4 4 0 01-8 0'),
  '📱': I('M22 6v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2h16a2 2 0 012 2zM12 18h.01M10 4h4'),
  '🎁': I('M20 12v10H4V12M2 7h20v5H2zM12 22V7M12 7H8.5a2.5 2.5 0 010-5C11 2 12 7 12 7zM12 7h3.5a2.5 2.5 0 000-5C13 2 12 7 12 7z'),
  '👑': I('M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zM3 20h18'),
  '⚡': I('M13 2L3 14h9l-1 8 10-12h-9l1-8z'),
  '🗡': I('M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 22l5-5M20 11l3-3'),
  '👤': I('M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z'),
  '💰': I('M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6'),
  '🖥': I('M2 4v12a2 2 0 002 2h16a2 2 0 002-2V4a2 2 0 00-2-2H4a2 2 0 00-2 2zM2 16h20M8 20v2M16 20v2M12 22h0'),
  '📈': I('M22 12l-4-4-6 6-4-4-6 6'),
  '✨': I('M12 3l1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5z'),
  '▶': I('M5 3l14 9-14 9z'),
};

function replaceEmoji(html: string): string {
  let result = html;
  for (const [emoji, svg] of Object.entries(ICONS)) {
    result = result.split(emoji).join(svg);
  }
  return result;
}

const BODY_HTML_RAW = `<div class="prog" id="prog"></div>

<nav class="nav" id="nav">
  <div class="nav-inner">
    <div class="logo" data-nav="home"><div class="logo-ic">🎮</div>GSP</div>
    <div class="nav-links">
      <div class="nav-dropdown">
        <a class="nav-dd-trigger">产品 <span class="nav-dd-arrow">▾</span></a>
        <div class="nav-dd-panel">
          <a data-scroll="feat" class="nav-dd-item"><span class="nav-dd-ic">⚙️</span><div><div class="nav-dd-t">功能介绍</div><div class="nav-dd-d">运维+变现+社区，全链路标准件</div></div></a>
          <a data-scroll="games" class="nav-dd-item"><span class="nav-dd-ic">🎮</span><div><div class="nav-dd-t">支持游戏</div><div class="nav-dd-d">11+ 款游戏，YAML 驱动接入</div></div></a>
          <a data-scroll="changelog" class="nav-dd-item"><span class="nav-dd-ic">📋</span><div><div class="nav-dd-t">更新日志</div><div class="nav-dd-d">版本迭代与功能演进</div></div></a>
        </div>
      </div>
      <div class="nav-dropdown">
        <a class="nav-dd-trigger">资源 <span class="nav-dd-arrow">▾</span></a>
        <div class="nav-dd-panel">
          <a data-link="/docs" class="nav-dd-item"><span class="nav-dd-ic">📖</span><div><div class="nav-dd-t">文档</div><div class="nav-dd-d">快速开始与使用指南</div></div></a>
          <a data-link="/api-reference" class="nav-dd-item"><span class="nav-dd-ic">🔌</span><div><div class="nav-dd-t">API 参考</div><div class="nav-dd-d">REST 接口与 WebSocket 事件</div></div></a>
          <a data-link="/pack-dev" class="nav-dd-item"><span class="nav-dd-ic"></span><div><div class="nav-dd-t">Pack 开发</div><div class="nav-dd-d">自定义游戏 Pack 开发指南</div></div></a>
          <a data-link="/community" class="nav-dd-item"><span class="nav-dd-ic">🌐</span><div><div class="nav-dd-t">社区</div><div class="nav-dd-d">GitHub · Discussions · Issues</div></div></a>
        </div>
      </div>
      <div class="nav-dropdown">
        <a class="nav-dd-trigger">关于 <span class="nav-dd-arrow">▾</span></a>
        <div class="nav-dd-panel">
          <a data-link="/team" class="nav-dd-item"><span class="nav-dd-ic">👥</span><div><div class="nav-dd-t">团队</div><div class="nav-dd-d">幕后开发者与贡献者</div></div></a>
          <a data-link="/blog" class="nav-dd-item"><span class="nav-dd-ic">✍️</span><div><div class="nav-dd-t">博客</div><div class="nav-dd-d">技术文章与产品动态</div></div></a>
          <a data-link="/contact" class="nav-dd-item"><span class="nav-dd-ic"></span><div><div class="nav-dd-t">联系我们</div><div class="nav-dd-d">商务合作与技术支持</div></div></a>
          <a data-link="/privacy" class="nav-dd-item"><span class="nav-dd-ic">🔒</span><div><div class="nav-dd-t">隐私政策</div><div class="nav-dd-d">数据保护与隐私声明</div></div></a>
        </div>
      </div>
    </div>
    <a data-scroll="cta" class="nav-cta">免费开始 →</a>
  </div>
</nav>

<section class="hero">
  <div class="hero-tag reveal"><span class="dot"></span>游戏服务器运营中台 · AGPL-3.0 开源</div>
  <h1 class="reveal">把开服<span class="line2">从<em style="font-style:normal">技术活</em></span><span class="line2">变成<span class="grad">运营活</span></span></h1>
  <p class="hero-sub reveal">获客 → 内容 → 秩序 → 赞助，全链路可插拔标准件。不挑游戏类型，一个面板撑起整个玩家运营体系。</p>
  <div class="hero-ctas reveal">
    <button class="btn-primary" data-goto="demo">▶ 观看自动演示</button>
    <button class="btn-secondary" data-goto="cta">5 分钟开服 →</button>
  </div>
  <div class="hero-preview reveal">
    <div class="preview-frame">
      <div class="preview-chrome">
        <div class="preview-dot r"></div><div class="preview-dot y"></div><div class="preview-dot g"></div>
        <div class="preview-url" id="prevUrl">https://gsp.ecsrz.com:3001/store</div>
      </div>
      <div class="preview-body">
        <div class="preview-side">
          <div class="preview-nav on"><span class="ic">📊</span>仪表盘</div>
          <div class="preview-nav"><span class="ic">🖥</span>服务器</div>
          <div class="preview-nav"><span class="ic">💎</span>商城</div>
          <div class="preview-nav"><span class="ic">👥</span>玩家</div>
          <div class="preview-nav"><span class="ic">🎫</span>CDK</div>
          <div class="preview-nav"><span class="ic">🗳</span>投票</div>
        </div>
        <div class="preview-main">
          <div class="preview-stats">
            <div class="stat"><div class="stat-l">在线玩家</div><div class="stat-v gr"><span class="live-num" data-target="47">0</span><span style="font-size:14px;color:var(--t3);font-weight:400">/50</span></div></div>
            <div class="stat"><div class="stat-l">CPU</div><div class="stat-v bl"><span class="live-num" data-target="23" data-suffix="%">0</span></div></div>
            <div class="stat"><div class="stat-l">今日流水</div><div class="stat-v or">¥<span class="live-num" data-target="328">0</span></div></div>
            <div class="stat"><div class="stat-l">状态</div><div class="stat-v gr">运行中</div></div>
          </div>
          <div class="preview-chart">
            <div class="chart-t">玩家在线趋势</div>
            <svg viewBox="0 0 400 80" preserveAspectRatio="none" style="flex:1;width:100%;min-height:60px">
              <defs><linearGradient id="cg" x1="0"y1="0"x2="0"y2="1"><stop offset="0%" stop-color="rgba(0,122,255,0.12)"/><stop offset="100%" stop-color="rgba(0,122,255,0)"/></linearGradient></defs>
              <path d="M0,65 L30,55 L60,58 L90,45 L120,35 L150,40 L180,28 L210,25 L240,32 L270,20 L300,18 L330,25 L360,14 L400,18 L400,80 L0,80 Z" fill="url(#cg)"/>
              <path d="M0,65 L30,55 L60,58 L90,45 L120,35 L150,40 L180,28 L210,25 L240,32 L270,20 L300,18 L330,25 L360,14 L400,18" fill="none" stroke="#007AFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chart-line"/>
            </svg>
          </div>
          <div class="preview-ticker">
            <div class="ticker-track">
              <span class="ticker-item j">👤 Steve 加入了服务器</span>
              <span class="ticker-item b">💎 Alex 购买 VIP · ¥30</span>
              <span class="ticker-item g">🎁 新手礼包已发放</span>
              <span class="ticker-item v">🗳 投票通过 · 踢出作弊者</span>
              <span class="ticker-item j">👤 Alex 加入了服务器</span>
              <span class="ticker-item b">💰 日流水 ¥328</span>
              <span class="ticker-item j">👤 Steve 加入了服务器</span>
              <span class="ticker-item b">💎 Alex 购买 VIP · ¥30</span>
              <span class="ticker-item g">🎁 新手礼包已发放</span>
              <span class="ticker-item v">🗳 投票通过 · 踢出作弊者</span>
              <span class="ticker-item j">👤 Alex 加入了服务器</span>
              <span class="ticker-item b">💰 日流水 ¥328</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<div class="hero-fade"></div>

<!-- DEMO THEATRE v6 -->
<section class="demo-band" id="demo">
  <div class="demo-head">
    <div class="sec-label reveal">01 · 互动演示</div>
    <h2 class="sec-title reveal">看看它是怎么工作的</h2>
    <p class="sec-desc reveal">无需注册、无需安装。页面自动讲述完整故事——从玩家进服到服主变现，35秒看懂全链路。</p>
    <div class="demo-view-switch reveal">
      <button class="view-btn active" data-view="full">🔄 完整故事</button>
      <button class="view-btn" data-view="player">👤 玩家视角</button>
      <button class="view-btn" data-view="owner">👑 服主视角</button>
    </div>
  </div>
  <div class="theatre-wrap">
    <div class="theatre reveal">
      <div class="theatre-chrome">
        <div class="theatre-dot r"></div><div class="theatre-dot y"></div><div class="theatre-dot g"></div>
        <div class="theatre-url player-view" id="theatreUrl">https://gsp.ecsrz.com:3001/guild</div>
        <div class="theatre-role-badge player" id="roleBadge">👤 玩家视角</div>
      </div>
      <div class="theatre-stage" id="stage">
        <div class="vcursor" id="vcursor"></div>

        <!-- Scene 1: Player Join -->
        <div class="scene-container active" id="scene0">
          <div class="scene-join">
            <div class="chat-area" id="chat1">
              <div class="chat-msg system" data-delay="400"><span class="tag">[系统]</span> 连接服务器中...</div>
              <div class="chat-msg system" data-delay="1500"><span class="tag">[系统]</span> 已连接到 mc.yourserver.com</div>
              <div class="chat-msg system" data-delay="2800"><span class="tag">[欢迎]</span> 欢迎 Steve 加入服务器！</div>
              <div class="chat-msg success" data-delay="4300"><span class="tag">🎁 礼包</span> 新手礼包已自动发放！</div>
              <div class="chat-msg player" data-delay="5800">Steve: 哇！刚进来就有装备？太爽了！</div>
            </div>
            <div class="gift-area">
              <div class="gift-popup" id="giftPop">
                <div class="icon">🎁</div>
                <h4>新手礼包</h4>
                <div class="items">
                  ⚔️ 钻石剑 ×1<br>
                  🍎 金苹果 ×5<br>
                  🧪 经验瓶 ×10
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Scene 2: Shop -->
        <div class="scene-container" id="scene1">
          <div class="scene-shop">
            <div class="shop-items" id="shopList">
              <div class="shop-header">🛒 玩家商城</div>
              <div class="shop-item" data-delay="200" id="shop1">
                <div class="sic" style="background:linear-gradient(135deg,#FFD60A,#FF9500)">💎</div>
                <div class="sin"><div class="n">VIP 月卡</div><div class="p">¥30/月</div></div>
                <div class="sib" id="buy1Btn">购买</div>
              </div>
              <div class="shop-item" data-delay="500">
                <div class="sic" style="background:linear-gradient(135deg,#AF52DE,#D45BDE)">👑</div>
                <div class="sin"><div class="n">SVIP 永久</div><div class="p">¥198</div></div>
                <div class="sib">购买</div>
              </div>
              <div class="shop-item" data-delay="800">
                <div class="sic" style="background:linear-gradient(135deg,#34C759,#30D158)">⚡</div>
                <div class="sin"><div class="n">飞行权限</div><div class="p">¥10</div></div>
                <div class="sib">购买</div>
              </div>
              <div class="shop-item" data-delay="1100">
                <div class="sic" style="background:linear-gradient(135deg,#FF3B30,#FF6969)">🗡</div>
                <div class="sin"><div class="n">神装礼包</div><div class="p">¥68</div></div>
                <div class="sib">购买</div>
              </div>
            </div>
            <div class="shop-result" id="shopResult">
              <div class="pay-qr" id="qr">📱</div>
              <div class="success-check" id="check">✓</div>
              <div class="result-text" id="resText">购买成功！</div>
              <div class="result-sub" id="resSub">VIP 权限已自动激活</div>
              <div class="vip-badge" id="vipBadge">👑 VIP 黄金会员</div>
            </div>
          </div>
        </div>

        <!-- Scene 3: Vote -->
        <div class="scene-container" id="scene2">
          <div class="scene-vote">
            <div class="vote-title" id="voteT">🗳 投票：踢出 Hacker123？</div>
            <div class="vote-sub" id="voteS">举报人: Steve · 原因: 疑似使用飞行外挂</div>
            <div class="vote-progress-container">
              <div class="vote-bar"><div class="vote-fill" id="voteFill">0/5</div></div>
            </div>
            <div class="vote-counts">
              <div class="vote-count yes" id="voteY"><div class="num" data-target="5">0</div><div class="lbl">赞成</div></div>
              <div class="vote-count no" id="voteN"><div class="num" data-target="0">0</div><div class="lbl">反对</div></div>
            </div>
            <div class="vote-result pass" id="voteR">✓ 投票通过 · Hacker123 已被踢出</div>
            <div class="chat-mini" id="voteChat"></div>
          </div>
        </div>

        <!-- Scene 4: Narrator -->
        <div class="scene-container" id="scene3">
          <div class="scene-narrator">
            <div class="narrator-text">
              <h3 id="narH">这一切，服主<span class="grad">都不用在线</span></h3>
              <p id="narP">礼包自动发、购买自动到账、投票自动执行<br>GSP 在后台默默运转，你只需要看数据</p>
            </div>
          </div>
        </div>

        <!-- Scene 5: Owner Dashboard -->
        <div class="scene-container" id="scene4">
          <div class="scene-dashboard">
            <div class="dash-sidebar" id="dashSide">
              <div class="dash-nav active"><span>📊</span> 仪表盘</div>
              <div class="dash-nav"><span>🖥</span> 服务器</div>
              <div class="dash-nav"><span>💎</span> 商城</div>
              <div class="dash-nav"><span>👥</span> 玩家</div>
              <div class="dash-nav"><span>💰</span> 流水</div>
            </div>
            <div class="dash-main">
              <div class="dash-stats">
                <div class="dash-stat" data-delay="200"><div class="dl">在线玩家</div><div class="dv" style="color:var(--green)"><span class="dnum" data-target="48">0</span>/50</div></div>
                <div class="dash-stat" data-delay="400"><div class="dl">今日流水</div><div class="dv" style="color:var(--orange)">¥<span class="dnum" data-target="358">0</span></div></div>
                <div class="dash-stat" data-delay="600"><div class="dl">今日订单</div><div class="dv" style="color:var(--blue)"><span class="dnum" data-target="14">0</span></div></div>
              </div>
              <div class="dash-chart" data-delay="800">
                <div class="ct">📈 今日流水趋势</div>
                <svg viewBox="0 0 400 60" preserveAspectRatio="none" style="width:100%;height:40px">
                  <defs><linearGradient id="cg2" x1="0"y1="0"x2="0"y2="1"><stop offset="0%" stop-color="rgba(255,149,0,0.15)"/><stop offset="100%" stop-color="rgba(255,149,0,0)"/></linearGradient></defs>
                  <path d="M0,50 L50,45 L100,48 L150,35 L200,30 L250,35 L300,20 L350,12 L400,8 L400,60 L0,60 Z" fill="url(#cg2)"/>
                  <path d="M0,50 L50,45 L100,48 L150,35 L200,30 L250,35 L300,20 L350,12 L400,8" fill="none" stroke="#FF9500" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chart-line"/>
                </svg>
              </div>
            </div>
            <div class="dash-event-list" id="dashEvents"></div>
          </div>
        </div>

        <!-- Scene 6: Dual View -->
        <div class="scene-container" id="scene5">
          <div class="sync-line" id="syncLine"></div>
          <div class="sync-pulse" id="syncPulse"></div>
          <div class="scene-dual">
            <div class="dual-pane player">
              <div class="dual-label" id="dl1">👤 玩家侧</div>
              <div id="playerActions"></div>
            </div>
            <div class="dual-pane owner">
              <div class="dual-label" id="dl2">👑 服主侧</div>
              <div id="ownerActions"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="theatre-ctrl">
        <div class="ctrl-left">
          <button class="ctrl-btn" id="prevBtn">◀</button>
          <button class="ctrl-btn" id="playBtn">⏸</button>
          <button class="ctrl-btn" id="nextBtn">▶</button>
        </div>
        <div class="scene-progress" id="sceneProg"></div>
        <div class="scene-name" id="sceneName">玩家进服</div>
      </div>
    </div>
  </div>
</section>

<section class="sec-pad" id="feat">
  <div class="sec-inner">
    <div class="feat-layout">
      <div class="feat-side reveal">
        <div class="sec-label">02 · 核心能力</div>
        <h2 class="sec-title">运维 + 变现<br>+ 社区<br>一个面板</h2>
        <p class="sec-desc">从部署到运营，从秩序到变现，GSP 把游戏服运营链路做成可插拔的标准件。</p>
      </div>
      <div class="feat-grid stagger">
        <div class="feat"><div class="feat-ic bl">⚙️</div><h3>一键部署运维</h3><p>SteamCMD 自动下载、RCON 自动连接、Daemon 节点健康监控。11+ 款游戏，每款只写一份 YAML。</p><div class="feat-tags"><span class="tag bl">SteamCMD</span><span class="tag bl">RCON</span><span class="tag bl">自动备份</span></div></div>
        <div class="feat"><div class="feat-ic or">💎</div><h3>VIP / 商城</h3><p>微信/支付宝扫码支付，自动到账。权限组、物品、CDK 全链路打通。</p><div class="feat-tags"><span class="tag or">微信支付</span><span class="tag or">自动发货</span></div></div>
        <div class="feat"><div class="feat-ic pp">🎫</div><h3>CDK 兑换</h3><p>批量生成兑换码，自定义物品/权限组/时长，活动推广利器。</p><div class="feat-tags"><span class="tag" style="background:rgba(175,82,220,0.08);color:var(--purple)">批量生成</span></div></div>
        <div class="feat"><div class="feat-ic gr">💬</div><h3>聊天触发</h3><p>自动欢迎语、进服礼包、关键词响应。玩家聊天触发自动化流程，无需在线值守。</p><div class="feat-tags"><span class="tag gr">自动回复</span><span class="tag gr">礼包发放</span></div></div>
        <div class="feat"><div class="feat-ic rd">🗳</div><h3>投票踢人</h3><p>社区自治，玩家投票处理作弊/挂机，自动执行封禁，维护服务器秩序。</p><div class="feat-tags"><span class="tag" style="background:rgba(255,59,48,0.08);color:var(--red)">自动执行</span></div></div>
        <div class="feat"><div class="feat-ic bl">📊</div><h3>数据看板</h3><p>在线趋势、流水报表、玩家留存、活跃度分析。做决策靠数据，不靠感觉。</p><div class="feat-tags"><span class="tag bl">在线趋势</span><span class="tag bl">流水报表</span></div></div>
      </div>
    </div>
  </div>
</section>

<section class="sec-pad band-dark" id="games">
  <div class="sec-inner">
    <div class="games-head">
      <div class="sec-label reveal">03 · 支持游戏</div>
      <h2 class="sec-title reveal">11+ 款游戏<br>YAML 驱动，零代码接入</h2>
      <p class="sec-desc reveal">每款游戏只写一份 Pack YAML，社区可贡献。越多游戏越值钱。</p>
      <div class="games-chips reveal">
        <button class="chip on">全部</button><button class="chip">沙盒</button><button class="chip">生存</button><button class="chip">射击</button><button class="chip">RPG</button>
      </div>
    </div>
    <div class="games-grid stagger">
      <div class="game"><div class="game-ic" style="background:rgba(139,92,246,0.08)">⛏</div><div class="game-nm">Minecraft</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(34,197,94,0.08)">🌲</div><div class="game-nm">Valheim</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(239,68,68,0.08)">🧟</div><div class="game-nm">P Zomboid</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(249,115,22,0.08)">🦖</div><div class="game-nm">ARK</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(234,179,8,0.08)">🔫</div><div class="game-nm">Rust</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(59,130,246,0.08)">🌍</div><div class="game-nm">Palworld</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(236,72,153,0.08)">🔥</div><div class="game-nm">DST</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(168,85,247,0.08)">⚙️</div><div class="game-nm">Factorio</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(20,184,166,0.08)">🌳</div><div class="game-nm">Terraria</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(99,102,241,0.08)">🏰</div><div class="game-nm">Enshrouded</div><div class="game-st">● 已支持</div></div>
      <div class="game"><div class="game-ic" style="background:rgba(234,88,12,0.08)">🏭</div><div class="game-nm">Satisfactory</div><div class="game-st">● 已支持</div></div>
      <div class="game add"><div class="game-ic">+</div><div class="game-nm">更多游戏</div><div class="game-st">贡献 Pack</div></div>
    </div>
  </div>
</section>

<section class="nums-band">
  <div class="sec-label reveal">04 · 数据说话</div>
  <h2 class="sec-title reveal" style="text-align:center;max-width:800px;margin:0 auto">为什么服主选择 GSP</h2>
  <div class="nums-grid stagger">
    <div class="num"><div class="num-v" data-c="11">0</div><div class="num-l">支持游戏</div></div>
    <div class="num"><div class="num-v" data-c="3">0</div><div class="num-l">权限层级</div></div>
    <div class="num"><div class="num-v" data-c="5">0</div><div class="num-l">分钟开服</div></div>
    <div class="num"><div class="num-v" data-c="100">0</div><div class="num-l">% 开源</div></div>
  </div>
</section>

<!-- CHANGELOG -->
<section class="sec-pad band-dark" id="changelog">
  <div class="sec-inner">
    <div style="text-align:center;margin-bottom:clamp(40px,6vw,64px)">
      <div class="sec-label reveal">05 · 更新日志</div>
      <h2 class="sec-title reveal">持续迭代，每周更新</h2>
      <p class="sec-desc reveal" style="margin:0 auto">从 v1.0 到 v4.22，GSP 经历了 4 次架构升级。每次更新都围绕服主的真实运营需求。</p>
    </div>
    <div class="changelog-timeline">
      <div class="cl-item reveal">
        <div class="cl-version">v4.22.0</div>
        <div class="cl-date">2026-07-26</div>
        <div class="cl-body">
          <h4>Setup Wizard v3</h4>
          <p>Daemon 部署脚本 + 链接导入 / 移除默认管理员 / Pack 多来源同步（GitHub / 自定义 URL / 上传 zip）</p>
        </div>
      </div>
      <div class="cl-item reveal">
        <div class="cl-version">v4.20.0</div>
        <div class="cl-date">2026-07-20</div>
        <div class="cl-body">
          <h4>初始化向导重构</h4>
          <p>8 步向导流程 / 环境预检 / 数据库配置 / Daemon 节点 / 站点信息 / 管理员创建 / Pack 启用 / 完成</p>
        </div>
      </div>
      <div class="cl-item reveal">
        <div class="cl-version">v4.17.0</div>
        <div class="cl-date">2026-07-10</div>
        <div class="cl-body">
          <h4>V6 风格首页</h4>
          <p>全新营销落地页 / 双视角演示剧场 / 虚拟鼠标 + 打字机效果 / 6 场景自动循环演示</p>
        </div>
      </div>
      <div class="cl-item reveal">
        <div class="cl-version">v4.12.0</div>
        <div class="cl-date">2026-06-20</div>
        <div class="cl-body">
          <h4>三层操作架构</h4>
          <p>Platform Dashboard（系统管理）/ GM Workbench（服主工作台）/ Player Portal（玩家门户）三基座分离</p>
        </div>
      </div>
      <div class="cl-item reveal">
        <div class="cl-version">v4.0.0</div>
        <div class="cl-date">2026-05-01</div>
        <div class="cl-body">
          <h4>HTTPS + nginx 架构升级</h4>
          <p>nginx 反向代理 / TLS 1.2/1.3 / HTTP→HTTPS 自动跳转 / systemd 生产守护</p>
        </div>
      </div>
      <div class="cl-item reveal">
        <div class="cl-version">v1.0.0</div>
        <div class="cl-date">2025-01-01</div>
        <div class="cl-body">
          <h4>项目启动</h4>
          <p>首个可用版本 / Minecraft 单游戏支持 / 基础 RCON 连接 / 简单 Web 面板</p>
        </div>
      </div>
    </div>
    <div style="text-align:center;margin-top:clamp(32px,5vw,48px)">
      <a data-link="/help#changelog" class="changelog-more reveal">查看完整更新日志 →</a>
    </div>
  </div>
</section>

<section class="cta-band" id="cta">
  <h2 class="reveal">现在就开始。</h2>
  <p class="reveal">5 分钟开服，今天就有第一笔收入。开源免费，自托管无限制。</p>
  <div class="cta-ctas reveal">
    <button class="btn-primary" data-nav="owner" style="font-size:clamp(15px,1.8vw,18px);padding:clamp(14px,2vw,20px) clamp(28px,4vw,48px)">👑 我是服主 · 进入控制台</button>
    <button class="btn-secondary" data-nav="player" style="font-size:clamp(15px,1.8vw,18px);padding:clamp(13px,2vw,19px) clamp(26px,4vw,46px)">🎮 我是玩家 · 玩家中心</button>
    <button class="btn-demo" data-nav="demo" style="display:inline-flex;align-items:center;gap:8px;font-size:clamp(15px,1.8vw,18px);padding:clamp(13px,2vw,19px) clamp(26px,4vw,46px);background:var(--green);color:white;border-radius:980px;font-weight:600">✨ 先看看 · 自动演示</button>
  </div>
  <div class="cta-steps reveal">
    <div class="step"><span class="step-n">1</span>选择游戏</div><span class="arr">→</span>
    <div class="step"><span class="step-n">2</span>一键部署</div><span class="arr">→</span>
    <div class="step"><span class="step-n">3</span>配置运营</div><span class="arr">→</span>
    <div class="step"><span class="step-n">4</span>开始赚钱</div>
  </div>
</section>

<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="logo" data-nav="home"><div class="logo-ic">🎮</div>GSP</div>
      <p class="footer-d">游戏服务器运营中台。把开服从技术活变成运营活。AGPL-3.0 开源。</p>
    </div>
    <div class="footer-col"><h4>产品</h4><a data-scroll="feat">功能介绍</a><a data-scroll="games">支持游戏</a><a data-scroll="changelog">更新日志</a></div>
    <div class="footer-col"><h4>资源</h4><a data-link="/docs">文档</a><a data-link="/api-reference">API 参考</a><a data-link="/pack-dev">Pack 开发</a><a data-link="/community">社区</a></div>
    <div class="footer-col"><h4>GitHub</h4><a href="https://github.com/ecsrz/gameserver-panel" target="_blank" rel="noopener">源码</a><a href="https://github.com/ecsrz/gameserver-panel/issues" target="_blank" rel="noopener">Issues</a><a href="https://github.com/ecsrz/gameserver-panel/discussions" target="_blank" rel="noopener">Discussions</a><a data-link="/community">贡献指南</a></div>
    <div class="footer-col"><h4>关于</h4><a data-link="/team">团队</a><a data-link="/blog">博客</a><a data-link="/contact">联系我们</a><a data-link="/privacy">隐私政策</a></div>
  </div>
    <div class="footer-bot"><span>${getBuildFooterText({ variant: 'marketing', version: APP_VERSION })}</span><span>AGPL-3.0 · Made with ❤️ for server owners</span></div>
</footer>`;

export default function LandingV6() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Set inner HTML with SVG icons
    container.innerHTML = replaceEmoji(BODY_HTML_RAW);

    // Scoped query helpers
    const $ = (sel: string, root?: HTMLElement | null) => (root || container).querySelector(sel) as HTMLElement | null;
    const $$ = (sel: string, root?: HTMLElement | null) => Array.from((root || container).querySelectorAll(sel)) as HTMLElement[];

    // ===== Nav & Scroll =====
    function updateNav() {
      const nav = $('#nav');
      if (nav) nav.classList.toggle('scrolled', window.scrollY > 40);
    }
    updateNav();

    const onScroll = () => {
      const h = document.documentElement.scrollHeight - window.innerHeight;
      const prog = $('#prog');
      if (prog) prog.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
      updateNav();
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // ===== Reveal on scroll =====
    const revealIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('on');
          revealIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal, .stagger').forEach(el => revealIO.observe(el));

    // ===== Number counters =====
    function animateNumber(el: HTMLElement, target: number, duration = 1200) {
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        el.textContent = String(Math.round(ease * target));
        if (t < 1) requestAnimationFrame(tick);
        else el.textContent = String(target);
      };
      requestAnimationFrame(tick);
    }

    const numIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const target = parseInt((e.target as HTMLElement).dataset.c || '0');
          if (!isNaN(target)) animateNumber(e.target as HTMLElement, target);
          numIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    $$('.num-v[data-c]').forEach(el => numIO.observe(el));

    // ===== Utility =====
    function scrollToId(id: string) {
      const el = document.getElementById(id) || $(`#${id}`);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }
    function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

    // ===== Virtual Cursor System =====
    const vcursor = $('#vcursor') as HTMLElement | null;
    let cursorX = 200, cursorY = 200;
    let cursorRAF: number | null = null;

    function moveCursorTo(x: number, y: number, duration = 600) {
      return new Promise<void>(resolve => {
        if (!vcursor) { resolve(); return; }
        const vc = vcursor;
        const startX = cursorX, startY = cursorY;
        const startTime = performance.now();
        function step(now: number) {
          const t = Math.min((now - startTime) / duration, 1);
          const ease = t < 0.5 ? 2*t*t : 1-Math.pow(-2*t+2,2)/2;
          cursorX = startX + (x - startX) * ease;
          cursorY = startY + (y - startY) * ease;
          vc.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
          if (t < 1) cursorRAF = requestAnimationFrame(step);
          else resolve();
        }
        cursorRAF = requestAnimationFrame(step);
      });
    }

    async function cursorClick(x: number, y: number) {
      const stage = $('#stage');
      if (!stage) { return; }
      const ripple = document.createElement('div');
      ripple.className = 'ripple';
      ripple.style.left = x + 'px';
      ripple.style.top = y + 'px';
      stage.appendChild(ripple);
      if (vcursor) vcursor.classList.add('clicking');
      await sleep(150);
      if (vcursor) vcursor.classList.remove('clicking');
      setTimeout(() => ripple.remove(), 600);
    }

    if (vcursor) {
      vcursor.style.transform = `translate(${cursorX}px, ${cursorY}px)`;
    }

    let demoVisible = false;
    const demoSection = $('#demo');
    const demoIO = demoSection ? new IntersectionObserver((entries) => {
      demoVisible = entries[0].isIntersecting;
    }, { threshold: 0.3 }) : null;
    if (demoSection && demoIO) demoIO.observe(demoSection);

    // ===== Scene Animation =====
    const sceneTitles = ['玩家进服 · 领取礼包', '商城购物 · VIP 购买', '社区投票 · 自动执法', '视角转换', '服主工作台 · 实时数据', '双视角联动'];
    const viewModes: Record<string, number[]> = {
      full: [0, 1, 2, 3, 4, 5],
      player: [0, 1, 2],
      owner: [4, 5]
    };
    let currentView = 'full';
    let currentSceneIdx = 0;
    let isPlaying = true;
    let sceneTimer: ReturnType<typeof setTimeout> | null = null;
    let sceneAbort = false;
    const totalScenes = 6;
    let sceneProgressRaf: number | null = null;

    // Build progress segments
    const progContainer = $('#sceneProg');
    if (progContainer) {
      for (let i = 0; i < totalScenes; i++) {
        const seg = document.createElement('div');
        seg.className = 'prog-seg';
        seg.innerHTML = '<div class="prog-seg-fill"></div>';
        seg.addEventListener('click', () => goToScene(i));
        progContainer.appendChild(seg);
      }
    }

    function switchScene(idx: number) {
      $$('.scene-container').forEach(s => s.classList.remove('active'));
      const scene = $(`#scene${idx}`);
      if (scene) scene.classList.add('active');
      currentSceneIdx = idx;
      const segs = $$('.prog-seg');
      segs.forEach((seg, i) => {
        const fill = seg.querySelector('.prog-seg-fill') as HTMLElement | null;
        seg.classList.remove('done');
        if (fill) fill.style.width = '0%';
        if (i < idx) { seg.classList.add('done'); if (fill) fill.style.width = '100%'; }
      });
      const nameEl = $('#sceneName');
      if (nameEl) nameEl.textContent = sceneTitles[idx] || '';
      const badge = $('#roleBadge');
      const url = $('#theatreUrl');
      if (badge) {
        badge.className = 'theatre-role-badge';
        if (idx <= 2) { badge.classList.add('player'); badge.textContent = '👤 玩家视角'; }
        else if (idx === 3) { badge.classList.add('dual'); badge.textContent = '🔄 视角转换...'; }
        else if (idx === 4) { badge.classList.add('owner'); badge.textContent = '👑 服主视角'; }
        else { badge.classList.add('dual'); badge.textContent = '🔄 双视角联动'; }
      }
      if (url) {
        url.className = 'theatre-url';
        if (idx <= 2) { url.classList.add('player-view'); url.textContent = 'https://gsp.ecsrz.com:3001/guild'; }
        else if (idx === 3) { url.textContent = 'https://gsp.ecsrz.com:3001'; }
        else if (idx === 4) { url.classList.add('owner-view'); url.textContent = 'https://gsp.ecsrz.com:3001/store'; }
        else { url.textContent = 'https://gsp.ecsrz.com:3001'; }
      }
      runSceneAnimation(idx);
    }

    function resetSceneState(idx: number): Promise<void> {
      sceneAbort = true;
      return new Promise(resolve => {
        setTimeout(() => {
          sceneAbort = false;
          const scene = $(`#scene${idx}`);
          if (!scene) { resolve(); return; }
          $$('.chat-msg', scene).forEach(m => m.classList.remove('show'));
          $$('.gift-popup', scene).forEach(p => p.classList.remove('show'));
          $$('.shop-item', scene).forEach(i => { i.classList.remove('show', 'highlight', 'purchased'); });
          $$('.pay-qr, .success-check, .result-text, .result-sub, .vip-badge', scene).forEach(e => e.classList.remove('show'));
          $$('.vote-title, .vote-sub, .vote-result, .vote-count', scene).forEach(e => e.classList.remove('show'));
          $$('.vote-fill', scene).forEach(f => (f as HTMLElement).style.width = '0%');
          $$('.dash-sidebar, .dash-stat, .dash-chart', scene).forEach(e => e.classList.remove('show'));
          $$('.dual-label, .dual-action', scene).forEach(e => e.classList.remove('show'));
          $$('.sync-line, .sync-pulse', scene).forEach(e => e.classList.remove('show'));
          $$('.narrator-text h3, .narrator-text p', scene).forEach(e => e.classList.remove('show'));
          $$('.dash-event, .ripple', scene).forEach(e => e.remove());
          const playerActions = $('#playerActions');
          const ownerActions = $('#ownerActions');
          if (playerActions) playerActions.innerHTML = '';
          if (ownerActions) ownerActions.innerHTML = '';
          const voteChat = $('#voteChat');
          if (voteChat) voteChat.innerHTML = '';
          // Reset buy button
          const buyBtn = $('#buy1Btn');
          if (buyBtn) {
            buyBtn.textContent = '购买';
            (buyBtn as HTMLElement).style.background = '';
          }
          resolve();
        }, 100);
      });
    }

    function startProgressBar(duration: number) {
      const segs = $$('.prog-seg');
      const seg = segs[currentSceneIdx];
      if (!seg) return;
      const fillEl = seg.querySelector('.prog-seg-fill') as HTMLElement | null;
      if (!fillEl) return;
      const fill = fillEl;
      const start = performance.now();
      function tick(now: number) {
        if (sceneAbort) { fill.style.width = '0%'; return; }
        const t = Math.min((now - start) / duration, 1);
        fill.style.width = (t * 100) + '%';
        if (t < 1) sceneProgressRaf = requestAnimationFrame(tick);
      }
      sceneProgressRaf = requestAnimationFrame(tick);
    }

    async function runSceneAnimation(idx: number) {
      await resetSceneState(idx);
      if (sceneAbort) return;
      const stage = $('#stage');
      const isMobile = window.innerWidth <= 768;

      switch(idx) {
        case 0: {
          startProgressBar(9000);
          const msgs = $$('#chat1 .chat-msg');
          for (const msg of msgs) {
            if (sceneAbort) return;
            const delay = parseInt((msg as HTMLElement).dataset.delay || '400');
            const idx2 = msgs.indexOf(msg);
            const prevDelay = idx2 > 0 ? parseInt((msgs[idx2-1] as HTMLElement).dataset.delay || '0') : 0;
            await sleep(delay - prevDelay);
            if (sceneAbort) return;
            msg.classList.add('show');
          }
          await sleep(900);
          if (sceneAbort) return;
          if (!isMobile && demoVisible && stage && vcursor) {
            const gift = $('#giftPop');
            if (gift) {
              const giftRect = gift.getBoundingClientRect();
              const stageBox = stage.getBoundingClientRect();
              await moveCursorTo(giftRect.left - stageBox.left + 50, giftRect.top - stageBox.top + 40, 600);
            }
          }
          await sleep(300);
          const giftPop = $('#giftPop');
          if (giftPop) giftPop.classList.add('show');
          await sleep(1600);
          break;
        }
        case 1: {
          startProgressBar(12000);
          const items = $$('#shopList .shop-item');
          for (const item of items) {
            if (sceneAbort) return;
            await sleep(380);
            item.classList.add('show');
          }
          await sleep(600);
          if (sceneAbort) return;
          if (!isMobile && demoVisible && stage && vcursor) {
            const vipItem = $('#shop1');
            if (vipItem) {
              const rect = vipItem.getBoundingClientRect();
              const stageBox = stage.getBoundingClientRect();
              const cx = rect.left - stageBox.left + 60;
              const cy = rect.top - stageBox.top + rect.height/2;
              await moveCursorTo(cx, cy, 600);
              await sleep(300);
              vipItem.classList.add('highlight');
              await sleep(600);
              const btn = $('#buy1Btn');
              if (btn) {
                const btnRect = btn.getBoundingClientRect();
                const bx = btnRect.left - stageBox.left + btnRect.width/2;
                const by = btnRect.top - stageBox.top + btnRect.height/2;
                await moveCursorTo(bx, by, 400);
                await sleep(200);
                await cursorClick(bx, by);
              }
            }
          } else {
            const shop1 = $('#shop1');
            if (shop1) shop1.classList.add('highlight');
            await sleep(1100);
          }
          await sleep(600);
          if (sceneAbort) return;
          const qr = $('#qr');
          if (qr) qr.classList.add('show');
          await sleep(1800);
          if (sceneAbort) return;
          if (qr) qr.classList.remove('show');
          ['check','resText','resSub'].forEach(id => { const el = $(`#${id}`); if (el) el.classList.add('show'); });
          await sleep(400);
          const vipBadge = $('#vipBadge');
          if (vipBadge) vipBadge.classList.add('show');
          const sib = $('#buy1Btn');
          if (sib) {
            sib.textContent = '已购';
            (sib as HTMLElement).style.background = 'var(--green)';
          }
          const shop1 = $('#shop1');
          if (shop1) shop1.classList.add('purchased');
          await sleep(1400);
          break;
        }
        case 2: {
          startProgressBar(10000);
          const voteT = $('#voteT'); if (voteT) voteT.classList.add('show');
          await sleep(400);
          const voteS = $('#voteS'); if (voteS) voteS.classList.add('show');
          await sleep(600);
          if (sceneAbort) return;
          const chatMsgs = [
            { text: 'Alex: 有人开挂！', type: 'player', delay: 0 },
            { text: 'Steve: /vote kick Hacker123', type: 'player', delay: 600 },
          ];
          const chatContainer = $('#voteChat');
          if (chatContainer) {
            for (const cm of chatMsgs) {
              const div = document.createElement('div');
              div.className = 'chat-msg ' + cm.type;
              div.style.fontSize = '11px';
              div.style.padding = '6px 10px';
              div.style.opacity = '0';
              div.style.transform = 'translateY(6px)';
              div.textContent = cm.text;
              chatContainer.appendChild(div);
              await sleep(cm.delay);
              requestAnimationFrame(() => div.classList.add('show'));
            }
          }
          await sleep(600);
          if (sceneAbort) return;
          const yesEl = $('#voteY'), noEl = $('#voteN');
          if (yesEl) yesEl.classList.add('show');
          if (noEl) noEl.classList.add('show');
          const fill = $('#voteFill') as HTMLElement | null;
          for (let i = 1; i <= 5; i++) {
            if (sceneAbort) return;
            await sleep(800);
            if (yesEl) {
              const yesNum = yesEl.querySelector('.num') as HTMLElement | null;
              if (yesNum) animateNumber(yesNum, i, 300);
            }
            if (fill) {
              const pct = Math.round((i / 5) * 100);
              fill.style.width = pct + '%';
              fill.textContent = i + '/5';
            }
          }
          await sleep(400);
          if (sceneAbort) return;
          const voteR = $('#voteR'); if (voteR) voteR.classList.add('show');
          if (chatContainer) {
            const kickMsg = document.createElement('div');
            kickMsg.className = 'chat-msg success';
            kickMsg.style.fontSize = '11px';
            kickMsg.style.padding = '6px 10px';
            kickMsg.textContent = '[系统] Hacker123 已被踢出';
            kickMsg.style.opacity = '0';
            kickMsg.style.transform = 'translateY(6px)';
            chatContainer.appendChild(kickMsg);
            await sleep(300);
            requestAnimationFrame(() => kickMsg.classList.add('show'));
          }
          await sleep(1100);
          break;
        }
        case 3: {
          startProgressBar(4500);
          await sleep(400);
          const h3 = $('#scene3 .narrator-text h3');
          if (h3) h3.classList.add('show');
          await sleep(800);
          const pEl = $('#scene3 .narrator-text p');
          if (pEl) pEl.classList.add('show');
          await sleep(2600);
          break;
        }
        case 4: {
          startProgressBar(10000);
          const dashSide = $('#dashSide'); if (dashSide) dashSide.classList.add('show');
          await sleep(400);
          if (sceneAbort) return;
          const stats = $$('.dash-stat');
          for (const s of stats) {
            if (sceneAbort) return;
            await sleep(350);
            s.classList.add('show');
            const numEl = s.querySelector('.dnum') as HTMLElement | null;
            if (numEl) animateNumber(numEl, parseInt(numEl.dataset.target || '0') || 0, 800);
          }
          await sleep(400);
          if (sceneAbort) return;
          const chart = $('.dash-chart');
          if (chart) chart.classList.add('show');
          await sleep(900);
          if (sceneAbort || isMobile) { await sleep(2600); break; }
          const events = [
            { text: '💎 Steve 购买 VIP ¥30', cls: 'vip', amt: '+¥30' },
            { text: '🎁 Lucy 领取新手礼包', cls: 'gift', amt: '新玩家' },
            { text: '🎫 Alex 兑换 CDK', cls: '', amt: '+1' },
          ];
          const eventContainer = $('#dashEvents');
          if (eventContainer) {
            for (const ev of events) {
              if (sceneAbort) return;
              const div = document.createElement('div');
              div.className = 'dash-event ' + ev.cls;
              div.innerHTML = `<div>${ev.text}</div><div class="amt">${ev.amt}</div>`;
              eventContainer.appendChild(div);
              await sleep(150);
              requestAnimationFrame(() => div.classList.add('show'));
              const dnums = $$('.dnum');
              const revNum = dnums[1];
              if (revNum) {
                const cur = parseInt(revNum.textContent) || 0;
                animateNumber(revNum, Math.min(cur + 30, 388), 600);
              }
              await sleep(1300);
            }
          }
          await sleep(800);
          break;
        }
        case 5: {
          startProgressBar(10000);
          const dl1 = $('#dl1'), dl2 = $('#dl2');
          if (dl1) dl1.classList.add('show');
          if (dl2) dl2.classList.add('show');
          await sleep(500);
          const syncLine = $('#syncLine'), syncPulse = $('#syncPulse');
          if (syncLine) syncLine.classList.add('show');
          if (syncPulse) syncPulse.classList.add('show');
          await sleep(500);
          if (sceneAbort) return;
          const syncPairs = [
            { p: '👤 Lucy 加入服务器', o: '📊 在线玩家 47→48' },
            { p: '💎 Lucy 购买 VIP ¥30', o: '💰 流水 ¥358→¥388' },
            { p: '🎫 Alex 兑换 CDK: WELCOME', o: '🎁 CDK 已核销 · 发放道具' },
            { p: '🗳 投票踢人通过', o: '⚖️ 自治事件 +1 · 自动封禁' },
          ];
          const pContainer = $('#playerActions');
          const oContainer = $('#ownerActions');
          for (const pair of syncPairs) {
            if (sceneAbort) return;
            if (pContainer) {
              const pDiv = document.createElement('div');
              pDiv.className = 'dual-action player';
              pDiv.textContent = pair.p;
              pContainer.appendChild(pDiv);
              await sleep(150);
              requestAnimationFrame(() => pDiv.classList.add('show'));
            }
            await sleep(400);
            if (sceneAbort) return;
            if (oContainer) {
              const oDiv = document.createElement('div');
              oDiv.className = 'dual-action owner';
              oDiv.textContent = pair.o;
              oContainer.appendChild(oDiv);
              await sleep(150);
              requestAnimationFrame(() => oDiv.classList.add('show'));
            }
            await sleep(1100);
          }
          await sleep(1100);
          break;
        }
      }
      // Auto advance
      if (isPlaying && !sceneAbort) {
        const scenes = viewModes[currentView];
        const curPos = scenes.indexOf(currentSceneIdx);
        if (curPos < scenes.length - 1) {
          sceneTimer = setTimeout(() => goToScene(scenes[curPos + 1]), 500);
        } else {
          sceneTimer = setTimeout(() => goToScene(scenes[0]), 1500);
        }
      }
    }

    function goToScene(idx: number) {
      if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
      if (sceneProgressRaf) { cancelAnimationFrame(sceneProgressRaf); sceneProgressRaf = null; }
      switchScene(idx);
    }

    function nextScene() {
      const scenes = viewModes[currentView];
      const curPos = scenes.indexOf(currentSceneIdx);
      const next = scenes[(curPos + 1) % scenes.length];
      goToScene(next);
    }
    function prevScene() {
      const scenes = viewModes[currentView];
      const curPos = scenes.indexOf(currentSceneIdx);
      const prev = scenes[(curPos - 1 + scenes.length) % scenes.length];
      goToScene(prev);
    }

    // Controls
    const nextBtn = $('#nextBtn'), prevBtn = $('#prevBtn'), playBtn = $('#playBtn');
    if (nextBtn) nextBtn.addEventListener('click', nextScene);
    if (prevBtn) prevBtn.addEventListener('click', prevScene);
    if (playBtn) playBtn.addEventListener('click', () => {
      isPlaying = !isPlaying;
      playBtn.textContent = isPlaying ? '⏸' : '▶';
      if (isPlaying) nextScene();
      else if (sceneTimer) { clearTimeout(sceneTimer); sceneTimer = null; }
    });

    // View switch
    $$('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentView = (btn as HTMLElement).dataset.view || 'full';
        const first = viewModes[currentView][0];
        goToScene(first);
      });
    });

    // Live number animation in preview
    const liveNumIO = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const target = parseInt((e.target as HTMLElement).dataset.target || '0');
          if (!isNaN(target)) animateNumber(e.target as HTMLElement, target, 1500);
          liveNumIO.unobserve(e.target);
        }
      });
    }, { threshold: 0.5 });
    $$('.live-num').forEach(el => liveNumIO.observe(el));

    // Game chips
    $$('.chip').forEach(c => c.addEventListener('click', () => {
      $$('.chip').forEach(x => x.classList.remove('on'));
      c.classList.add('on');
    }));

    // Click delegation for data-scroll and data-nav and data-goto and data-link
    function handleClick(e: Event) {
      const target = e.target as HTMLElement;
      const scrollEl = target.closest('[data-scroll]') as HTMLElement | null;
      const navEl = target.closest('[data-nav]') as HTMLElement | null;
      const gotoEl = target.closest('[data-goto]') as HTMLElement | null;
      const linkEl = target.closest('[data-link]') as HTMLElement | null;

      if (navEl) {
        e.preventDefault();
        const nav = navEl.dataset.nav;
        if (nav === 'home') {
          navigate('/');
          setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 0);
        } else if (nav === 'owner') navigate('/login', { state: { from: '/store' } });
        else if (nav === 'player') navigate('/login', { state: { from: '/guild' } });
        else if (nav === 'demo') navigate('/demo');
        return;
      }
      if (scrollEl) {
        e.preventDefault();
        const id = scrollEl.dataset.scroll;
        if (id) scrollToId(id);
        return;
      }
      if (gotoEl) {
        e.preventDefault();
        const id = gotoEl.dataset.goto;
        if (id) scrollToId(id);
        return;
      }
      if (linkEl) {
        e.preventDefault();
        const href = linkEl.getAttribute('data-link');
        if (href) navigate(href);
      }
    }
    container.addEventListener('click', handleClick);

    // Start demo when scrolled into view
    let demoStarted = false;
    const demoStartIO = demoSection ? new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !demoStarted) {
        demoStarted = true;
        goToScene(0);
      }
    }, { threshold: 0.3 }) : null;
    if (demoSection && demoStartIO) demoStartIO.observe(demoSection);

    // Register cleanup
    cleanupRef.current = () => {
      window.removeEventListener('scroll', onScroll);
      revealIO.disconnect();
      numIO.disconnect();
      liveNumIO.disconnect();
      if (demoIO) demoIO.disconnect();
      if (demoStartIO) demoStartIO.disconnect();
      container.removeEventListener('click', handleClick);
      if (sceneTimer) clearTimeout(sceneTimer);
      if (sceneProgressRaf) cancelAnimationFrame(sceneProgressRaf);
      if (cursorRAF) cancelAnimationFrame(cursorRAF);
      sceneAbort = true;
    };

    return () => {
      if (cleanupRef.current) cleanupRef.current();
    };
  }, [navigate]);

  return (
    <div className="landing-v6" ref={containerRef} />
  );
}
