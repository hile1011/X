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
import ProductDetail from './pages/ProductDetail'
import CreateProduct from './pages/CreateProduct'
import Reports from './pages/Reports'
import Quotes from './pages/Quotes'
import BagQuote from './pages/BagQuote'
import BagQuoteTable from './pages/BagQuoteTable'
import BagQuoteWps from './pages/BagQuoteWps'
import ProcessCost from './pages/ProcessCost'
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
              <Route path="/process-costs" element={
                <ProtectedRoute permission="process-costs:view"><ProcessCost /></ProtectedRoute>
              } />
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
              <Route path="/products/:id" element={
                <ProtectedRoute permission="products:view"><ProductDetail /></ProtectedRoute>
              } />
              <Route path="/products/:id/edit" element={
                <ProtectedRoute permission="products:edit"><CreateProduct /></ProtectedRoute>
              } />
              <Route path="/reports" element={
                <ProtectedRoute permission="reports:view"><Reports /></ProtectedRoute>
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
