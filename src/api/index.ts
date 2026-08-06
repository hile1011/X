import { useAuthStore } from '../store/auth'

const API_BASE = '/api'

/**
 * 获取当前认证 token（从 auth store 读取）
 * 用于在 API 请求中附加 Authorization 头
 */
function getAuthToken(): string | null {
  return useAuthStore.getState().token
}

/**
 * 获取当前操作人名称（用于审计日志）
 */
function getOperator(): string {
  return useAuthStore.getState().user?.name || 'unknown'
}

/**
 * 构建带认证头的 fetch 选项
 * 自动附加 Authorization: Bearer <token> 头和 X-Operator 头（审计用）
 */
function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = getAuthToken()
  const operator = getOperator()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (operator) {
    headers['X-Operator'] = operator
  }
  return fetch(url, { ...options, headers })
}

// 统一响应处理：检查 HTTP 状态码，解析 JSON，空响应返回 null，错误时抛出带状态码的异常
async function handleResponse(res: Response): Promise<any> {
  const text = await res.text()
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`
    if (text) {
      try {
        const err = JSON.parse(text)
        msg = err.error || err.message || msg
      } catch {
        msg = text
      }
    }
    throw new Error(msg)
  }
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const jsonHeaders = { 'Content-Type': 'application/json' }

export const api = {
  orders: {
    getAll: () => authFetch(`${API_BASE}/orders`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/orders/${id}`).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/orders/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/orders/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/orders/${id}/delete-check`).then(handleResponse),
  },
  customers: {
    getAll: () => authFetch(`${API_BASE}/customers`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/customers/${id}`).then(handleResponse),
    getByName: (name: string) => authFetch(`${API_BASE}/customers/name/${encodeURIComponent(name)}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/customers/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/customers/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/customers/${id}/delete-check`).then(handleResponse),
  },
  products: {
    getAll: () => authFetch(`${API_BASE}/products`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/products/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/products/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/products/${id}/delete-check`).then(handleResponse),
  },
  tasks: {
    getAll: () => authFetch(`${API_BASE}/tasks`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/tasks/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/tasks/${id}/delete-check`).then(handleResponse),
  },
  quotes: {
    getAll: () => authFetch(`${API_BASE}/quotes`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/quotes/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/quotes`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/quotes/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/quotes/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/quotes/${id}/delete-check`).then(handleResponse),
    nextStatus: (id: string) => authFetch(`${API_BASE}/quotes/${id}/next-status`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
    prevStatus: (id: string) => authFetch(`${API_BASE}/quotes/${id}/prev-status`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
    endQuote: (id: string) => authFetch(`${API_BASE}/quotes/${id}/end`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
  },
  processCosts: {
    getAll: () => authFetch(`${API_BASE}/process-costs`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/process-costs/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/process-costs`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/process-costs/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/process-costs/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteCheck: (id: string) => authFetch(`${API_BASE}/process-costs/${id}/delete-check`).then(handleResponse),
  },
  export: {
    /** 导出订单列表（返回 Blob 用于下载） */
    orders: async (orderIds: string[]): Promise<Blob> => {
      const res = await authFetch(`${API_BASE}/export/orders`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ orderIds }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = `导出失败 (${res.status})`
        try { const err = JSON.parse(text); msg = err.error || msg } catch { if (text) msg = text }
        throw new Error(msg)
      }
      return res.blob()
    },
    /** 导出单订单 + 在线表格（返回 Blob 用于下载） */
    orderWithTable: async (orderId: string, tableData: { data: (string | number | null)[][]; formulas: Record<string, string> }): Promise<Blob> => {
      const res = await authFetch(`${API_BASE}/export/order-with-table`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ orderId, tableData }),
      })
      if (!res.ok) {
        const text = await res.text()
        let msg = `导出失败 (${res.status})`
        try { const err = JSON.parse(text); msg = err.error || msg } catch { if (text) msg = text }
        throw new Error(msg)
      }
      return res.blob()
    },
  },
}

/** 触发浏览器下载 Blob 文件 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 延迟释放 URL，确保下载已触发
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
