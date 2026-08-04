# 重构说明文档：枚举、常量、模板与映射关系独立化

> 重构日期：2026-08-04
> 重构范围：src/constants/、src/templates/、src/utils/ 新建 + src/pages/ 引用更新

---

## 一、重构背景

重构前，项目中存在以下问题：

### 1. 重复定义
`STATUS_OPTIONS` 在 4 个文件中重复定义，内容完全一致：
- `src/pages/BagQuote.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/BagQuoteTable.tsx`
- `src/pages/Quotes.tsx`

### 2. 职责混乱
`BagQuote.tsx`（1900+ 行的 React 组件）内嵌了大量常量定义、6 个表格模板、工具函数和映射逻辑，导致组件文件臃肿、职责不清。

### 3. 不可测试
`parseExcelAddress`、`toExcelAddress`、`addDaysToDate` 等工具函数定义在组件内部且未导出，现有测试只能通过复制实现来测试。

### 4. 缺乏封装
模板数据、颜色常量、状态枚举等均为裸露的 `const`，无封装、无验证方法、无扩展性。

---

## 二、类设计思路

### 设计原则
1. **单一职责原则（SRP）**：每个类只负责一类常量/逻辑
2. **开闭原则（OCP）**：新增款式只需在 `SheetTemplateManager.TEMPLATES` 中添加映射，无需修改调用方代码
3. **封装性**：内部数据设为 `private`，仅通过方法暴露，返回时使用深拷贝防止外部修改
4. **不可变性**：常量使用 `static readonly`，返回数据使用拷贝

### 新建类清单

| 类名 | 文件路径 | 职责 |
|------|----------|------|
| `OrderStatus` | `src/constants/OrderStatus.ts` | 订单状态枚举（6个状态值 + 查找/验证/流转方法） |
| `ProductionSteps` | `src/constants/ProductionSteps.ts` | 生产步骤枚举（6个步骤 + 查找方法） |
| `StyleConstants` | `src/constants/StyleConstants.ts` | 颜色、边框样式常量 + 单元格样式构建方法 |
| `TableConstants` | `src/constants/TableConstants.ts` | 表格列宽、Sheet Key 等常量 |
| `SheetTemplateManager` | `src/templates/SheetTemplateManager.ts` | 6个表格模板管理 + 款式→模板映射 |
| `ExcelUtils` | `src/utils/ExcelUtils.ts` | Excel 地址解析/生成工具 |
| `DateUtils` | `src/utils/DateUtils.ts` | 日期计算工具 |

### 类设计详解

#### OrderStatus（订单状态枚举类）

```
原代码：const STATUS_OPTIONS = [{ value: 1, label: '报价中' }, ...]  // 在4个文件中重复
新代码：OrderStatus.getAll() / OrderStatus.getLabel(1) / OrderStatus.canEnterFinished(1)
```

- 将 4 处重复的 `STATUS_OPTIONS` 统一为一个枚举类
- 提供静态常量（`QUOTING=1` 等）便于代码中使用语义化名称
- 提供业务方法：`canEnterFinished()`（报价中/打样中可直接进入结束）、`getNext()`（正常流转）
- `getAll()` 返回浅拷贝，防止外部修改内部数据

#### SheetTemplateManager（模板管理类）

```
原代码：6个 TEMPLATE_* 常量 + getTemplateByStyle() 函数（约450行，全部在 BagQuote.tsx 内）
新代码：SheetTemplateManager.getTemplate('1') / SheetTemplateManager.hasTemplate('3')
```

- 采用 Factory 模式，6 个模板设为 `private static readonly`
- `getTemplate()` 返回深拷贝（`data` 逐行拷贝、`formulas` 展开到新对象），防止外部修改污染内部数据
- 提供 `hasTemplate()` / `getAllStyles()` 等查询方法
- 新增款式只需在 `TEMPLATES` 映射中添加条目，符合开闭原则

#### StyleConstants（样式常量类）

```
原代码：const SC = { yellow: '#FFFF00', ... }; const BORDER = { borderColor: SC.black, ... }
新代码：StyleConstants.COLORS.yellow / StyleConstants.BORDER / StyleConstants.buildCellStyle(...)
```

- 封装颜色调色板和边框样式
- 提供 `buildCellStyle()` 工厂方法，统一样式生成逻辑（原 `cs()` 函数）
- 提供 `buildHeaderStyle()` / `buildFormulaStyle()` 便捷方法

#### ExcelUtils / DateUtils（工具类）

```
原代码：parseExcelAddress / toExcelAddress / addDaysToDate 定义在 BagQuote.tsx 内未导出
新代码：ExcelUtils.parseAddress('J8') / ExcelUtils.toAddress(7, 9) / DateUtils.addDays('2026-07-31', 30)
```

- 将未导出的工具函数提取为独立工具类
- 使其可被组件和测试文件共享
- 消除了 `tests/utils.test.ts` 中的重复实现

---

## 三、文件结构变更

### 新增文件
```
src/
├── constants/
│   ├── OrderStatus.ts          # 订单状态枚举类
│   ├── ProductionSteps.ts       # 生产步骤枚举类
│   ├── StyleConstants.ts        # 样式常量类
│   └── TableConstants.ts        # 表格常量类
├── templates/
│   ├── types.ts                 # SheetTemplate 接口定义
│   └── SheetTemplateManager.ts  # 模板管理类
├── utils/
│   ├── ExcelUtils.ts            # Excel 地址工具
│   └── DateUtils.ts             # 日期工具
```

