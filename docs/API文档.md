# 帆布袋报价跟单系统 — API 文档

> 版本：v1.2.x
> 日期：2026-09-10
> Base URL：`/api`（开发环境 Vite 代理到 `http://localhost:3001`，生产环境 PM2 端口 3003）
> 认证方式：JWT（Bearer Token）

---

## 1. 通用约定

### 1.1 认证（JWT 双 Token）

除 `POST /api/auth/login`、`POST /api/auth/refresh`、`GET /api/health` 外，**所有接口均需认证**。请求头携带：

```
Authorization: Bearer <accessToken>
```

| Token | 有效期 | 用途 |
|---|---|---|
| accessToken | 15 分钟（可经 `JWT_ACCESS_EXPIRES_IN` 配置） | 接口访问凭证 |
| refreshToken | 7 天 | accessToken 过期后换取新 accessToken |

- accessToken 过期返回 `401`，前端应调用 `POST /api/auth/refresh` 续期后重试。
- 未认证访问返回 `401 { "error": "未认证" }`。

### 1.2 权限（RBAC）

部分接口额外要求权限码（`requirePermission` 中间件），用户无权限时返回 `403`：

```json
{ "error": "无操作权限", "required": "quotes:export" }
```

权限码格式为 `模块:动作`（如 `quotes:view`、`users:edit`），由角色（roles）聚合分配，详见 `GET /api/permissions`。

### 1.3 响应格式

**成功响应**：返回 JSON 数据（数组或对象），或文件流（导出接口）。

**错误响应**：

```json
{ "error": "报价不存在", "message": "可选详细错误" }
```

| HTTP 状态码 | 说明 |
|---|---|
| 200 / 201 | 成功 |
| 400 | 参数错误 |
| 401 | 未认证 / token 无效 |
| 403 | 无权限 / 账号禁用 |
| 404 | 资源不存在 |
| 429 | 限流（收款单导出） |
| 500 | 服务器内部错误 |

### 1.4 订单状态枚举

| 值 | 标签 | 说明 |
|---|---|---|
| 1 | 报价中 | 初始状态 |
| 2 | 打样中 | 记录 sampleTime |
| 7 | 打样完成 | 记录 sampleCompletedTime |
| 3 | 做货中 | 记录 productionStartTime |
| 4 | 已发货未收款 | 记录 shippingTime |
| 5 | 已发货已收款 | 记录 paymentTime |
| 8 | 已对账 | 记录 reconciledTime（仅经订单对账管理进入，终态） |
| 6 | 结束 | 仅可从 1/2/7 直接结束（endQuote） |

**流转规则**：`1→2→7→3→4→5`（nextStatus 逐级前进）；`5→8` 仅经 `POST /api/quotes/:id/reconcile`；`8→5` 仅经 `POST /api/quotes/:id/unreconcile`；状态 5 和 8 不允许直接调整为结束。

---

## 2. 健康检查

### `GET /api/health`

公开接口，返回服务健康状态。

```json
{ "status": "ok", "timestamp": "2026-09-10T08:00:00.000Z" }
```

---

## 3. 认证 `/api/auth`

### 3.1 登录

`POST /api/auth/login`（公开）

**请求体**：

```json
{ "email": "517290808@qq.com", "password": "123456" }
```

**响应**：

```json
{
  "accessToken": "eyJhbGci...",
  "refreshToken": "eyJhbGci...",
  "expiresIn": 900,
  "user": { "id": "user-admin-default", "email": "...", "name": "管理员", "roles": ["admin"], "permissions": ["quotes:view", "..."] }
}
```

**错误**：`400` 缺少参数 / `401` 邮箱或密码错误 / `403` 账号被禁用。

### 3.2 获取当前用户

`GET /api/auth/me`（需认证）

刷新页面后恢复登录态。返回 `{ id, email, name, phone, roles, permissions }`。

### 3.3 刷新 Token

`POST /api/auth/refresh`（公开）

**请求体**：`{ "refreshToken": "eyJhbGci..." }`

**响应**：`{ "accessToken": "...", "expiresIn": 900 }`

**错误**：`401` 未提供/无效 refresh token，`403` 账号不可用。

### 3.4 登出

`POST /api/auth/logout`（需认证）

Stateless JWT，前端清除本地 token 即可，接口保留供扩展。返回 `{ "message": "已登出" }`。

### 3.5 修改密码

`PUT /api/auth/password`（需认证）

**请求体**：`{ "oldPassword": "...", "newPassword": "..." }`（新密码 ≥ 6 位）

**错误**：`400` 旧密码错误或新密码过短。

---

## 4. 报价/订单 `/api/quotes`（核心业务）

