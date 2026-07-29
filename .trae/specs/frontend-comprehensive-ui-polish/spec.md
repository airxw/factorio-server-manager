# Factorio Server Manager - 前端全面美化升级 PRD

## Overview
- **Summary**: 基于参考设计（factoriowebts-creative-proposal.html）的视觉风格，对 Factorio Server Manager 前端进行整体视觉与交互体验的深度美化升级。从设计令牌、排版系统、布局结构、组件规范、动效反馈、响应式适配六个维度全面重构，消除内联样式和设计系统不一致问题，打造专业、精致、高效的工业科技风管理面板。
- **Purpose**: 当前前端虽有基础的工业科技风主题，但存在间距留白不足、排版层级不够精致、部分组件（JsonForm/Logs终端/Modal）脱离设计系统使用硬编码颜色、工具类不完整导致内联样式泛滥、圆角偏小、双色调缺失（缺少青色辅助色）、卡片/按钮hover反馈不够细腻、信息层级不够清晰等问题。需要从整体而非局部出发，系统性提升视觉品质与交互体验。
- **Target Users**: Factorio 服务器管理员、社区服运营者、普通玩家用户

## Goals
- 升级设计令牌系统，引入参考设计中的橙+青双色方案，优化背景色层次、圆角、阴影
- 重构排版系统：统一字号层级、行高（1.6-1.8）、字间距，建立清晰的视觉节奏
- 优化页面布局结构：增大留白、统一间距尺度、优化内容分组和视觉节奏
- 统一所有组件视觉风格：修复 JsonForm、Logs 终端、Modal 等脱离设计系统的组件
- 完善 CSS 工具类体系，消除静态内联样式（动态进度条width等保留）
- 增强交互动效：更细腻的hover、focus、transition反馈，添加微交互
- 优化侧边栏导航体验：图标与文字对齐、激活态更精致、折叠态更优雅
- 优化按钮系统：尺寸梯度（sm/md/lg）、圆角统一、hover/active/disabled状态更精致
- 优化表格体验：表头样式、行hover、间距、斑马纹可选
- 添加通用Modal组件样式、Tag标签组件样式
- 全面响应式适配，确保移动端体验良好

## Non-Goals (Out of Scope)
- 不改变现有业务逻辑和功能
- 不引入新的前端框架或UI库（保持纯CSS+React现状）
- 不重写页面组件的JSX结构（仅修改className和样式相关代码）
- 不做暗色/亮色主题切换
- 不增加新功能页面
- 不修改后端API

## Background & Context
- 项目技术栈：React 19 + TypeScript + Vite 6 + React Router 7
- 当前状态：已部署在 http://trae.ecsrz.com:3000（admin/admin）
- 设计参考：`/home/air/Desktop/factorio/factoriowebts-creative-proposal/factoriowebts-creative-proposal.html` 展示了更成熟的深色UI设计语言
- 核心问题已通过代码分析识别：
  1. 设计令牌不完整（缺少青色辅助色、部分变量被引用但未定义如--accent-blue/--bg-hover）
  2. 排版基准字号偏小（15px vs 参考16px），行高偏紧（1.55 vs 参考1.8）
  3. 圆角偏小（卡片8px vs 参考12px）
  4. JsonForm组件完全自包含slate色系样式，与主设计系统割裂
  5. Logs日志终端硬编码slate色，风格不统一
  6. Saves页面Modal完全用内联样式实现
  7. CSS工具类不完整，导致~40处静态内联样式
  8. 统计卡片和普通卡片视觉层次不够
  9. 按钮缺少尺寸梯度，hover效果较生硬
  10. 表格行间距偏紧，表头视觉层次不够

