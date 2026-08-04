# 帆布袋报价跟单系统 — API 文档

> 版本：V0.2
> 日期：2026-07-31
> Base URL：`/api`（开发环境 Vite 代理到 `http://localhost:3001`）

---

## 1. 通用约定

### 1.1 响应格式

**成功响应**：返回 JSON 数据（数组或对象）

```json
{ "id": "quote-xxx", "quote_number": "客户-20260731-款式", "...": "..." }
```

**错误响应**：

```json
{ "error": "报价不存在", "message": "可选详细错误" }
```

| HTTP 状态码 | 说明 |
|---|---|
| 200 | 成功 |
| 400 | 参数错误 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

### 1.2 认证

> ⚠️ V0.2 版本 API 层**未实现 token 校验**，仅前端路由做登录守卫。后续版本需补充 JWT/Session 认证中间件。

---

## 2. 健康检查

### `GET /api/health`

返回服务健康状态。

**响应示例**：
```json
{ "status": "ok", "timestamp": "2026-07-31T08:00:00.000Z" }
```

---

## 3. 报价/订单（Quotes）

前缀：`/api/quotes`

### 3.1 获取全部报价

`GET /api/quotes`

**响应**：`Quote[]` — 全部报价/订单数组

### 3.2 获取单个报价

`GET /api/quotes/:id`

| 参数 | 类型 | 说明 |
|---|---|---|
| id | string | 报价 ID（`quote-xxx`） |

**响应**：`Quote` 对象；不存在返回 404 `{ "error": "报价不存在" }`

### 3.3 创建报价

`POST /api/quotes`

**请求体**（`OrderInfo` + 卖价 + 状态 + 图片）：
```typescript
{
  customerName: string,          // 必填
  shippingAddress?: string,
  productStyle?: string,         // '1'-'6'，默认 '1'
  productSpec?: string,
  fabricMaterial?: string,
  process?: string,
  handleMaterial?: string,
  handleSpec?: string,
  quantity?: string,
  boxSpec?: string,
  remark?: string,
  sampleFee?: string,
  sampleDays?: string,
  massDays?: string,
  unitPrice?: string,
  productionTimeStart?: string,
  productionTimeEnd?: string,
  sellPriceNoTax?: number,       // 不含税卖价
  sellPriceWithTax?: number,     // 含税卖价
  costPrice?: number,            // V0.2 新增，成本价
  images?: string[],             // 图片 URL 数组
}
```

**响应**：创建后的 `Quote` 对象（含 `id`、`quote_number`、`status=1`、`quoteTime`）

### 3.4 更新报价

`PUT /api/quotes/:id`

请求体同创建。**响应**：更新后的 `Quote`；不存在返回 404。

### 3.5 删除报价

`DELETE /api/quotes/:id`

**响应**：
```json
{ "message": "报价已删除" }
```
不存在返回 404。

### 3.6 进入下一节点

`POST /api/quotes/:id/next-status`

触发状态机前进：`1→2→3→4→5→6`，自动记录对应时间（sampleTime / productionStartTime / shippingTime / paymentTime / endTime）。

**响应**：更新后的 `Quote`；状态为 6 时无变化。

### 3.7 退回上一节点

`POST /api/quotes/:id/prev-status`

触发状态机后退：`6→5→4→3→2→1`，不清除时间戳。

**响应**：更新后的 `Quote`；状态为 1 时无变化。

### 3.8 直接结束

`POST /api/quotes/:id/end`

仅状态为 1（报价中）或 2（打样中）时有效，直接跳到状态 6（结束）并记录 `endTime`。

**响应**：更新后的 `Quote`；状态 3/4/5 调用保持原状态。

---

## 4. 客户（Customers）

前缀：`/api/customers`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/customers` | 获取全部客户 |
| GET | `/api/customers/:id` | 获取单个客户 |
| GET | `/api/customers/name/:name` | 按名称查找客户（不存在返回 `null`） |
| POST | `/api/customers` | 创建客户 |
| PUT | `/api/customers/:id` | 更新客户 |
| DELETE | `/api/customers/:id` | 删除客户 |

**Customer 对象**：
```typescript
{
  id: string,              // cust-xxx
  name: string,            // 必填
  contact_person?: string,
  phone?: string,
  email?: string,
  address?: string,
  industry?: string,
  created_at: string,
  updated_at: string,
}
```

---

## 5. 产品（Products）

前缀：`/api/products`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/products` | 获取全部产品 |
| GET | `/api/products/:id` | 获取单个产品 |
| POST | `/api/products` | 创建产品 |
| PUT | `/api/products/:id` | 更新产品 |
| DELETE | `/api/products/:id` | 删除产品 |

---

## 6. 订单（Orders）

前缀：`/api/orders`

> 说明：V0.2 核心业务走 `quotes` 表，`orders` 表为保留结构，前端无独立页面。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/orders` | 获取全部订单 |
| GET | `/api/orders/:id` | 获取单个订单（含 order_items） |
| PUT | `/api/orders/:id` | 更新订单状态等 |
| DELETE | `/api/orders/:id` | 删除订单 |

---

## 7. 跟单任务（Tasks）

前缀：`/api/tasks`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/tasks` | 获取全部任务 |
| GET | `/api/tasks/:id` | 获取单个任务 |
| POST | `/api/tasks` | 创建任务 |
| PUT | `/api/tasks/:id` | 更新任务 |
| DELETE | `/api/tasks/:id` | 删除任务 |

**Task 对象关键字段**：
- `title`（必填）：任务标题
- `status`：`pending` / `in_progress` / `completed`
- `due_date`：截止日期
- `order_id`：关联订单 ID（逻辑关联）

---

## 8. 工艺成本（Process Costs）

前缀：`/api/process-costs`

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/process-costs` | 获取全部工艺成本 |
| GET | `/api/process-costs/:id` | 获取单个 |
| POST | `/api/process-costs` | 创建（name 必填，cost 默认为 0） |
| PUT | `/api/process-costs/:id` | 更新 |
| DELETE | `/api/process-costs/:id` | 删除 |

---

## 9. 报价试算计算

### `POST /api/bag-quote/calculate`

纯计算接口，不写入数据库。接收帆布袋规格参数，返回成本与卖价。

**请求体**：
```typescript
{
  quantity: number,
  width: number,
  height: number,
  bottom: number,
  // ... 其他 BagQuoteInput 参数
}
```

**响应**：`BagQuoteOutput`（unitCost、refPriceNoTax、refPriceWithTax、unitProfit、totalProfit 等）

---

## 10. 文件上传 / Excel 导入

前缀：`/api/upload`

### 10.1 图片上传

`POST /api/upload/image`（multipart/form-data，字段名：`file`）

**响应**：`{ url: string }` — 图片 URL

### 10.2 Excel 导入订单

`POST /api/upload/excel`（multipart/form-data，字段名：`file`）

解析上传的 Excel 文件，批量导入订单数据。

---

## 11. 订单 Excel 导出

前缀：`/api/export`

### 11.1 按模板导出报价试算表

`GET /api/export/quote/:id`

根据订单 ID 和款式模板，生成 Excel 报价试算表并下载。

**响应**：`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

文件名格式：`{quote_number}-报价单.xlsx`

---

## 12. 错误处理

所有路由通过 `asyncHandler` 包装，异常统一返回 500：

```json
{ "error": "服务器内部错误", "message": "原始错误信息" }
```

开发调试：查看后端终端日志 `[Server] 路由错误: ...`。
