# VTable 复制功能在 HTTP（非安全上下文）下失效的 Bug 报告

## 环境信息

| 项目 | 版本 |
|---|---|
| `@visactor/vtable` | 1.26.6 |
| `@visactor/vtable-sheet` | 1.26.6 |
| 浏览器 | Chrome 120+ / Edge 120+（任意非 Safari 浏览器） |
| 部署环境 | **HTTP**（非 HTTPS，非 localhost） |

## 问题概述

在 HTTP 环境下（非安全上下文），VTable 的复制功能（Ctrl+C）**静默失败**——剪贴板中没有写入任何内容。这是因为 `handleCopy` 是 async 函数，内部有 `yield setTimeout(10)` 异步等待，导致 fallback 路径中的 `e.clipboardData.setData()` 和 `document.execCommand('copy')` 都失效。

## 复现步骤

### 方式一：使用附带的复现 demo

1. 将附带的 `vtable-bug-repro.html` 放到任意 HTTP 服务器上（**不能用 HTTPS，不能用 localhost**）
   ```bash
   # 示例：用 python 起一个 HTTP 服务，然后通过 IP 访问（非 localhost）
   python3 -m http.server 8080
   # 浏览器访问 http://<本机IP>:8080/vtable-bug-repro.html
   ```
2. 在页面的表格中，点击任意一个单元格选中
3. 按 Ctrl+C
4. 到任意文本框中按 Ctrl+V 粘贴

### 方式二：任意使用 VTable 的 HTTP 部署

1. 在 HTTP 环境（非 HTTPS、非 localhost）下部署任意使用 VTable 的页面
2. 选中表格中的单元格
3. 按 Ctrl+C 复制
4. 粘贴到其他地方

## 预期行为

剪贴板中应包含选中单元格的值。

## 实际行为

剪贴板为空（或包含之前的内容），复制静默失败，无任何错误提示。

> **注意**：在 HTTPS 或 localhost 下一切正常，因为安全上下文下 `navigator.clipboard` 可用，走的是另一条代码路径。

## 根因分析

### 1. `handleCopy` 是 async 函数，含 `yield setTimeout(10)`

源码位置：`@visactor/vtable/es/event/event.js` 第 294-352 行

```javascript
handleCopy(e, isCut = !1) {
    return __awaiter(this, void 0, void 0, (function*() {
        // ...
        const data = this.table.getCopyValue(/* ... */);
        if (isValid(data)) {
            e.preventDefault();
            const element = table.getElement();
            // ↓↓↓ 关键问题：这里 yield setTimeout(10) 是异步等待 ↓↓↓
            element && element !== document.activeElement && (
                element.focus(),
                yield new Promise((resolve => setTimeout(resolve, 10)))
            );
            try {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    // HTTPS 路径：navigator.clipboard 可用，走这里（正常）
                    // ...
                } else {
                    // HTTP 路径：navigator.clipboard 不可用，走 fallback
                    this.fallbackCopyToClipboard(data, e);
                }
            } catch (error) {
                this.fallbackCopyToClipboard(data, e);
            }
        }
    }));
}
```

### 2. fallback 中 `e.clipboardData.setData()` 在 async 之后已失效

源码位置：`@visactor/vtable/es/event/event.js` 第 353-368 行

```javascript
fallbackCopyToClipboard(data, e) {
    try {
        // ↓↓↓ 这里 e.clipboardData 在同步事件分发期间才可写 ↓↓↓
        // 但 fallbackCopyToClipboard 是在 yield setTimeout(10) 之后被调用的
        // 此时 copy 事件已经结束分发，e.clipboardData.setData() 是空操作
        if (e.clipboardData) return void e.clipboardData.setData("text/plain", data);

        // ↓↓↓ execCommand('copy') 也因为失去用户手势上下文而失败 ↓↓↓
        const textArea = document.createElement("textarea");
        // ...
        document.execCommand("copy");  // 失败，无异常
    } catch (error) {}
}
```

### 3. 双重失败：`preventDefault()` 同步执行，但 `setData()` 异步失效

完整的失败链路：