### 修改文件
| 文件 | 变更内容 |
|------|----------|
| `src/pages/BagQuote.tsx` | 移除 450+ 行常量/模板/工具函数定义，改为导入新类 |
| `src/pages/Dashboard.tsx` | 移除 `STATUS_OPTIONS`，使用 `OrderStatus` + 本地颜色映射 |
| `src/pages/Quotes.tsx` | 移除 `STATUS_OPTIONS`，使用 `OrderStatus.getAll()` |
| `src/pages/BagQuoteTable.tsx` | 移除 `STATUS_OPTIONS`，使用 `OrderStatus.getAll()` |
| `tests/utils.test.ts` | 移除 `addDaysToDate` 重复实现，导入 `DateUtils` |
| `tests/formula-cell-style.test.ts` | 移除 SC/BORDER/模板数据重复，导入 `StyleConstants`/`SheetTemplateManager` |
| `vitest.config.ts` | 添加 coverage 配置（v8 provider, 90% threshold） |
| `package.json` | 添加 `@vitest/coverage-v8` devDependency |

### 新增测试文件
```
tests/
├── constants/
│   ├── OrderStatus.test.ts          # 33 个测试用例
│   ├── ProductionSteps.test.ts      # 14 个测试用例
│   ├── StyleConstants.test.ts       # 20 个测试用例
│   └── TableConstants.test.ts       # 10 个测试用例
├── templates/
│   └── SheetTemplateManager.test.ts # 20 个测试用例
├── utils/
│   ├── ExcelUtils.test.ts           # 25 个测试用例
│   └── DateUtils.test.ts            # 13 个测试用例
```

---

## 四、测试策略

### 测试覆盖维度
1. **正常值验证**：每个常量值、每个方法的正常输入输出
2. **边界情况**：空值、无效值、越界索引
3. **不可变性**：修改返回值不影响内部数据（浅拷贝/深拷贝验证）
4. **正逆运算**：`parseAddress` 与 `toAddress` 的互逆一致性
5. **业务逻辑**：状态流转规则、模板映射回退

### 测试结果

```
Test Files  20 passed (20)
Tests       592 passed (592)
Duration    8.47s
```

- 原有 451 个测试全部通过（无回归）
- 新增 141 个测试全部通过

---

## 五、覆盖率报告

```
=============================== Coverage summary ===============================
Statements   : 100% ( 69/69 )
Branches     : 100% ( 29/29 )
Functions    : 100% ( 30/30 )
Lines        : 100% ( 58/58 )
================================================================================
```

| 文件 | 语句覆盖 | 分支覆盖 | 函数覆盖 | 行覆盖 |
|------|----------|----------|----------|--------|
| OrderStatus.ts | 100% | 100% | 100% | 100% |
| ProductionSteps.ts | 100% | 100% | 100% | 100% |
| StyleConstants.ts | 100% | 100% | 100% | 100% |
| TableConstants.ts | 100% | 100% | 100% | 100% |
| SheetTemplateManager.ts | 100% | 100% | 100% | 100% |
| ExcelUtils.ts | 100% | 100% | 100% | 100% |
| DateUtils.ts | 100% | 100% | 100% | 100% |

> 注：`src/templates/types.ts` 为纯接口定义文件，无可执行代码，已从覆盖率统计中排除。

所有新类文件的覆盖率均为 **100%**，远超 90% 的目标。

---

## 六、兼容性说明

### 业务逻辑保持不变
重构仅改变了代码组织结构，所有业务逻辑完全保持一致：
- 状态值和标签不变（1=报价中, 2=打样中, ...）
- 模板数据和公式完全一致（已通过现有测试验证）
- 工具函数行为不变（`addDaysToDate` → `DateUtils.addDays`，逻辑完全相同）
- 样式渲染效果不变（颜色值、边框样式均从原 `SC`/`BORDER` 迁移）

### 验证方法
1. **TypeScript 类型检查**：`npm run check` 无错误
2. **全量测试**：451 个原有测试 + 141 个新测试 = 592 个全部通过
3. **覆盖率**：新类文件覆盖率 100%
4. **构建验证**：`npm run build` 构建成功

---

## 七、重构收益

### 代码质量提升
- **消除重复**：`STATUS_OPTIONS` 从 4 处定义统一为 1 处
- **减少代码量**：`BagQuote.tsx` 从 1900+ 行减少约 450 行
- **提高可测试性**：工具函数从组件内部提取为独立类，可直接导入测试
- **增强封装性**：模板数据通过 `private` + 深拷贝返回，防止意外修改

### 可维护性提升
- **单一职责**：每个类只负责一类常量，修改影响范围明确
- **语义化引用**：`OrderStatus.QUOTING` 比魔法数字 `1` 更易读
- **集中管理**：新增款式只需修改 `SheetTemplateManager`，无需改动调用方

### 可扩展性提升
- 新增订单状态：在 `OrderStatus.OPTIONS` 中添加条目
- 新增表格模板：在 `SheetTemplateManager.TEMPLATES` 中添加映射
- 新增颜色常量：在 `StyleConstants.COLORS` 中添加字段
