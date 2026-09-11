import { useAuthStore } from '../store/auth'

const API_BASE = '/api'

/**
 * 获取当前认证 token（从 auth store 读取）
 * 用于在 API 请求中附加 Authorization 头
 */
function getAuthToken(): string | null {
  return useAuthStore.getState().accessToken
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
 * 遇到 401 时自动尝试刷新 token 并重试一次
 */
async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const token = getAuthToken()
  const operator = getOperator()
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>),
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  if (operator) {
    // HTTP 头只允许 ISO-8859-1 字符，中文操作人名称需 URL 编码
    headers['X-Operator'] = encodeURIComponent(operator)
  }

  let res = await fetch(url, { ...options, headers, cache: 'no-store' })

  // 401 → 尝试刷新 token 后重试一次
  if (res.status === 401) {
    const refreshed = await useAuthStore.getState().refreshToken()
    if (refreshed) {
      const newToken = getAuthToken()
      if (newToken) {
        headers['Authorization'] = `Bearer ${newToken}`
      }
      res = await fetch(url, { ...options, headers })
    }
  }

  return res
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
  auth: {
    login: (email: string, password: string) =>
      fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ email, password }),
      }).then(handleResponse),
    me: () => authFetch(`${API_BASE}/auth/me`).then(handleResponse),
    refresh: (refreshToken: string) =>
      fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ refreshToken }),
      }).then(handleResponse),
    changePassword: (oldPassword: string, newPassword: string) =>
      authFetch(`${API_BASE}/auth/password`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ oldPassword, newPassword }),
      }).then(handleResponse),
  },
  permissions: {
    getAll: () => authFetch(`${API_BASE}/permissions`).then(handleResponse),
  },
  users: {
    getAll: () => authFetch(`${API_BASE}/users`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/users/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/users`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/users/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    resetPassword: (id: string, newPassword: string) => authFetch(`${API_BASE}/users/${id}/password`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ newPassword }),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/users/${id}`, { method: 'DELETE' }).then(handleResponse),
  },
  roles: {
    getAll: () => authFetch(`${API_BASE}/roles`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/roles/${id}`).then(handleResponse),
    create: (data: unknown) => authFetch(`${API_BASE}/roles`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    update: (id: string, data: unknown) => authFetch(`${API_BASE}/roles/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/roles/${id}`, { method: 'DELETE' }).then(handleResponse),
  },
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
    /** 产品图册（v32）：媒体列表（按上传顺序/自定义排序） */
    getMedia: (productId: string) => authFetch(`${API_BASE}/products/${productId}/media`).then(handleResponse),
    /** 产品图册：上传图片/视频（multipart，原文件存储不压缩；返回新创建的媒体记录数组） */
    uploadMedia: async (productId: string, files: File[]): Promise<unknown> => {
      const formData = new FormData()
      files.forEach((f) => formData.append('files', f))
      const res = await authFetch(`${API_BASE}/products/${productId}/media`, {
        method: 'POST',
        body: formData,
      })
      return handleResponse(res)
    },
    /** 产品图册：删除单个媒体（含磁盘原文件） */
    deleteMedia: (productId: string, mediaId: string) =>
      authFetch(`${API_BASE}/products/${productId}/media/${mediaId}`, { method: 'DELETE' }).then(handleResponse),
    /** 产品图册：自定义重排（mediaIds 为该产品全部媒体 id 的新顺序） */
    reorderMedia: (productId: string, mediaIds: string[]) =>
      authFetch(`${API_BASE}/products/${productId}/media/reorder`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ mediaIds }),
      }).then(handleResponse),
    /**
     * 产品图册：媒体文件访问 URL
     * <img>/<video> 标签无法设置 Authorization 头，通过 query 参数传递 token（同订单缩略图方案）
     */
    getMediaFileUrl: (productId: string, mediaId: string) => {
      const token = getAuthToken()
      const url = `${API_BASE}/products/${productId}/media/${mediaId}/file`
      return token ? `${url}?token=${encodeURIComponent(token)}` : url
    },
  },
  quotes: {
    getAll: () => authFetch(`${API_BASE}/quotes`).then(handleResponse),
    getImageFlags: () => authFetch(`${API_BASE}/quotes/image-flags`).then(handleResponse),
    getThumbnailUrl: (id: string, version?: string) => {
      const token = getAuthToken()
      const url = `${API_BASE}/quotes/${id}/thumbnail`
      // <img> 标签无法设置 Authorization 头，通过 query 参数传递 token
      // version 参数（通常传 quote.updated_at）用于在图片更新后强制浏览器刷新缩略图
      const params = new URLSearchParams()
      if (token) params.set('token', token)
      if (version) params.set('_v', version)
      const qs = params.toString()
      return qs ? `${url}?${qs}` : url
    },
    getById: (id: string) => authFetch(`${API_BASE}/quotes/${id}`).then(handleResponse),
    /** 做货流程任务（v24 甘特图数据） */
    getProductionTasks: (id: string) => authFetch(`${API_BASE}/quotes/${id}/production-tasks`).then(handleResponse),
    /** 做货流程跟踪表：全部订单的任务总览（含订单摘要，做货跟踪页用） */
    getProductionTasksOverview: () => authFetch(`${API_BASE}/quotes/production-tasks/overview`).then(handleResponse),
    /** 整体同步做货流程任务（全量替换，事务） */
    saveProductionTasks: (id: string, tasks: unknown) => authFetch(`${API_BASE}/quotes/${id}/production-tasks`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ tasks }),
    }).then(handleResponse),
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
    copy: (id: string) => authFetch(`${API_BASE}/quotes/${id}/copy`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
    /** 订单对账管理（v28）：获取订单的对账工艺成本明细 */
    getReconciliationCosts: (id: string) => authFetch(`${API_BASE}/quotes/${id}/reconciliation-costs`).then(handleResponse),
    /** 订单对账管理（v28）：保存对账工艺成本明细（全量替换） */
    saveReconciliationCosts: (id: string, costs: unknown) => authFetch(`${API_BASE}/quotes/${id}/reconciliation-costs`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify({ costs }),
    }).then(handleResponse),
    /** 订单对账管理（v28）：确认对账（已发货已收款→已对账） */
    reconcileQuote: (id: string) => authFetch(`${API_BASE}/quotes/${id}/reconcile`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
    /** 订单对账管理（v28）：退回对账（已对账→已发货已收款） */
    unreconcileQuote: (id: string) => authFetch(`${API_BASE}/quotes/${id}/unreconcile`, {
      method: 'POST',
      headers: jsonHeaders,
    }).then(handleResponse),
  },
  /** 产品成本项配置（v31：成本项 → 可选工艺（多对一）+ 自定义字段） */
  productCostItems: {
    /** 全部成本项（组装树：含其下工艺与字段定义） */
    getAll: () => authFetch(`${API_BASE}/product-cost-items`).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/product-cost-items/${id}`).then(handleResponse),
    createItem: (data: { name: string }) => authFetch(`${API_BASE}/product-cost-items`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    updateItem: (id: string, data: { name: string }) => authFetch(`${API_BASE}/product-cost-items/${id}`, {
      method: 'PUT',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    deleteItem: (id: string) => authFetch(`${API_BASE}/product-cost-items/${id}`, { method: 'DELETE' }).then(handleResponse),
    deleteItemCheck: (id: string) => authFetch(`${API_BASE}/product-cost-items/${id}/delete-check`).then(handleResponse),
    /** 新增可选工艺：{ name, cost?, formula?, features?, remark?, customValues? } */
    createProcess: (itemId: string, data: unknown) => authFetch(`${API_BASE}/product-cost-items/${itemId}/processes`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    updateProcess: (itemId: string, processId: string, data: unknown) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/processes/${processId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(data),
      }).then(handleResponse),
    deleteProcess: (itemId: string, processId: string) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/processes/${processId}`, { method: 'DELETE' }).then(handleResponse),
    deleteProcessCheck: (itemId: string, processId: string) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/processes/${processId}/delete-check`).then(handleResponse),
    /** 手动排序可选工艺：{ processIds }（该成本项下全部工艺 id 的新顺序，整体重写序号） */
    reorderProcesses: (itemId: string, processIds: string[]) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/processes/reorder`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify({ processIds }),
      }).then(handleResponse),
    /** 新增自定义字段：{ name, fieldType?, options?, visible? } */
    createField: (itemId: string, data: unknown) => authFetch(`${API_BASE}/product-cost-items/${itemId}/fields`, {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify(data),
    }).then(handleResponse),
    updateField: (itemId: string, fieldId: string, data: unknown) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/fields/${fieldId}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(data),
      }).then(handleResponse),
    deleteField: (itemId: string, fieldId: string) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/fields/${fieldId}`, { method: 'DELETE' }).then(handleResponse),
    deleteFieldCheck: (itemId: string, fieldId: string) =>
      authFetch(`${API_BASE}/product-cost-items/${itemId}/fields/${fieldId}/delete-check`).then(handleResponse),
  },
  sheetTemplates: {
    /** 全部模板（一对多）；可选 styleCode 过滤该款式的全部模板 */
    getAll: (styleCode?: string) => authFetch(
      `${API_BASE}/sheet-templates${styleCode ? `?styleCode=${encodeURIComponent(styleCode)}` : ''}`
    ).then(handleResponse),
    getById: (id: string) => authFetch(`${API_BASE}/sheet-templates/${id}`).then(handleResponse),
    /** 新增模板：{ styleCode, name, data?, formulas? }，重名时后端返回 409 */
    create: (payload: { styleCode: string; name: string; data?: (string | number | null)[][]; formulas?: Record<string, string> }) =>
      authFetch(`${API_BASE}/sheet-templates`, {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      }).then(handleResponse),
    /** 更新模板：{ name?, data, formulas }，改名重名时后端返回 409 */
    update: (id: string, payload: { name?: string; data: (string | number | null)[][]; formulas: Record<string, string> }) =>
      authFetch(`${API_BASE}/sheet-templates/${id}`, {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(payload),
      }).then(handleResponse),
    delete: (id: string) => authFetch(`${API_BASE}/sheet-templates/${id}`, { method: 'DELETE' }).then(handleResponse),
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
    /**
     * 导出收款单（仅"已发货未收款"订单）
     * 30 秒超时；返回 { blob, filename }，filename 取自 X-Export-Filename 响应头
     * @throws {Error} error.timeout=true 表示超时；error.message 含服务端错误信息
     */
    paymentReceipts: async (orderIds: string[], customerFilter: string): Promise<{ blob: Blob; filename: string }> => {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30_000)
      try {
        const res = await authFetch(`${API_BASE}/export/payment-receipts`, {
          method: 'POST',
          headers: jsonHeaders,
          body: JSON.stringify({ orderIds, customerFilter }),
          signal: controller.signal,
        })
        if (!res.ok) {
          const text = await res.text()
          let msg = `导出失败 (${res.status})`
          let code: string | undefined
          try { const err = JSON.parse(text); msg = err.error || msg; code = err.code } catch { if (text) msg = text }
          const e = new Error(msg) as Error & { code?: string }
          e.code = code
          throw e
        }
        // 优先从 X-Export-Filename 头读取文件名（URL 编码），回退到 Content-Disposition
        const rawName = res.headers.get('X-Export-Filename')
        let filename = ''
        if (rawName) {
          try { filename = decodeURIComponent(rawName) } catch { filename = rawName }
        }
        if (!filename) {
          filename = `收款单_${new Date().toISOString().replace(/[-T:]/g, '').substring(0, 14)}.xlsx`
        }
        const blob = await res.blob()
        return { blob, filename }
      } catch (error) {
        // AbortError → 超时
        if (error instanceof DOMException && error.name === 'AbortError') {
          const e = new Error('导出超时，请尝试减少数据量后重试') as Error & { timeout?: boolean }
          e.timeout = true
          throw e
        }
        throw error
      } finally {
        clearTimeout(timeoutId)
      }
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