```
copy 事件触发
  → handleCopy(async) 同步部分执行
    → e.preventDefault()              ✅ 同步调用，阻止了浏览器默认复制
    → yield setTimeout(10)            ⏸️ 异步等待，控制权交还事件循环
  → copy 事件分发结束                  ← 此时 e.clipboardData 已"脱钩"
  → (10ms 后) async 恢复
    → fallbackCopyToClipboard(data, e)
      → if (e.clipboardData)          ← e.clipboardData 仍然存在（属性不会消失）
        → e.clipboardData.setData()   ❌ 空操作（事件已结束，setData 不再写入）
        → return void                 ← 直接返回，不会走到 execCommand 分支
      → (execCommand 分支永远到不了)
```

**结果**：`preventDefault()` 阻止了浏览器默认复制，但 `setData()` 又是空操作 → 剪贴板中什么都没有。这是"双重失败"：默认行为被阻止，自定义写入也失败。

### 4. 为什么 HTTPS 正常、HTTP 不正常

| 环境 | `navigator.clipboard` | 走哪条路径 | 结果 |
|---|---|---|---|
| HTTPS / localhost | ✅ 可用 | `navigator.clipboard.write()` | 正常（async 路径可用 `navigator.clipboard` API） |
| HTTP（非 localhost） | ❌ 不可用 | `fallbackCopyToClipboard()` | **失败**（`clipboardData.setData` 空操作 + `execCommand` 分支到不了） |

浏览器规范要求：
- `ClipboardEvent.clipboardData` 的 `setData()` 只在事件**同步分发期间**有效，`await` 之后调用是空操作
- `document.execCommand('copy')` 必须在**用户手势（user gesture）的同步调用栈**中执行，`await` 之后手势上下文已丢失

## 建议修复方案

### 方案 A（推荐）：同步路径优先

在 `handleCopy` 中，**在 `yield setTimeout` 之前**，先检测 `navigator.clipboard` 是否可用。如果不可用，立即同步调用 `e.clipboardData.setData()`：

```javascript
handleCopy(e, isCut = !1) {
    return __awaiter(this, void 0, void 0, (function*() {
        // ...
        const data = this.table.getCopyValue(/* ... */);
        if (isValid(data)) {
            e.preventDefault();

            // ✅ 修复：非安全上下文下，同步写入 e.clipboardData
            // 此时还在 copy 事件的同步分发期间，clipboardData 可写
            if (!navigator.clipboard || !navigator.clipboard.writeText || typeof ClipboardItem === 'undefined') {
                if (e.clipboardData) {
                    e.clipboardData.setData('text/plain', data);
                    // 如果有 html 模式，也写 text/html
                    return;
                }
            }

            // 安全上下文：原有的 async 路径
            const element = table.getElement();
            element && element !== document.activeElement && (
                element.focus(),
                yield new Promise((resolve => setTimeout(resolve, 10)))
            );
            // ... 原有逻辑
        }
    }));
}
```

### 方案 B：将 `element.focus()` 改为同步

如果 `element.focus()` 的目的是让表格元素获得焦点，可以考虑用同步方式处理，去掉 `yield setTimeout(10)`，使得后续的 `e.clipboardData.setData()` 和 `execCommand('copy')` 仍在用户手势上下文中。

## 补充问题：VTable-Sheet 默认不配置 `getCopyCellValue.value`

### 问题描述

VTable-Sheet 默认只配置了 `keyboardOptions.getCopyCellValue.html`（HTML 模式带公式），未配置 `.value`。导致纯文本模式（`text/plain`）复制时，公式单元格复制的是计算后的值（如 `0.00`），而不是公式字符串（如 `=B6*F6`）。

### 源码位置

`handleCopy` 第 307 行：

```javascript
const data = this.table.getCopyValue(
    null === (_b = ... keyboardOptions) ... getCopyCellValue) ... .value
);
// VTable-Sheet 默认 getCopyCellValue 只有 .html，没有 .value
// 所以这里传入 undefined，getCopyValue 走默认的 getCellValue，返回计算值而非公式
```

### 建议

VTable-Sheet 初始化时，默认将 `getCopyCellValue.value` 也设为与 `.html` 相同的 `getCellValueConsiderFormula` 逻辑（公式单元格返回公式字符串），让纯文本复制也能保留公式。

## 附带文件

- `vtable-bug-repro.html`：最小复现 demo（需通过 HTTP 非 localhost 访问）
