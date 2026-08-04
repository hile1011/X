import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import CreateCustomer from './pages/CreateCustomer'
import Products from './pages/Products'
import ProductDetail from './pages/ProductDetail'
import CreateProduct from './pages/CreateProduct'
import Tasks from './pages/Tasks'
import TaskDetail from './pages/TaskDetail'
import Reports from './pages/Reports'
import Quotes from './pages/Quotes'
import BagQuote from './pages/BagQuote'
import BagQuoteTable from './pages/BagQuoteTable'
import BagQuoteWps from './pages/BagQuoteWps'
import ProcessCost from './pages/ProcessCost'

function App() {
  const { isAuthenticated, initAuth } = useAuthStore()

  useEffect(() => {
    initAuth()
    // SPA 中禁用浏览器原生滚动恢复，避免进入页面时恢复到历史滚动位置
    // （如订单编辑页进入时被恢复到在线表格位置，而非停留在顶部）
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
  }, [initAuth])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {isAuthenticated ? (
          <Route path="*" element={<Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/quotes" element={<Quotes />} />
              <Route path="/quotes/new" element={<BagQuote />} />
              <Route path="/quotes/:id" element={<BagQuote />} />
              <Route path="/quotes/:id/edit" element={<BagQuote />} />
              <Route path="/quotes-table/new" element={<BagQuoteTable />} />
              <Route path="/quotes-table/:id" element={<BagQuoteTable />} />
              <Route path="/quotes-table/:id/edit" element={<BagQuoteTable />} />
              <Route path="/quotes-wps" element={<BagQuoteWps />} />
              <Route path="/process-costs" element={<ProcessCost />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/new" element={<CreateCustomer />} />
              <Route path="/customers/:id/edit" element={<CreateCustomer />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/new" element={<CreateProduct />} />
              <Route path="/products/:id" element={<ProductDetail />} />
              <Route path="/products/:id/edit" element={<CreateProduct />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/tasks/:id" element={<TaskDetail />} />
              <Route path="/reports" element={<Reports />} />
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