> 权限码前缀 `quotes:`。订单号为 16 位随机数字（`quote_number`），创建后不随客户/款式变化，复制订单生成新订单号。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/quotes` | `quotes:view` | 全部订单（含 tableData 等大字段） |
| GET | `/api/quotes/image-flags` | `quotes:view` | 图片存在标记（id → boolean，轻量） |
| GET | `/api/quotes/:id` | `quotes:view` | 订单详情 |
| GET | `/api/quotes/:id/delete-check` | `quotes:delete` | 删除前关联检查 |
| POST | `/api/quotes` | `quotes:create` | 创建订单（body 为 Quote 字段） |
| PUT | `/api/quotes/:id` | `quotes:edit` | 更新订单（局部更新，未传字段不清空） |
| DELETE | `/api/quotes/:id` | `quotes:delete` | 受保护删除（有关联时 409） |
| POST | `/api/quotes/:id/copy` | `quotes:copy` | 复制订单（新订单号，操作人记录） |
| POST | `/api/quotes/:id/next-status` | `quotes:status-transition` | 流转到下一状态（见 1.4 规则） |
| POST | `/api/quotes/:id/prev-status` | `quotes:status-transition` | 退回上一状态（6→5 允许；8 不可退） |
| POST | `/api/quotes/:id/end` | `quotes:status-transition` | 直接结束（仅 1/2/7 可进入 6） |

**Quote 核心字段**：`id`、`quote_number`（16 位数字）、`customerName`、`status`（见 1.4）、`productStyle`、`quantity`、四价格字段（`costPrice`/`priceWithTax`/`sellPriceNoTax`/`sellPriceWithTax`）、`tableData`/`allFormulas`/`modifiedFormulas`（JSON 在线表格快照）、`images`（base64 data URI 数组）、各时间戳（`sampleTime`/`sampleCompletedTime`/`productionStartTime`/`shippingTime`/`paymentTime`/`reconciledTime`/`endTime`）、`pendingAmount`（待收总额，状态 3/4 时计算）。

**布料米数向上取整（v33）**：`POST /api/quotes` 与 `PUT /api/quotes/:id` 保存订单时，后端对 `tableData` 中**布料米数列**（表头含「布料米数」，默认 M 列，定位失败回退 col=12）的数值执行**向上取整**（标准数学 ceil：`1.1→2`、`0.1→1`、`-1.1→-2`；非有限数字跳过），并对 `allFormulas` 中该列公式整体包裹 `CEILING(...,1)`（幂等，已包裹跳过）。前端保存前已做同口径处理，后端为兜底保障——入库数据必为取整值。取整变更（地址、原值→取整值）写入 `operation_logs` 审计日志（`operation_type = 'fabric-meters-ceil'`，审计失败不阻断保存）。局部更新（如仅改状态）不携带 `tableData` 时不受影响。存量订单与模板由迁移 v33 批量规范化（变更明细存 `fabric_meters_ceil_audit` 审计表，down 可逆还原）。

### 4.1 订单对账管理（v28）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/quotes/:id/reconciliation-costs` | `quotes:view` | 对账工艺成本明细列表 |
| PUT | `/api/quotes/:id/reconciliation-costs` | `quotes:edit` | 保存工艺成本明细（全量替换，事务） |
| POST | `/api/quotes/:id/reconcile` | `quotes:status-transition` | 确认对账：5→8，记录 reconciledTime |
| POST | `/api/quotes/:id/unreconcile` | `quotes:status-transition` | 退回对账：8→5 |

**PUT reconciliation-costs 请求体**：

```json
{
  "costs": [
    { "name": "丝印", "unitPrice": 0.5, "quantity": 1000, "cost": 500, "remark": "" }
  ]
}
```

校验规则：`costs` 必须为数组（≤100 条）；`name` 必填（≤128 字符）；`unitPrice`/`quantity` 可选但必须为数字；`cost` 必填且为非负数字；`remark` ≤500 字符。

### 4.2 做货流程任务（v24 甘特图数据）

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/quotes/production-tasks/overview` | `quotes:view` | 全部订单任务总览（JOIN 订单摘要：订单号/客户/数量/状态） |
| GET | `/api/quotes/:id/production-tasks` | `quotes:view` | 单订单任务列表 |
| PUT | `/api/quotes/:id/production-tasks` | `quotes:edit` | 整体同步任务（全量替换，事务，拖拽排期同步用） |

**PUT production-tasks 请求体**：

```json
{
  "tasks": [
    { "name": "面料采购", "planStart": "2026-09-01", "planEnd": "2026-09-05", "actualStart": null, "actualEnd": null, "status": 0, "remark": "", "materials": [{ "name": "帆布" }] }
  ]
}
```

校验规则：`tasks` 数组（≤50 条）；`name` 必填（≤64 字符）；日期字段格式 `YYYY-MM-DD`；`remark` ≤255 字符；`materials` 数组（≤50 项，`name` 必填）。

---

## 5. 订单 `/api/orders`

旧版订单表接口（与 quotes 核心订单区分，仅认证无权限码）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/orders` | 全部订单 |
| GET | `/api/orders/:id` | 订单详情 |
| PUT | `/api/orders/:id` | 更新（body：`status`、`remarks`，均可选） |
| GET | `/api/orders/:id/delete-check` | 删除前关联检查 |
| DELETE | `/api/orders/:id` | 受保护删除 |

