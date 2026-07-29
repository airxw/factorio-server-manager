export default function BackgroundEffects() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden">
      {/* 基础暗色背景 */}
      <div className="absolute inset-0 bg-[#090909]" />

      {/* 网格线：桌面端完整显示，移动端减弱 */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:84px_84px] opacity-30 md:opacity-40" />

      {/* 点阵纹理：桌面端显示，移动端隐藏以节省性能 */}
      <div className="absolute inset-0 hidden opacity-[0.08] [background-image:radial-gradient(rgba(255,255,255,0.9)_0.6px,transparent_0.6px)] [background-size:16px_16px] md:block" />

      {/* 彩色光晕：用纯径向渐变模拟，完全消除 CSS blur 滤镜，避免 GPU 纹理缓冲区溢出导致页面变黑 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 28rem 28rem at 5% 0%, rgba(251,191,36,0.12) 0%, transparent 70%),' +
            'radial-gradient(ellipse 26rem 26rem at 95% 18%, rgba(34,211,238,0.10) 0%, transparent 70%),' +
            'radial-gradient(ellipse 42rem 22rem at 50% 100%, rgba(52,211,153,0.08) 0%, transparent 70%)',
        }}
      />
    </div>
  );
}
