import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import OrderDetail from './pages/OrderDetail'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import CreateCustomer from './pages/CreateCustomer'
import Products from './pages/Products'
import ProductDetail from './pages/ProductDetail'
import CreateProduct from './pages/CreateProduct'
import Tasks from './pages/Tasks'
import TaskDetail from './pages/TaskDetail'
import Reports from './pages/Reports'
import BagQuote from './pages/BagQuote'
import BagQuoteWps from './pages/BagQuoteWps'
import BagQuoteOnline from './pages/BagQuoteOnline'
import TestVTable from './pages/TestVTable'

function App() {
  const { isAuthenticated, initAuth } = useAuthStore()

  useEffect(() => {
    initAuth()
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
              <Route path="/quotes" element={<BagQuote />} />
              <Route path="/quotes-wps" element={<BagQuoteWps />} />
              <Route path="/quotes-online" element={<BagQuoteOnline />} />
              <Route path="/test-vtable" element={<TestVTable />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/:id" element={<OrderDetail />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/new" element={<CreateCustomer />} />
              <Route path="/customers/:id" element={<CustomerDetail />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/new" element={<CreateProduct />} />
              <Route path="/products/:id" element={<ProductDetail />} />
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
