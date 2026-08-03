export const CURRENT_SCHEMA_VERSION = 9

export interface Migration {
  version: number
  name: string
  description: string
  up: (db: any) => void
  down: (db: any) => void
}

const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    description: '初始化数据库表结构（客户、产品、订单、任务、报价、工艺成本）',
    up: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          applied_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          contact_person TEXT DEFAULT '',
          phone TEXT DEFAULT '',
          email TEXT DEFAULT '',
          address TEXT DEFAULT '',
          industry TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT DEFAULT '',
          description TEXT DEFAULT '',
          price REAL DEFAULT 0,
          category TEXT DEFAULT '',
          stock INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          customer_id TEXT DEFAULT '',
          quote_id TEXT DEFAULT '',
          order_number TEXT DEFAULT '',
          status TEXT DEFAULT 'pending',
          total_amount REAL DEFAULT 0,
          remarks TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          product_id TEXT DEFAULT '',
          quantity INTEGER DEFAULT 0,
          unit_price REAL DEFAULT 0,
          amount REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          order_id TEXT DEFAULT '',
          title TEXT NOT NULL,
          description TEXT DEFAULT '',
          status TEXT DEFAULT 'pending',
          due_date TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS quotes (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT '',
          customer_id TEXT DEFAULT '',
          quote_number TEXT NOT NULL,
          customerName TEXT NOT NULL,
          shippingAddress TEXT DEFAULT '',
          productStyle TEXT DEFAULT '1',
          productSpec TEXT DEFAULT '',
          fabricMaterial TEXT DEFAULT '10安涤棉新本色',
          process TEXT DEFAULT '单面数码uv印刷',
          handleMaterial TEXT DEFAULT '帆布手提',
          handleSpec TEXT DEFAULT '',
          quantity TEXT DEFAULT '',
          boxSpec TEXT DEFAULT '',
          remark TEXT DEFAULT '',
          sampleFee TEXT DEFAULT '',
          sampleDays TEXT DEFAULT '',
          massDays TEXT DEFAULT '',
          unitPrice TEXT DEFAULT '',
          productionTimeStart TEXT DEFAULT '',
          productionTimeEnd TEXT DEFAULT '',
          sellPriceNoTax REAL DEFAULT 0,
          sellPriceWithTax REAL DEFAULT 0,
          status INTEGER DEFAULT 1,
          quoteTime TEXT DEFAULT '',
          sampleTime TEXT DEFAULT '',
          productionStartTime TEXT DEFAULT '',
          shippingTime TEXT DEFAULT '',
          paymentTime TEXT DEFAULT '',
          endTime TEXT DEFAULT '',
          images TEXT DEFAULT '[]',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE TABLE IF NOT EXISTS process_costs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          cost REAL DEFAULT 0,
          formula TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );

        CREATE INDEX IF NOT EXISTS idx_quotes_customerName ON quotes(customerName);
        CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status);
        CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      `)
    },
    down: (db: any) => {
      db.exec(`
        DROP TABLE IF EXISTS schema_migrations;
        DROP TABLE IF EXISTS customers;
        DROP TABLE IF EXISTS products;
        DROP TABLE IF EXISTS orders;
        DROP TABLE IF EXISTS order_items;
        DROP TABLE IF EXISTS tasks;
        DROP TABLE IF EXISTS quotes;
        DROP TABLE IF EXISTS process_costs;
      `)
    },
  },
  {
    version: 2,
    name: 'add-cost-price',
    description: '为 quotes 表添加成本价字段（costPrice），来源为在线表格汇总行与参考卖价列交叉单元格',
    up: (db: any) => {
      db.exec(`ALTER TABLE quotes ADD COLUMN costPrice REAL DEFAULT 0`)
    },
    down: (db: any) => {
      // SQLite 不支持 DROP COLUMN（旧版本），通过重建表实现
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, sellPriceNoTax, sellPriceWithTax, status,
          quoteTime, sampleTime, productionStartTime, shippingTime, paymentTime, endTime, images,
          created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 3,
    name: 'add-price-with-tax',
    description: '为 quotes 表添加含税价字段（priceWithTax），即成本含税价 = 成本价 × 1.1，支持手动覆盖',
    up: (db: any) => {
      db.exec(`ALTER TABLE quotes ADD COLUMN priceWithTax REAL DEFAULT 0`)
    },
    down: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, sellPriceNoTax, sellPriceWithTax, costPrice,
          status, quoteTime, sampleTime, productionStartTime, shippingTime, paymentTime, endTime,
          images, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 4,
    name: 'migrate-productstyle-to-numeric',
    description: 'V0.3：将 quotes 表 productStyle 字段从中文名称迁移为数字编码（1-6），统一前后端枚举值，并重建 quote_number 中款式部分',
    up: (db: any) => {
      // 中文标签 → 数字编码映射表
      const styleMap: Record<string, string> = {
        '无底无侧普通袋': '1',
        '有底无侧普通袋': '2',
        '有底有侧普通袋': '3',
        '手提连底普通拼接袋': '4',
        '手提连底高级拼接袋': '5',
        '手提无连底拼接袋': '6',
        // 兼容历史变体
        '无底无侧普通款': '1',
        '手提无连底拼接款': '6',
      }

      // 逐行迁移 productStyle 字段
      const rows = db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?')

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        // 已经是数字编码则跳过（幂等性保证）
        if (/^[1-6]$/.test(currentStyle)) continue

        const numericStyle = styleMap[currentStyle] ?? '1' // 未知值默认为 '1'
        // 重建 quote_number：将中文款式部分替换为数字编码
        let newQuoteNumber = row.quote_number ?? ''
        for (const [label, code] of Object.entries(styleMap)) {
          if (newQuoteNumber.includes(label)) {
            newQuoteNumber = newQuoteNumber.replace(label, code)
            break
          }
        }
        updateStmt.run(numericStyle, newQuoteNumber, row.id)
      }
    },
    down: (db: any) => {
      // 回滚：将数字编码还原为中文名称
      const labelMap: Record<string, string> = {
        '1': '无底无侧普通袋',
        '2': '有底无侧普通袋',
        '3': '有底有侧普通袋',
        '4': '手提连底普通拼接袋',
        '5': '手提连底高级拼接袋',
        '6': '手提无连底拼接袋',
      }

      const rows = db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?')

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        // 已经是中文则跳过
        if (!/^[1-6]$/.test(currentStyle)) continue

        const label = labelMap[currentStyle] ?? currentStyle
        // 还原 quote_number
        let newQuoteNumber = row.quote_number ?? ''
        newQuoteNumber = newQuoteNumber.replace(currentStyle, label)
        updateStmt.run(label, newQuoteNumber, row.id)
      }
    },
  },
  {
    version: 5,
    name: 'add-table-data',
    description: '为 quotes 表添加 tableData 字段，持久化在线表格二维数据（用户编辑后的值），仅新增订单时从模板加载，后续以数据库为准',
    up: (db: any) => {
      // tableData 存储 JSON 字符串：二维数组 (string|number|null)[][]
      db.exec(`ALTER TABLE quotes ADD COLUMN tableData TEXT DEFAULT '[]'`)
    },
    down: (db: any) => {
      // 重建表移除 tableData 列（SQLite 旧版本不支持 DROP COLUMN）
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 6,
    name: 'add-removed-formula-addresses',
    description: '为 quotes 表添加 removedFormulaAddresses 字段，持久化用户已删除的公式地址列表，加载时排除这些公式使 tableData 值生效',
    up: (db: any) => {
      // removedFormulaAddresses 存储 JSON 字符串：字符串数组 ["J8", "K9"]
      db.exec(`ALTER TABLE quotes ADD COLUMN removedFormulaAddresses TEXT DEFAULT '[]'`)
    },
    down: (db: any) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, tableData, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 7,
    name: 'add-product-code-and-default-styles',
    description: 'V0.4：为 products 表添加 code 字段（款式编码，对应 quotes.productStyle 1-6），并插入 6 条默认款式产品，使款式数据来源由产品管理模块统一管理',
    up: (db: any) => {
      // 1. 新增 code 字段（可空，普通产品可为空）
      db.exec(`ALTER TABLE products ADD COLUMN code TEXT DEFAULT ''`)

      // 2. 创建唯一索引：非空 code 唯一，避免重复款式编码；空 code 允许多条（普通产品）
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code ON products(code) WHERE code != ''`)

      // 3. 插入 6 条默认款式产品（幂等：INSERT OR IGNORE 保证重复执行不报错）
      const insertStmt = db.prepare(
        `INSERT OR IGNORE INTO products (id, name, code, sku, description, price, category, stock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const defaultStyles = [
        { id: 'style-1', name: '无底无侧普通袋', code: '1' },
        { id: 'style-2', name: '有底无侧普通袋', code: '2' },
        { id: 'style-3', name: '有底有侧普通袋', code: '3' },
        { id: 'style-4', name: '手提连底普通拼接袋', code: '4' },
        { id: 'style-5', name: '手提连底高级拼接袋', code: '5' },
        { id: 'style-6', name: '手提无连底拼接袋', code: '6' },
      ]
      for (const s of defaultStyles) {
        insertStmt.run(s.id, s.name, s.code, `STYLE-${s.code}`, `${s.name}款式`, 0, '款式', 0)
      }
    },
    down: (db: any) => {
      // 1. 删除插入的默认款式产品
      db.exec(`DELETE FROM products WHERE id IN ('style-1','style-2','style-3','style-4','style-5','style-6')`)
      // 2. 删除唯一索引
      db.exec(`DROP INDEX IF EXISTS idx_products_code`)
      // 3. 重建 products 表移除 code 列（SQLite 旧版本不支持 DROP COLUMN）
      db.exec(`
        CREATE TABLE IF NOT EXISTS products_backup AS SELECT id, name, sku, description, price, category, stock, created_at, updated_at FROM products;
        DROP TABLE products;
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT DEFAULT '',
          description TEXT DEFAULT '',
          price REAL DEFAULT 0,
          category TEXT DEFAULT '',
          stock INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        INSERT INTO products SELECT id, name, sku, description, price, category, stock, created_at, updated_at FROM products_backup;
        DROP TABLE products_backup;
      `)
    },
  },
  {
    version: 8,
    name: 'add-modified-formulas',
    description: 'V0.4.1：为 quotes 表添加 modifiedFormulas 字段，持久化用户修改过的公式内容（地址→公式字符串），加载时覆盖模板原公式，修复用户修改公式保存后恢复原公式的问题',
    up: (db: any) => {
      // modifiedFormulas 存储 JSON 字符串：地址→公式字符串 {"J8":"=SUM(J6:J7)*1.1", ...}
      db.exec(`ALTER TABLE quotes ADD COLUMN modifiedFormulas TEXT DEFAULT '{}'`)
    },
    down: (db: any) => {
      // 重建 quotes 表移除 modifiedFormulas 列（SQLite 旧版本不支持 DROP COLUMN）
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, tableData, removedFormulaAddresses, created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
  {
    version: 9,
    name: 'add-all-formulas',
    description: 'V0.4.2：新增 allFormulas 字段持久化表格中所有单元格的公式（地址→公式字符串），并从老数据（removedFormulaAddresses + modifiedFormulas + 模板公式）计算初始化 allFormulas，加载时直接使用，不再依赖模板比对',
    up: (db: any) => {
      // 1. 新增 allFormulas 列（JSON 字符串：地址→公式字符串）
      db.exec(`ALTER TABLE quotes ADD COLUMN allFormulas TEXT DEFAULT '{}'`)

      // 2. 内联 6 个款式的模板公式定义（与前端 BagQuote.tsx 一致）
      //    迁移脚本一次性使用，内联确保公式与前端完全一致，避免跨边界 import
      const STYLE_FORMULAS: Record<string, Record<string, string>> = {
        // 款式1：无底无侧普通袋
        '1': {
          B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*K3*1.5/1000', P3: '=M3*4/(I4/100)',
          B4: '=B2', I4: '=D4', L4: '=MOD(J4,MIN(H4,I4))', M4: '=I4/100*2*B4/INT(J4/H4)',
          N4: '=J4/(MIN(H4,I4))', O4: '=M4*K4*1.5/1000',
          A6: '=A3', C6: '=H3*I3*1.1/10000', E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
          H6: '=O3*0.8', J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
          A7: '=A4', E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H7: '=O4*0.8',
          J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
          J8: '=SUM(J6:J7)', J9: '=J8+I9', K9: '=J9*1.1', J10: '=(J9-J8)*B2',
        },
        // 款式2：有底无侧普通袋
        '2': {
          B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*K3*1.5/1000', P3: '=M3*4/(I4/100)',
          B4: '=B2', I4: '=D4', L4: '=MOD(J4,MIN(H4,I4))', M4: '=I4/100*2*B4/INT(J4/H4)',
          N4: '=J4/(MIN(H4,I4))', O4: '=M4*K4*1.5/1000',
          B5: '=B2', C5: '=C2', D5: '=E2', H5: '=F5+C5', I5: '=D5+G5*2',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*K5*1.5/1000',
          A7: '=A3', C7: '=H3*I3*1.1/10000', E7: '=D7*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
          H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B3)*I7+G7',
          A8: '=A4', E8: '=D8*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H8: '=O4*0.8',
          J8: '=(B8+C8+E8+F8+H8/B4)*I8+G8',
          A9: '=A5', E9: '=D9*M5/B5+CEILING(M5/100,1)*15/B5+0.04', J9: '=(B9+C9+E9+F9)*I9+G9',
          J10: '=SUM(J7:J9)', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
        },
        // 款式3：有底有侧普通袋
        '3': {
          B3: '=B2', C3: '=C2', D3: '=D2', H3: '=F3+C2', I3: '=(D3*2+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*1.5*K3/1000',
          B4: '=B2', C4: '=E2', D4: '=C2+D2*2', H4: '=E2+F4', I4: '=C2+D2*2+G4',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B3/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*1.5*K4/1000',
          B5: '=B2', I5: '=D5', L5: '=MOD(J5,MIN(H5,I5))', M5: '=I5/100*2*B2/INT(J5/H5)',
          N5: '=J5/(MIN(H5,I5))', O5: '=M5*1.5*K5/1000',
          O2: '=SUM(O3:O5)', P2: '=O2/B2*1000',
          A7: '=A3', C7: '=H3*I3*1.2/10000', E7: '=D7*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
          H7: '=O3*1.8', J7: '=(B7+F7+C7+E7+H7/B2)*I7+G7',
          A8: '=A4', E8: '=D8*M4/B3+CEILING(M4/100,1)*15/B3+0.04', H8: '=O4*1.8',
          J8: '=(B8+F8+C8+E8+H8/B3)*I8+G8',
          A9: '=A5', H9: '=O5*1.8', J9: '=(B9+C9+E9+F9+H9/B2)*I9+G9',
          J10: '=SUM(J7:J9)', K10: '=J10*1.1', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
        },
        // 款式4：手提连底普通拼接袋
        '4': {
          B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2', H3: '=F3+C3', I3: '=E3*2+G3',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*K3*1.5/1000',
          B4: '=B2', C4: '=C2', D4: '=D2-D3', H4: '=F4+C2', I4: '=G4+D2-E2/2',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*K4*1.5/1000',
          B5: '=B2', C5: '=C2', D5: '=D2-D3', H5: '=F5+C2', I5: '=G5+D2-E2/2',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*K5*1.5/1000',
          B6: '=B3', H6: '=F6+C6', I6: '=G6+D6-E6/2', L6: '=MOD(J6,MIN(H6,I6))',
          M6: '=CEILING(B3/INT(N6),1)*MAX(H6,I6)/100', N6: '=J6/(MIN(H6,I6))', O6: '=M6*K6*1.5/1000',
          B7: '=B2', I7: '=D7', L7: '=MOD(J7,MIN(H7,I7))', M7: '=I7/100*2*B2/INT(J7/H7)',
          N7: '=J7/(MIN(H7,I7))', O7: '=M7*K7*1.5/1000',
          O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
          A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04', H9: '=O3*0.8',
          J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
          A10: '=A4', E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H10: '=O4*0.8',
          J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
          A11: '=A5', E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04', H11: '=O5*0.8',
          J11: '=(B11+C11+E11+H11/B2)*I11+G11',
          A12: '=A6', E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04', H12: '=O6*0.8',
          J12: '=(B12+C12+E12+F12+H12/B4)*I12+G12',
          A13: '=A7', E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7', H13: '=O7*0.8',
          J13: '=(E13+H13/B2)*I13+G13',
          H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
          J15: '=J14+I15', K15: '=J15*1.1', J16: '=(J15-J14)*B2',
        },
        // 款式5：手提连底高级拼接袋
        '5': {
          B3: '=B2', C3: '=C2', E3: '=E2', H3: '=F3+C3', I3: '=E3+D3*2+G3',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*K3*1.5/1000',
          B4: '=B3', C4: '=C2', D4: '=D2-D3', H4: '=F4+C2', I4: '=D2*2+E2+G4',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*K4*1.5/1000',
          B5: '=B3', D5: '=(D2+C2)*2', H5: '=C5', I5: '=D5', L5: '=MOD(J5,MIN(H5,I5))',
          M5: '=CEILING(B3/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))', O5: '=M5*K5*1.5/1000',
          B6: '=B2', I6: '=D6', L6: '=MOD(J6,MIN(H6,I6))', M6: '=I6/100*2*B6/INT(J6/H6)',
          N6: '=J6/(MIN(H6,I6))', O6: '=M6*K6*1.5/1000',
          B7: '=B2', D7: '=D6', I7: '=D7', L7: '=MOD(J7,MIN(H7,I7))', M7: '=I7/100*2*B7/INT(J7/H7)',
          N7: '=J7/(MIN(H7,I7))', O7: '=M7*K7*1.5/1000',
          O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
          A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04', H9: '=O3*1.8',
          J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
          A10: '=A4', E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H10: '=O4*1.8',
          J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
          A11: '=A5', E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04', H11: '=O5*1.8',
          J11: '=(B11+C11+E11+F11)*I11+H11/B3+G11',
          A12: '=A6', B12: '=D6/100*2*0.18', E12: '=(M6*D12/B6+CEILING(M6/100,1)*10/B6)',
          H12: '=O6*1.8', J12: '=(B12+E12+H12/B2)*I12+G12',
          A13: '=A7', E13: '=(M7*D13/B7+CEILING(M7/100,1)*10/B7)', H13: '=O7*1.8',
          J13: '=(B13+E13+H13/B3)*I13+G13',
          H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
          J15: '=J14+I15', K15: '=J15*1.1', J16: '=(J15-J14)*B2',
        },
        // 款式6：手提无连底拼接袋
        '6': {
          B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2', H3: '=F3+C3', I3: '=E3*2+G3',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*K3*1.5/1000',
          B4: '=B2', C4: '=C2', D4: '=D2-D3', H4: '=F4+C2', I4: '=G4+D2-E2/2',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*K4*1.5/1000',
          B5: '=B4', C5: '=C2', D5: '=D2-D3', H5: '=F5+C2', I5: '=G5+D2-E2/2',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*K5*1.5/1000',
          B6: '=B5', H6: '=F6+C6', I6: '=G6+D6', L6: '=MOD(J6,MIN(H6,I6))',
          M6: '=CEILING(B2/INT(N6),1)*MAX(H6,I6)/100', N6: '=J6/(MIN(H6,I6))', O6: '=M6*K6*1.5/1000',
          B7: '=B6', I7: '=D7', L7: '=MOD(J7,MIN(H7,I7))', M7: '=I7/100*2*B2/INT(J7/H7)',
          N7: '=J7/(MIN(H7,I7))', O7: '=M7*K7*1.5/1000',
          O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
          A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04', H9: '=O3*1.8',
          J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
          A10: '=A4', E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04', H10: '=O4*1.8', I10: '=I9',
          J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
          A11: '=A5', E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04', H11: '=O5*1.8', I11: '=I10',
          J11: '=(B11+C11+E11+H11/B2)*I11+G11',
          A12: '=A6', E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04', H12: '=O6*1.8', I12: '=I11',
          J12: '=(B12+C12+E12+F12)*I12+H12/B2+G12',
          A13: '=A7', E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7', H13: '=O7*1.8', I13: '=I12',
          J13: '=(E13+H13/B2)*I13+G13',
          H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
          I15: '=J15-J14', K15: '=J15*1.1', J16: '=(J15-J14)*B2',
        },
      }

      // 3. 遍历所有 quotes，从老数据计算 allFormulas 并写入
      //    allFormulas = template.formulas（排除 removedFormulaAddresses）+ modifiedFormulas（覆盖）
      //    无模板绑定的 productStyle（如自定义产品 id）默认使用款式1模板
      const rows = db.prepare('SELECT id, productStyle, removedFormulaAddresses, modifiedFormulas FROM quotes').all() as {
        id: string
        productStyle: string
        removedFormulaAddresses: string | null
        modifiedFormulas: string | null
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET allFormulas = ? WHERE id = ?')

      for (const row of rows) {
        const styleCode = /^[1-6]$/.test(row.productStyle) ? row.productStyle : '1'
        const templateFormulas = STYLE_FORMULAS[styleCode] || STYLE_FORMULAS['1']

        // 解析老数据 JSON 字段
        let removed: string[] = []
        try { removed = row.removedFormulaAddresses ? JSON.parse(row.removedFormulaAddresses) : [] } catch { removed = [] }
        let modified: Record<string, string> = {}
        try { modified = row.modifiedFormulas ? JSON.parse(row.modifiedFormulas) : {} } catch { modified = {} }

        const removedSet = new Set(removed)
        // 计算 allFormulas：模板公式 - 已删除 + 已修改
        const allFormulas: Record<string, string> = {}
        for (const [addr, formula] of Object.entries(templateFormulas)) {
          if (removedSet.has(addr)) continue // 已删除的公式跳过
          allFormulas[addr] = modified[addr] || formula // 已修改的公式覆盖
        }

        updateStmt.run(JSON.stringify(allFormulas), row.id)
      }
    },
    down: (db: any) => {
      // 重建 quotes 表移除 allFormulas 列（保留 removedFormulaAddresses/modifiedFormulas 以兼容回滚）
      db.exec(`
        CREATE TABLE IF NOT EXISTS quotes_backup AS SELECT * FROM quotes;
        DROP TABLE quotes;
        CREATE TABLE quotes AS SELECT id, user_id, customer_id, quote_number, customerName,
          shippingAddress, productStyle, productSpec, fabricMaterial, process, handleMaterial,
          handleSpec, quantity, boxSpec, remark, sampleFee, sampleDays, massDays, unitPrice,
          productionTimeStart, productionTimeEnd, costPrice, priceWithTax, sellPriceNoTax,
          sellPriceWithTax, status, quoteTime, sampleTime, productionStartTime, shippingTime,
          paymentTime, endTime, images, tableData, removedFormulaAddresses, modifiedFormulas,
          created_at, updated_at FROM quotes_backup;
        DROP TABLE quotes_backup;
      `)
    },
  },
]

export class MigrationRunner {
  private db: any
  private appliedVersions: Set<number> = new Set()

  constructor(db: any) {
    this.db = db
    this.ensureMigrationTable()
    this.loadAppliedVersions()
  }

  private ensureMigrationTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        applied_at TEXT DEFAULT (datetime('now','localtime'))
      )
    `)
  }

  private loadAppliedVersions(): void {
    const rows = this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
    this.appliedVersions = new Set(rows.map((r) => r.version))
  }

  getCurrentVersion(): number {
    const row = this.db.prepare('SELECT MAX(version) as v FROM schema_migrations').get() as { v: number | null }
    return row.v ?? 0
  }

  getPendingMigrations(): Migration[] {
    return migrations.filter((m) => !this.appliedVersions.has(m.version))
  }

  migrate(upToVersion?: number): { applied: string[]; skipped: string[] } {
    const pending = this.getPendingMigrations()
    const targetVersion = upToVersion ?? CURRENT_SCHEMA_VERSION
    const toApply = pending.filter((m) => m.version <= targetVersion)

    const applied: string[] = []
    const skipped: string[] = []

    if (toApply.length === 0) {
      skipped.push('无待执行的迁移')
      return { applied, skipped }
    }

    const migrateAll = this.db.transaction(() => {
      for (const migration of toApply) {
        migration.up(this.db)
        this.db.prepare(
          'INSERT INTO schema_migrations (version, name, description) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, migration.description)
        this.appliedVersions.add(migration.version)
        applied.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    migrateAll()

    return { applied, skipped }
  }

  rollback(toVersion: number): { rolledBack: string[] } {
    const applied = migrations
      .filter((m) => this.appliedVersions.has(m.version) && m.version > toVersion)
      .sort((a, b) => b.version - a.version)

    const rolledBack: string[] = []

    const rollbackAll = this.db.transaction(() => {
      for (const migration of applied) {
        migration.down(this.db)
        this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version)
        this.appliedVersions.delete(migration.version)
        rolledBack.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    rollbackAll()

    return { rolledBack }
  }

  reset(): { rolledBack: string[] } {
    return this.rollback(0)
  }

  static fromPath(): Migration[] {
    return migrations
  }
}

export function getMigrations(): Migration[] {
  return [...migrations]
}
