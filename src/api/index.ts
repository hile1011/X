const API_BASE = '/api'

export const api = {
  orders: {
    getAll: () => fetch(`${API_BASE}/orders`).then(res => res.json()),
    getById: (id: string) => fetch(`${API_BASE}/orders/${id}`).then(res => res.json()),
    update: (id: string, data: unknown) => fetch(`${API_BASE}/orders/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    delete: (id: string) => fetch(`${API_BASE}/orders/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
  customers: {
    getAll: () => fetch(`${API_BASE}/customers`).then(res => res.json()),
    getById: (id: string) => fetch(`${API_BASE}/customers/${id}`).then(res => res.json()),
    create: (data: unknown) => fetch(`${API_BASE}/customers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    update: (id: string, data: unknown) => fetch(`${API_BASE}/customers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    delete: (id: string) => fetch(`${API_BASE}/customers/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
  products: {
    getAll: () => fetch(`${API_BASE}/products`).then(res => res.json()),
    getById: (id: string) => fetch(`${API_BASE}/products/${id}`).then(res => res.json()),
    create: (data: unknown) => fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    update: (id: string, data: unknown) => fetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    delete: (id: string) => fetch(`${API_BASE}/products/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
  tasks: {
    getAll: () => fetch(`${API_BASE}/tasks`).then(res => res.json()),
    getById: (id: string) => fetch(`${API_BASE}/tasks/${id}`).then(res => res.json()),
    create: (data: unknown) => fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    update: (id: string, data: unknown) => fetch(`${API_BASE}/tasks/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),
    delete: (id: string) => fetch(`${API_BASE}/tasks/${id}`, { method: 'DELETE' }).then(res => res.json()),
  },
}