---

## 6. 客户 `/api/customers`

仅认证，无权限码。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/customers` | 全部客户 |
| GET | `/api/customers/:id` | 客户详情 |
| GET | `/api/customers/name/:name` | 按名称查找（name 需 URL 编码） |
| POST | `/api/customers` | 创建客户 |
| PUT | `/api/customers/:id` | 更新（局部更新） |
| GET | `/api/customers/:id/delete-check` | 删除前关联检查（有报价单时 409） |
| DELETE | `/api/customers/:id` | 受保护删除 |

**客户字段**：`name`（必填）、`contact_person`、`phone`、`email`、`address`、`industry`、`tags`、`remark`。

---

## 7. 产品 `/api/products`

仅认证，无权限码。产品管理模块，同时作为款式数据源（`code` 字段匹配订单款式 1-6 或自定义编码/产品 id）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/products` | 全部产品（含 `code` 字段） |
| GET | `/api/products/:id` | 产品详情 |
| POST | `/api/products` | 创建产品 |
| PUT | `/api/products/:id` | 更新产品 |
| GET | `/api/products/:id/delete-check` | 删除前关联检查（被订单引用时 409） |
| DELETE | `/api/products/:id` | 受保护删除 |

---

## 8. 工艺成本 `/api/process-costs`

仅认证，无权限码。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/process-costs` | 全部工艺成本 |
| GET | `/api/process-costs/:id` | 详情 |
| POST | `/api/process-costs` | 创建 |
| PUT | `/api/process-costs/:id` | 更新 |
| GET | `/api/process-costs/:id/delete-check` | 删除前关联检查 |
| DELETE | `/api/process-costs/:id` | 受保护删除 |

---

## 9. 款式模板 `/api/sheet-templates`

同款式内模板名称唯一（`uk_style_name(style_code, name)`）。款式编码动态校验：新增产品即成为可选款式（按 `products.code` 或 `products.id` 匹配）。

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/sheet-templates` | 仅认证 | 模板列表；`?styleCode=` 过滤（空值 400） |
| GET | `/api/sheet-templates/:id` | 仅认证 | 模板详情 |
| POST | `/api/sheet-templates` | `sheet-templates:edit` | 新增模板（`styleCode`/`name`/`data`/`formulas`） |
| PUT | `/api/sheet-templates/:id` | `sheet-templates:edit` | 更新模板 |
| DELETE | `/api/sheet-templates/:id` | `sheet-templates:edit` | 删除模板 |

**POST/PUT 请求体**：

```json
{
  "styleCode": "1",
  "name": "默认模板",
  "data": [[null, "数量 (个)"], ["成品", 7200]],
  "formulas": { "B3": "=B2" }
}
```

校验：`data` 必须为非空二维数组；`formulas` 必须为对象；`styleCode` 必须对应存在的产品（400 引导到产品管理）；读取接口仅需认证（订单编辑页需加载模板）。

**布料米数向上取整（v33）**：`POST /api/sheet-templates` 与 `PUT /api/sheet-templates/:id` 保存模板时，对 `data` 布料米数列数值向上取整、`formulas` 该列公式包裹 `CEILING(...,1)`，规则与订单接口一致（见第 4 节「布料米数向上取整」），变更同样写入 `operation_logs` 审计日志。

---

## 10. 报价计算 `/api/bag-quote`

仅认证，无权限码。帆布袋报价试算引擎（前后端共用同一计算逻辑）。

### 10.1 计算

`POST /api/bag-quote/calculate`

**请求体**（`BagQuoteInput`，未传字段取默认值）：

```json
{
  "quantity": 7200, "width": 38, "height": 40, "bottom": 0,
  "frontBackRows": [{ "label": "正反面", "widthBleed": 3, "heightBleed": 10, "...": "..." }],
  "handleWidth": 2.5, "handleHeight": 70, "...": "...",
  "profitRate": 0.15, "taxRate": 1.1
}
```

必填：`quantity`、`width`、`height`、`frontBackRows`（非空数组）。

**响应**：`{ "success": true, "result": { "specTable": [...], "costTable": [...], "summary": { "unitCost", "refPriceNoTax", "refPriceWithTax", "totalProfit", "unitProfit", "totalUnitGramWeight" } } }`

