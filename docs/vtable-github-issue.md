## 问题描述

在 HTTP（非安全上下文）环境下，VTable 的复制功能（Ctrl+C）**静默失败**——剪贴板中没有写入任何内容。HTTPS / localhost 下一切正常。

## 环境信息

- `@visactor/vtable`: 1.26.6
- `@visactor/vtable-sheet`: 1.26.6
- 浏览器: Chrome 120+ / Edge 120+
- 部署环境: **HTTP**（非 HTTPS，非 localhost）

## 复现步骤

1. 将以下最小 demo 部署到 HTTP 服务器（**不能用 HTTPS，不能用 localhost**，需通过 IP 访问）：

```html
<!DOCTYPE html>
<html>
<head>
  <script src="https://cdn.jsdelivr.net/npm/@visactor/vtable@1.26.6/dist/vtable.min.js"></script>
</head>
<body>
  <div id="tableContainer" style="height:300px;"></div>
  <textarea placeholder="粘贴测试区"></textarea>
  <script>
    // 环境检测：确认 isSecureContext === false
    console.log('isSecureContext:', window.isSecureContext);
    console.log('navigator.clipboard:', navigator.clipboard);

    const table = new VTable.ListTable(document.getElementById('tableContainer'), {
      records: [
        { name: 'A', price: 10, qty: 5 },
        { name: 'B', price: 20, qty: 3 },
      ],
      columns: [
        { field: 'name', title: '名称', width: 120 },
        { field: 'price', title: '单价', width: 100 },
        { field: 'qty', title: '数量', width: 100 },
      ],
      keyboardOptions: { copySelected: true },
    });
  </script>
</body>
</html>
```

2. 通过 `http://<本机IP>:8080/` 访问（非 localhost）
3. 选中表格中任意单元格
4. 按 Ctrl+C
5. 在文本框中 Ctrl+V 粘贴

## 预期行为

剪贴板中包含选中单元格的值。

## 实际行为

剪贴板为空，复制静默失败。**HTTPS / localhost 下正常**。

## 根因分析

### 1. `handleCopy` 是 async 函数，含 `yield setTimeout(10)`

源码位置：`es/event/event.js` 第 294-352 行

```javascript
handleCopy(e, isCut = !1) {
    return __awaiter(this, void 0, void 0, (function*() {
        // ...
        e.preventDefault();
        // ↓↓↓ 关键：yield setTimeout(10) 是异步等待 ↓↓↓
        element && element !== document.activeElement && (
            element.focus(),
            yield new Promise((resolve => setTimeout(resolve, 10)))
        );
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                // HTTPS 路径：正常
            } else {
                // HTTP 路径：走 fallback
                this.fallbackCopyToClipboard(data, e);
            }
        } catch (error) {
            this.fallbackCopyToClipboard(data, e);
        }
    }));
}
```

### 2. fallback 中 `e.clipboardData.setData()` 在 async 之后已失效

源码位置：`es/event/event.js` 第 353-368 行

```javascript
fallbackCopyToClipboard(data, e) {
    try {
        // e.clipboardData 仍然存在（属性不会消失），但 setData() 是空操作
        // 因为 copy 事件分发已在 yield setTimeout 后结束
        if (e.clipboardData) return void e.clipboardData.setData("text/plain", data);
        // execCommand 分支永远到不了（上面 return void 了）
        document.execCommand("copy");
    } catch (error) {}
}
```

### 3. 双重失败链路

```
copy 事件触发
  → handleCopy 同步部分: e.preventDefault()     ✅ 阻止了浏览器默认复制
  → yield setTimeout(10)                        ⏸️ 异步等待
  → copy 事件分发结束                            ← e.clipboardData 已"脱钩"
  → (10ms 后) fallbackCopyToClipboard()
    → e.clipboardData.setData()                 ❌ 空操作
    → return void                               ← execCommand 分支到不了
```

**结果**：`preventDefault()` 阻止了浏览器默认复制，`setData()` 又是空操作 → 剪贴板中什么都没有。

## 建议修复方案

在 `handleCopy` 中，**在 `yield setTimeout` 之前**检测 `navigator.clipboard` 是否可用。如果不可用，立即同步调用 `e.clipboardData.setData()`（此时还在 copy 事件同步分发期间，clipboardData 可写）：

```javascript
handleCopy(e, isCut = !1) {
    return __awaiter(this, void 0, void 0, (function*() {
        // ...
        const data = this.table.getCopyValue(/* ... */);
        if (isValid(data)) {
            e.preventDefault();

            // ✅ 修复：非安全上下文下，同步写入 e.clipboardData
            if (!navigator.clipboard || !navigator.clipboard.writeText || typeof ClipboardItem === 'undefined') {
                if (e.clipboardData) {
                    e.clipboardData.setData('text/plain', data);
                    return;  // 同步完成，不走 async 路径
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

## 补充问题：VTable-Sheet 默认不配置 `getCopyCellValue.value`

VTable-Sheet 默认只配置了 `keyboardOptions.getCopyCellValue.html`，未配置 `.value`。导致纯文本模式（`text/plain`）复制的是公式计算后的值（如 `120`），而不是公式字符串（如 `=B6*F6`）。

建议 VTable-Sheet 初始化时将 `.value` 也设为 `getCellValueConsiderFormula`，让纯文本复制也能保留公式。