## Functional Requirements
- **FR-1**: 升级CSS设计令牌，采用参考设计的橙(#f97316)+青(#06b6d4)双主色方案，优化背景色、边框、阴影、圆角、过渡变量
- **FR-2**: 重构全局排版：基础字号16px、正文行高1.6-1.7、建立6级字号层级、优化字间距和字体栈（加入中文字体优化）
- **FR-3**: 优化整体布局间距：主内容区内边距增大、卡片间距统一、页面标题区留白增加、表单间距标准化
- **FR-4**: 统一侧边栏样式：优化导航项高度、图标文字对齐、激活态渐变效果、折叠态tooltip、底部版本号和用户信息区
- **FR-5**: 升级按钮系统：统一3种尺寸(sm/md/lg)、圆角增大到8px、hover态添加微妙的scale和glow效果、按钮组间距规范
- **FR-6**: 升级卡片组件：圆角12px、边框hover变主色、顶部装饰线更精致、内边距统一、stat-card数据展示更大气
- **FR-7**: 升级表格样式：增大单元格padding、表头背景色加深、表头下边框用主色、行hover更柔和、优化代码列样式
- **FR-8**: 升级表单控件：输入框高度统一、focus发光效果优化、select箭头样式更新、checkbox/radio样式美化
- **FR-9**: 重构JsonForm组件样式，使其完全使用主设计系统CSS变量，移除所有硬编码颜色
- **FR-10**: 重构Logs日志终端样式，使用主题色变量，添加更好的字体和行高
- **FR-11**: 添加通用Modal样式类（.modal-overlay, .modal-card），替换Saves页内联模态框样式
- **FR-12**: 添加Tag标签组件样式，用于分类、状态标记
- **FR-13**: 完善CSS工具类：补充flex-1、m-0/mt-3/mr-2、w-full、hidden、font-mono、text-sm/text-xl、字号工具类等
- **FR-14**: 优化徽章(Badge)样式：圆角增大、添加微妙边框、pulse动画优化
- **FR-15**: 优化Alert提示框：左侧彩色边框增强、图标区域优化、圆角增大
- **FR-16**: 优化进度条：高度增加、圆角增大、shimmer动画优化
- **FR-17**: 优化认证页面(Login/Register/Setup)：增大logo、优化标题渐变、输入框高度、按钮尺寸
- **FR-18**: 优化Tabs标签页：激活态指示器更粗、过渡动画更流畅
- **FR-19**: 优化分页组件：按钮样式统一、当前页高亮、间距规范
- **FR-20**: 增强动效：页面进入动画优化、卡片级联动画时长调整、按钮按压反馈(scale:0.98)、focus ring动画
- **FR-21**: 修复Saves页面引用的未定义CSS变量(--accent-blue, --bg-hover)
- **FR-22**: 添加滚动条美化（与参考设计一致的细滚动条）
- **FR-23**: 清除所有静态内联样式（动态width百分比等运行时计算值保留）

## Non-Functional Requirements
- **NFR-1**: CSS文件gzip后体积增量不超过10KB
- **NFR-2**: 所有动画使用transform/opacity，保证60fps流畅度，不引起layout thrashing
- **NFR-3**: 兼容Chrome 90+、Firefox 90+、Safari 15+、Edge 90+
- **NFR-4**: 响应式断点保持3级（1024/768/480），移动端可用
- **NFR-5**: 对比度符合WCAG AA标准（文字与背景对比度≥4.5:1）
- **NFR-6**: TypeScript编译零错误
- **NFR-7**: 不引入任何新的npm依赖
- **NFR-8**: 所有样式变更通过CSS类实现，不在JSX中添加新的内联样式
- **NFR-9**: 页面加载和交互性能不受负面影响（LCP、FID指标不下降）

## Constraints
- **Technical**: 纯CSS实现，不使用CSS-in-JS、styled-components、Tailwind等；使用现有技术栈（React+TypeScript+Vite）；不引入新依赖
- **Business**: demo服务器需持续运行，部署不能导致服务长时间不可用；必须部署到trae.ecsrz.com验证效果
- **Dependencies**: 依赖现有的lucide-react图标库；后端API不变

## Assumptions
- 参考设计的视觉语言（双色方案、大圆角、柔和渐变、精致间距）适合Factorio服务器管理面板的工业科技风定位
- 橙色主色(#f97316)比现有琥珀色(#f59e0b)更有活力，青色辅助色(#06b6d4)提供更好的信息层次区分
- 增大圆角和留白不会降低信息密度到影响管理员操作效率的程度
- 用户已认可工业暗黑风方向，本次为该方向的深化而非风格转型
- 所有页面均可通过修改className和CSS完成美化，无需重构组件逻辑

## Acceptance Criteria

### AC-1: 设计令牌系统升级
- **Given**: 用户访问任意页面
- **When**: 页面加载完成
- **Then**: 使用新的色彩系统：主色#f97316（橙）、辅助色#06b6d4（青）、背景三级层次#0f1117/#1a1d27/#242836；圆角基准为12px（卡片）；所有CSS变量都已定义且无引用错误
- **Verification**: `programmatic`
- **Notes**: 通过grep检查所有CSS变量引用，确认不存在未定义变量；通过浏览器DevTools检查computed样式

### AC-2: 排版系统统一
- **Given**: 用户访问任意页面
- **When**: 检查文字排版
- **Then**: 基础字号为16px；正文行高1.6-1.7；存在清晰的6级字号层级（页面标题24px、卡片标题16px、统计数值28px、正文14px、辅助文字12px、标签文字11px）；字体栈包含中文字体优化
- **Verification**: `human-judgment`
- **Notes**: 重点检查标题、正文、表格文字、表单标签的大小和间距一致性

### AC-3: 布局留白优化
- **Given**: 用户登录后访问控制台首页
- **When**: 观察页面布局
- **Then**: 主内容区内边距不小于24px；卡片之间间距不小于16px；页面标题距下方内容不小于24px；卡片内部padding不小于20px；整体视觉有呼吸感，不拥挤
- **Verification**: `human-judgment`

### AC-4: 侧边栏精致化
- **Given**: 用户在已登录状态
- **When**: 观察侧边栏导航
- **Then**: 导航项高度统一为40-44px；图标和文字垂直居中对齐；激活项有左侧指示条+渐变背景；hover态反馈明显；折叠态下只显示图标且有tooltip提示；底部用户信息和版本号样式统一
- **Verification**: `human-judgment`

### AC-5: 按钮系统完善
- **Given**: 任意页面的按钮
- **When**: 与按钮交互
- **Then**: 按钮有sm/md/lg三种尺寸；默认圆角8px；hover时有translateY(-1px)+微妙阴影；active时scale(0.98)有按压感；disabled态统一为opacity-50+not-allowed；主按钮、次按钮、危险按钮、成功按钮颜色语义清晰
- **Verification**: `human-judgment`

### AC-6: 卡片视觉升级
- **Given**: 任意内容卡片
- **When**: 观察和hover卡片
- **Then**: 卡片圆角12px；边框1px solid var(--rule)；hover时边框变为对应强调色（普通卡片→主色，信息类→青色）；卡片有微妙的渐变背景；stat-card的数值和标签层次分明，hover时有轻微上浮
- **Verification**: `human-judgment`

### AC-7: 表格体验优化
- **Given**: 任意数据表格（玩家列表、订单、用户管理等）
- **When**: 浏览表格内容
- **Then**: 表头背景色为var(--bg3)，表头文字为var(--ink)，下边框为2px solid var(--accent)；单元格padding为12px 16px；行hover背景为var(--bg2)；表格文字大小统一为13-14px
- **Verification**: `human-judgment`

### AC-8: JsonForm组件风格统一
- **Given**: 访问配置页面（Config）使用JsonForm
- **When**: 检查表单样式
- **Then**: JsonForm的输入框、按钮、标签、分组标题全部使用主设计系统的CSS变量；不再出现#0f172a/#334155/#0ea5e9等硬编码slate色；与其他页面表单视觉风格一致
- **Verification**: `programmatic` + `human-judgment`
- **Notes**: grep JsonForm.tsx确认无硬编码hex颜色；人工对比Config页和Settings页表单风格一致性

### AC-9: Logs终端风格统一
- **Given**: 访问日志页面（Logs）
- **When**: 查看日志输出区域
- **Then**: 日志终端背景使用var(--bg-base)或var(--bg-surface)；文字颜色使用var(--text-primary/secondary)；边框使用var(--border)；字体使用等宽字体栈；与整体深色主题一致，不再使用slate色系硬编码
- **Verification**: `human-judgment`

### AC-10: 内联样式清除
- **Given**: 所有tsx文件
- **When**: 检查style={{}}使用
- **Then**: 仅保留动态计算值的内联样式（如进度条width百分比、条件样式中的动态颜色）；所有静态样式（fontSize/margin/padding/color/background/display等）都通过CSS类实现；静态内联样式数量从40+减少到5处以内（仅限动态值）
- **Verification**: `programmatic`
- **Notes**: 通过grep统计style={{数量，人工逐一确认合理性

### AC-11: Modal组件样式
- **Given**: 存档页面重命名功能
- **When**: 触发重命名模态框
- **Then**: 模态框使用通用modal样式类；遮罩层为半透明黑色+backdrop blur；模态卡片居中显示，圆角12px，有阴影；关闭/取消按钮在合理位置
- **Verification**: `human-judgment`

### AC-12: CSS工具类完整
- **Given**: 开发者需要添加布局间距
- **When**: 使用CSS工具类
- **Then**: 有足够的工具类：flex-1、m-0/mt-1/mt-2/mt-3/mt-4/mt-6/mr-2/mb-2、p-0/p-2/p-4、w-full/w-auto、hidden、text-center/text-left/text-right、text-sm/text-base/text-lg/text-xl、font-mono、gap-2/gap-3/gap-4、items-center/justify-between等
- **Verification**: `programmatic`

### AC-13: 认证页面美化
- **Given**: 访问登录/注册页面
- **When**: 观察页面视觉
- **Then**: 登录卡片圆角12px；顶部有渐变装饰条；logo图标有微妙发光；标题使用渐变文字效果（可选）；输入框高度44px；登录按钮高度44px；注册链接样式明显；整体居中且有品质感
- **Verification**: `human-judgment`

### AC-14: 动效流畅自然
- **Given**: 任意页面交互
- **When**: 进行导航、hover、点击、页面切换操作
- **Then**: 页面进入时fade-in+slide-up动画时长300-400ms；按钮hover过渡200ms；卡片hover边框变化200ms；所有动画使用cubic-bezier缓动函数；没有卡顿或跳跃
- **Verification**: `human-judgment`

### AC-15: 响应式适配
- **Given**: 使用不同屏幕尺寸访问
- **When**: 分别在桌面(1920/1440/1024)、平板(768)、手机(480/375)宽度下查看
- **Then**: 桌面端布局舒展不松散；平板端侧边栏自动折叠为图标模式；手机端统计卡片1-2列、按钮全宽、表格可横滚、表单纵向排列；所有内容可访问，无截断或遮挡
- **Verification**: `human-judgment`

### AC-16: TypeScript编译通过
- **Given**: 修改后的代码
- **When**: 运行npm run build
- **Then**: 编译成功，零TypeScript错误，产出dist目录
- **Verification**: `programmatic`

### AC-17: 部署到demo服务器可访问
- **Given**: 构建完成后
- **When**: 部署到trae.ecsrz.com
- **Then**: 服务正常启动（curl返回200）；登录页面显示新样式；登录后控制台、商店、玩家管理等所有页面样式一致，无CSS加载错误
- **Verification**: `programmatic` + `human-judgment`

### AC-18: 视觉一致性
- **Given**: 遍历所有20个页面
- **When**: 逐页检查视觉风格
- **Then**: 所有页面色彩、字体、圆角、间距、按钮、卡片、表格风格统一；不存在某页面使用独立颜色体系的情况；整体呈现专业的工业管理面板视觉品质
- **Verification**: `human-judgment`

## Open Questions
- [ ] 是否需要在Dashboard顶部添加参考设计中的Hero式欢迎区域（带渐变标题和服务器状态概览）？还是保持当前stat-grid方式即可？
- [ ] 双主色中青色(#06b6d4)的使用范围：仅用于信息类徽章/链接/辅助强调，还是也要用于部分按钮/交互元素？
- [ ] 现有的琥珀色#f59e0b是完全替换为#f97316，还是保留作为warning色单独使用？
- [ ] 是否需要添加微交互动画（如按钮点击涟漪效果、数字滚动动画）？