### 10.2 默认参数

`GET /api/bag-quote/defaults` — 返回 `{ "success": true, "defaults": {...} }`。

---

## 11. 导出 `/api/export`

### 11.1 订单列表导出

`POST /api/export/orders`（仅认证）

**请求体**：`{ "orderIds": ["id1", "id2"] }` — 空数组或省略时导出全部订单。

**响应**：Excel 文件流（订单明细 + 汇总统计双工作表；状态/款式标签、双口径价格与利润、图片计数）。**错误**：`400` 无可导出订单。

### 11.2 单订单含在线表格导出

`POST /api/export/order-with-table`（仅认证）

**请求体**：

```json
{
  "orderId": "quote-xxx",
  "tableData": { "data": [[...]], "formulas": { "K9": "=J9*1.1" } }
}
```

**响应**：Excel 文件流（订单信息 + 在线表格，公式保留，打开自动重算）。**错误**：`400` 缺参 / `404` 订单不存在。

### 11.3 收款单导出

`POST /api/export/payment-receipts`（权限 `quotes:export-payment`，限流：同一用户 5 分钟最多 3 次，超出 429）

**请求体**：`{ "orderIds": ["..."], "customerFilter": "" }` — 仅导出"已发货未收款"(status=4) 订单（服务端权威过滤）。

**响应**：单客户 → Excel 文件流；多客户 → ZIP 文件流（每客户一个 Excel）。

**错误**：`400` 无符合条件订单 / 单次超 1000 条（`code: "TOO_MANY_ROWS"`）。

---

## 12. 操作日志 `/api/operation-logs`

仅认证，无权限码。删除等关键操作的审计记录。

### `GET /api/operation-logs?limit=50&offset=0&entityType=&result=`

| 参数 | 说明 |
|---|---|
| `limit` | 每页条数（默认 50） |
| `offset` | 偏移量（默认 0） |
| `entityType` | 实体类型过滤（quote/customer/product/order/process_cost） |
| `result` | 操作结果过滤（success/blocked） |

**响应**：`{ "data": [...], "total": n }`（含操作人、IP、实体信息、关联详情）。

---

## 13. 用户管理 `/api/users`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/users` | `users:view` | 用户列表（含角色数组） |
| GET | `/api/users/:id` | `users:view` | 用户详情（含角色） |
| POST | `/api/users` | `users:create` | 创建用户（`email`/`name`/`phone`/`password`/`roleIds[]`） |
| PUT | `/api/users/:id` | `users:edit` | 编辑用户（`name`/`phone`/`status`/`roleIds[]`） |
| PUT | `/api/users/:id/password` | `users:edit` | 重置密码 |
| DELETE | `/api/users/:id` | `users:delete` | 删除用户 |

创建用户 email 唯一（重复 400）；角色变更自动失效权限缓存。

---

## 14. 角色管理 `/api/roles`

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/roles` | `roles:view` | 角色列表（含权限数/用户数） |
| GET | `/api/roles/:id` | `roles:view` | 角色详情（含权限码列表） |
| POST | `/api/roles` | `roles:create` | 创建角色（`name`/`code`/`description`/`permissionIds[]`） |
| PUT | `/api/roles/:id` | `roles:edit` | 编辑角色（含权限重新分配） |
| DELETE | `/api/roles/:id` | `roles:delete` | 删除角色（系统内置角色 `is_system=1` 拒绝删除） |

---

## 15. 权限目录 `/api/permissions`

### `GET /api/permissions`（需认证）

返回全部权限目录，按 `module` 分组、`sort_order` 排序，供角色管理界面勾选：

```json
{
  "dashboard": [{ "id": "perm-dashboard-view", "code": "dashboard:view", "name": "工作台", "type": "menu", "...": "..." }],
  "quotes": ["..."]
}
```

---

## 16. 文件上传 `/api/upload`

### 16.1 Excel 导入

`POST /api/upload/excel`（仅认证，multipart/form-data，字段名 `file`）

导入 Excel 解析为在线表格数据。

### 16.2 Excel 导入预览

`POST /api/upload/excel/preview`（仅认证，multipart/form-data，字段名 `file`）

预览模式，不入库。

> 产品图片不走上传接口：前端压缩为 base64 data URI 后直接存入 `quotes.images` 字段。

---

## 17. 删除保护机制（通用）

各资源的 `GET /:id/delete-check` 与 `DELETE /:id` 行为一致：

1. **预检查**（delete-check）：返回 `{ canDelete: boolean, entityInfo: { type, name, details }, blockers: [...] }`，前端展示关联详情。
2. **受保护删除**（DELETE）：存在阻断性关联时返回 `409 { error, blockers }`，不执行删除；删除成功记录操作日志（含操作人 `X-Operator` 头与客户端 IP）。
