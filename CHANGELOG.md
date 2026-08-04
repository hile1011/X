# 变更日志 (CHANGELOG)

本项目版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/) 规范。

---

## [v0.8.0] - 2026-08-04

### 🎯 核心主题：移动端响应式全面改造 + UI 交互增强

### 新增

#### 移动端响应式设计
- **抽屉式侧边栏**：768px 以下视口自动切换为抽屉式侧边栏，支持汉堡菜单打开/关闭、背景遮罩点击关闭、路由切换自动收起
- **移动端顶栏**：固定顶部导航栏（h-14），显示系统标题和汉堡菜单按钮
- **body 滚动锁定**：抽屉打开时锁定 body 滚动，防止背景滚动穿透
- **iOS 兼容优化**：输入框 font-size ≥16px 防止 iOS Safari 聚焦自动放大；移除 `-webkit-tap-highlight-color` 点击高亮
- **断点设计**：`sm`(640px) / `md`(768px) / `lg`(1024px) 三级断点，768px 为移动/桌面分界点

#### 产品图片拖拽排序
- 基于 HTML5 Drag & Drop API 实现产品图片拖拽排序
- 拖拽视觉反馈：被拖元素半透明虚线边框，目标位置高亮环
- 实时更新图片顺序（`setProductImages`）

#### 仪表盘增强
- 订单状态跟踪显示产品首张图片
- 双色进度条：浅色显示总时间进度，深色显示当前进度
- 双击订单行跳转至详情页
- 利润模式切换（不含税/含税），支持 localStorage 持久化
- 状态排序（升序/降序），交货日期作为稳定二级排序

#### 订单列表增强
- 每页数据条数可设置（10/20/50/100），默认 20 条
- 显示子订单总数和当前页子订单数
- 分页控件优化：上一页/下一页整合为箭头，支持页码跳转
- 导出功能使用全部筛选数据（非当前页）

#### 订单编辑页增强
- 订单状态只读显示（客户名称字段后）
- 状态流转横向滚动（移动端 `overflow-x-auto` + `min-w-[480px]`）

### 修复

#### 关键 Bug 修复
- **移动端水平溢出**：修复订单编辑页在 375px 视口下溢出 59px 的问题（根因：内容容器 `px-6` 非响应式 + 缺少 `min-w-0` 导致 480px 状态流转行撑破视口）
- **编辑页滚动位置**：进入订单编辑页时自动滚动到在线表格的问题，通过 `history.scrollRestoration='manual'` + `useLayoutEffect` + 临时禁用 VTable `scrollIntoView` 三层防御修复
- **报表卡片标题截断**：移除 Reports.tsx 统计卡片标题的 `truncate` 类
- **分页控件与操作列冲突**：分页栏移出滚动容器作为固定页脚

### 优化

#### 触控目标优化（移动端 ≥40px）
- 订单编辑页顶部按钮（返回/保存/导出/重置）：32px → 40px（`min-h-[40px] sm:min-h-0`）
- 订单编辑页数字输入框（成本价/含税价/卖价）：26px → 34px（`py-1.5 sm:py-0.5`）
- 订单列表分页按钮：32×32 → 40×40（`w-10 h-10 sm:w-8 sm:h-8`）
- 仪表盘"查看全部"链接：20px → 40px
- 仪表盘利润模式切换：19px → 36px

#### 布局响应式优化
- 全部页面外层容器 `p-6` → `p-4 sm:p-6`
- 顶栏 `flex-row` → `flex-col sm:flex-row` + `flex-wrap`
- 产品网格移动端 `grid-cols-2`
- 统计卡片网格 `gap-4` → `gap-3 sm:gap-4`
- 输入框样式统一为蓝色标准风格（`bg-blue-50/40 text-blue-600`）

### 验证

