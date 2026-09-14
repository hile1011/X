import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import { ProtectedRoute } from './components/ProtectedRoute'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import CreateCustomer from './pages/CreateCustomer'
import Products from './pages/Products'
import CreateProduct from './pages/CreateProduct'
import Reports from './pages/Reports'
import AnnualReport from './pages/AnnualReport'
import ReconciliationAlerts from './pages/ReconciliationAlerts'
import ReconciliationDetail from './pages/ReconciliationDetail'
import Quotes from './pages/Quotes'
import AiOrderChat from './pages/AiOrderChat'
import ProductionTracking from './pages/ProductionTracking'
import BagQuote from './pages/BagQuote'
import BagQuoteTable from './pages/BagQuoteTable'
import BagQuoteWps from './pages/BagQuoteWps'
import ProductCostItemList from './pages/ProductCostItemList'
import ProductCostItems from './pages/ProductCostItems'
import SheetTemplates from './pages/SheetTemplates'
import Users from './pages/Users'
import Roles from './pages/Roles'
import Permissions from './pages/Permissions'

/** 403 禁止访问页面 */
function Forbidden() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">403</h1>
        <p className="text-gray-500 mb-4">抱歉，您没有权限访问此页面</p>
        <a href="/" className="text-primary-600 hover:text-primary-700 font-medium">返回首页</a>
      </div>
    </div>
  )
}

function App() {
  const { isAuthenticated, initAuth } = useAuthStore()
  const [authReady, setAuthReady] = useState(false)

  useEffect(() => {
    // 异步初始化认证（用 refresh token 恢复登录态）
    initAuth().finally(() => setAuthReady(true))

    // SPA 中禁用浏览器原生滚动恢复
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [initAuth])

  // 等待认证初始化完成，避免刷新时闪烁到登录页
  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Navigate to="/login" replace />} />

        {isAuthenticated ? (
          <Route path="*" element={<Layout>
            <Routes>
              <Route path="/" element={
                <ProtectedRoute permission="dashboard:view"><Dashboard /></ProtectedRoute>
              } />
              <Route path="/quotes" element={
                <ProtectedRoute permission="quotes:view"><Quotes /></ProtectedRoute>
              } />
              {/* AI 智能下单（v35）：对话式生成订单草稿，确认后跳转新建订单页自动填充 */}
              <Route path="/ai-order-chat" element={
                <ProtectedRoute permission="ai-order:view"><AiOrderChat /></ProtectedRoute>
              } />
              {/* 做货跟踪：订单做货流程甘特图 + 订单状态跟踪（自仪表盘迁移；v30 独立模块权限） */}
              <Route path="/production-tracking" element={
                <ProtectedRoute permission="production-tracking:view"><ProductionTracking /></ProtectedRoute>
              } />
              {/* 订单对账管理（v28）：双列表（待对账/已对账）+ 专属对账页；v30 独立模块权限 */}
              <Route path="/reconciliation-alerts" element={
                <ProtectedRoute permission="reconciliation:view"><ReconciliationAlerts /></ProtectedRoute>
              } />
              <Route path="/reconciliation-alerts/:id" element={
                <ProtectedRoute permission="reconciliation:view"><ReconciliationDetail /></ProtectedRoute>
              } />
              <Route path="/quotes/new" element={
                <ProtectedRoute permission="quotes:create"><BagQuote /></ProtectedRoute>
              } />
              {/* 查看详情：只读模式（key 确保从查看切换到编辑时组件重新挂载，VTable 重新初始化） */}
              <Route path="/quotes/:id" element={
                <ProtectedRoute permission="quotes:view"><BagQuote readOnly key="view" /></ProtectedRoute>
              } />
              {/* 编辑：需要编辑权限 */}
              <Route path="/quotes/:id/edit" element={
                <ProtectedRoute permission="quotes:edit"><BagQuote key="edit" /></ProtectedRoute>
              } />
              <Route path="/quotes-table/new" element={
                <ProtectedRoute permission="quotes-table:view"><BagQuoteTable /></ProtectedRoute>
              } />
              <Route path="/quotes-table/:id" element={
                <ProtectedRoute permission="quotes-table:view"><BagQuoteTable /></ProtectedRoute>
              } />
              <Route path="/quotes-table/:id/edit" element={
                <ProtectedRoute permission="quotes-table:view"><BagQuoteTable /></ProtectedRoute>
              } />
              <Route path="/quotes-wps" element={
                <ProtectedRoute permission="quotes-wps:view"><BagQuoteWps /></ProtectedRoute>
              } />
              <Route path="/product-cost-items" element={
                <ProtectedRoute permission="process-costs:view"><ProductCostItemList /></ProtectedRoute>
              } />
              {/* 编辑详情页：成本项工艺与自定义字段配置 */}
              <Route path="/product-cost-items/:id" element={
                <ProtectedRoute permission="process-costs:view"><ProductCostItems /></ProtectedRoute>
              } />
              {/* 旧路径兼容：工艺成本管理更名为产品成本项配置（v31） */}
              <Route path="/process-costs" element={<Navigate to="/product-cost-items" replace />} />
              {/* 款式模板管理：在线可视化编辑试算表模板 */}
              <Route path="/sheet-templates" element={
                <ProtectedRoute permission="sheet-templates:view"><SheetTemplates /></ProtectedRoute>
              } />
              <Route path="/customers" element={
                <ProtectedRoute permission="customers:view"><Customers /></ProtectedRoute>
              } />
              <Route path="/customers/new" element={
                <ProtectedRoute permission="customers:create"><CreateCustomer /></ProtectedRoute>
              } />
              <Route path="/customers/:id/edit" element={
                <ProtectedRoute permission="customers:edit"><CreateCustomer /></ProtectedRoute>
              } />
              <Route path="/customers/:id" element={
                <ProtectedRoute permission="customers:view"><CustomerDetail /></ProtectedRoute>
              } />
              <Route path="/products" element={
                <ProtectedRoute permission="products:view"><Products /></ProtectedRoute>
              } />
              <Route path="/products/new" element={
                <ProtectedRoute permission="products:create"><CreateProduct /></ProtectedRoute>
              } />
              {/* 产品详情：与编辑页共用布局，查看模式（表单禁用 + 图册浏览/双击全屏预览） */}
              <Route path="/products/:id" element={
                <ProtectedRoute permission="products:view"><CreateProduct viewMode /></ProtectedRoute>
              } />
              <Route path="/products/:id/edit" element={
                <ProtectedRoute permission="products:edit"><CreateProduct /></ProtectedRoute>
              } />
              <Route path="/reports" element={
                <ProtectedRoute permission="reports:view"><Reports /></ProtectedRoute>
              } />
              {/* 年度业务报表（原仪表盘业绩模块迁移；v30 独立模块权限） */}
              <Route path="/annual-report" element={
                <ProtectedRoute permission="annual-report:view"><AnnualReport /></ProtectedRoute>
              } />
              <Route path="/users" element={
                <ProtectedRoute permission="users:view"><Users /></ProtectedRoute>
              } />
              <Route path="/roles" element={
                <ProtectedRoute permission="roles:view"><Roles /></ProtectedRoute>
              } />
              <Route path="/permissions" element={
                <ProtectedRoute permission="users:view"><Permissions /></ProtectedRoute>
              } />
              <Route path="/403" element={<Forbidden />} />
            </Routes>
          </Layout>} />
        ) : (
          <Route path="*" element={<Navigate to="/login" />} />
        )}
      </Routes>
    </BrowserRouter>
  )
}

export default App