- TypeScript 类型检查：零错误
- 单元测试：592/592 通过（20 个测试文件）
- 生产构建：前端 + 后端均成功
- 响应式回归测试（CDP 自动化）：
  - 375px / 768px / 1024px 三尺寸 × 5 页面 = 15 项检查，0 溢出
  - 断点行为验证：768px 处正确切换移动/桌面布局
  - 抽屉交互验证：打开/关闭/导航自动收起均正常
- 数据库 schema 无变更（v9 完全兼容，无需迁移）

### 涉及文件（22 个）

| 文件 | 变更类型 |
|------|----------|
| src/App.tsx | 滚动位置恢复 |
| src/components/Layout.tsx | 移动端外壳（抽屉/顶栏/遮罩） |
| src/components/Sidebar.tsx | 移动端抽屉 + 触控优化 |
| src/components/CustomerSelect.tsx | 输入框样式统一 |
| src/index.css | iOS 兼容 + 点击高亮 |
| src/pages/BagQuote.tsx | 拖拽排序 + 状态显示 + 响应式 + 触控 |
| src/pages/Quotes.tsx | 分页优化 + 响应式 |
| src/pages/Dashboard.tsx | 首图 + 双色进度条 + 双击跳转 + 响应式 |
| src/pages/Customers.tsx | 响应式 + 触控 |
| src/pages/Products.tsx | 响应式 + 触控 |
| src/pages/Reports.tsx | 卡片标题修复 + 响应式 |
| src/pages/Login.tsx | 响应式 padding |
| src/pages/Register.tsx | 响应式 padding |
| src/pages/OrderDetail.tsx | 响应式 |
| src/pages/CreateCustomer.tsx | 响应式 |
| src/pages/CreateProduct.tsx | 响应式 |
| src/pages/CustomerDetail.tsx | 响应式 |
| src/pages/ProductDetail.tsx | 响应式 |
| src/pages/TaskDetail.tsx | 响应式 |
| src/pages/Tasks.tsx | 响应式 |
| src/pages/Orders.tsx | 响应式 |
| src/pages/ProcessCost.tsx | 响应式 |

---

## [v0.7.0] - 2026-08-04

### 新增
- 重构：提取 7 个独立类（OrderStatus / ProductionSteps / StyleConstants / TableConstants / SheetTemplateManager / ExcelUtils / DateUtils），消除 450 行重复代码
- 新增：标准化环境管理命令集（build / start / stop / restart / status）
- 新增 141 个单元测试，覆盖率 100%（总 592 个测试通过）

### 修复
- .gitignore 删除过宽的 `*.md` 规则，添加 `coverage/` 忽略
- 修复 common.sh 语法错误、build/start/stop/restart 脚本中 help 函数位置问题
- 修复 find_port_pid 在无匹配时返回非零、构建步骤计数失真、端口冲突等问题

---

## [v0.6.0] - 2026-08-04

### 新增
- 在线表格公式单元格高亮（浅橙色 #F8CBAD）
- 订单列表分页控件（每页 20 条 + 页码跳转）
- 仪表盘订单状态跟踪甘特图
- 88 个单元测试（4 个测试文件）

### 修复
- 产品编辑页取消按钮导航至列表页
- Products.tsx 缺少 API 错误处理

---

## [v0.5.0] - 2026-08-04

### 新增
- 在线表格公式持久化机制重构（allFormulas 字段完整保存所有公式）
- 数据库 v7 → v9 平滑迁移（新增 modifiedFormulas 和 allFormulas 字段）

### 修复
- 公式恢复原状问题（VTable 公式引擎陷阱：fm.setCellContent 传入公式字符串会清空计算值）

---

## [v0.4.0] - 2026-08-03

### 新增
- 款式数据源变更为产品管理模块（products 表 code 字段匹配 1-6）
- 订单列表优化
- VTable 升级至 1.26.6

---

## [v0.3.0] - 2026-07-13

### 新增
- 项目初始版本
- 报价管理、订单管理、客户管理、产品管理核心功能
- SQLite 数据库 + 迁移系统（v1-v7）
- VTable-Sheet 在线表格集成
