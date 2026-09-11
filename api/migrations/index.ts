export const CURRENT_SCHEMA_VERSION = 32

export interface Migration {
  version: number
  name: string
  description: string
  up: (db: any) => Promise<void>
  down: (db: any) => Promise<void>
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'initial-schema',
    description: '初始化数据库表结构（客户、产品、订单、任务、报价、工艺成本）',
    up: async (db: any) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS customers (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          contact_person VARCHAR(255) DEFAULT '',
          phone VARCHAR(64) DEFAULT '',
          email VARCHAR(255) DEFAULT '',
          address VARCHAR(500) DEFAULT '',
          industry VARCHAR(255) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS products (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          sku VARCHAR(255) DEFAULT '',
          description TEXT,
          price DOUBLE DEFAULT 0,
          category VARCHAR(255) DEFAULT '',
          stock INT DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS orders (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(64) DEFAULT '',
          customer_id VARCHAR(64) DEFAULT '',
          quote_id VARCHAR(64) DEFAULT '',
          order_number VARCHAR(255) DEFAULT '',
          status VARCHAR(64) DEFAULT 'pending',
          total_amount DOUBLE DEFAULT 0,
          remarks TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id VARCHAR(64) PRIMARY KEY,
          order_id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) DEFAULT '',
          quantity INT DEFAULT 0,
          unit_price DOUBLE DEFAULT 0,
          amount DOUBLE DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(64) DEFAULT '',
          order_id VARCHAR(64) DEFAULT '',
          title VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(64) DEFAULT 'pending',
          due_date VARCHAR(64) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS quotes (
          id VARCHAR(64) PRIMARY KEY,
          user_id VARCHAR(64) DEFAULT '',
          customer_id VARCHAR(64) DEFAULT '',
          quote_number VARCHAR(255) NOT NULL,
          customerName VARCHAR(255) NOT NULL,
          shippingAddress VARCHAR(500) DEFAULT '',
          productStyle VARCHAR(64) DEFAULT '1',
          productSpec VARCHAR(255) DEFAULT '',
          fabricMaterial VARCHAR(255) DEFAULT '10安涤棉新本色',
          process VARCHAR(255) DEFAULT '单面数码uv印刷+口头2.5cm',
          handleMaterial VARCHAR(255) DEFAULT '帆布手提',
          handleSpec VARCHAR(255) DEFAULT '',
          quantity VARCHAR(255) DEFAULT '',
          boxSpec VARCHAR(255) DEFAULT '',
          remark TEXT,
          sampleFee VARCHAR(64) DEFAULT '',
          sampleDays VARCHAR(64) DEFAULT '',
          massDays VARCHAR(64) DEFAULT '',
          unitPrice VARCHAR(255) DEFAULT '',
          productionTimeStart VARCHAR(64) DEFAULT '',
          productionTimeEnd VARCHAR(64) DEFAULT '',
          sellPriceNoTax DOUBLE DEFAULT 0,
          sellPriceWithTax DOUBLE DEFAULT 0,
          status INT DEFAULT 1,
          quoteTime VARCHAR(64) DEFAULT '',
          sampleTime VARCHAR(64) DEFAULT '',
          productionStartTime VARCHAR(64) DEFAULT '',
          shippingTime VARCHAR(64) DEFAULT '',
          paymentTime VARCHAR(64) DEFAULT '',
          endTime VARCHAR(64) DEFAULT '',
          images LONGTEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS process_costs (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          cost DOUBLE DEFAULT 0,
          formula VARCHAR(500) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX idx_quotes_customerName ON quotes(customerName);
        CREATE INDEX idx_quotes_status ON quotes(status);
        CREATE INDEX idx_orders_customer_id ON orders(customer_id);
        CREATE INDEX idx_orders_status ON orders(status);
        CREATE INDEX idx_tasks_status ON tasks(status);
      `)
    },
    down: async (db: any) => {
      // 注意：不在此处 DROP schema_migrations，因为 MigrationRunner.rollback
      // 会在 down 迁移后执行 DELETE FROM schema_migrations，需要表存在。
      // schema_migrations 表由 reset.ts 的 DROP TABLE 逻辑统一清理。
      await db.exec(`
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
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN costPrice DOUBLE DEFAULT 0`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN costPrice`)
    },
  },
  {
    version: 3,
    name: 'add-price-with-tax',
    description: '为 quotes 表添加含税价字段（priceWithTax），即成本含税价 = 成本价 × 1.1，支持手动覆盖',
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN priceWithTax DOUBLE DEFAULT 0`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN priceWithTax`)
    },
  },
  {
    version: 4,
    name: 'migrate-productstyle-to-numeric',
    description: 'V0.3：将 quotes 表 productStyle 字段从中文名称迁移为数字编码（1-6），统一前后端枚举值，并重建 quote_number 中款式部分',
    up: async (db: any) => {
      const styleMap: Record<string, string> = {
        '无底无侧普通袋': '1',
        '有底无侧普通袋': '2',
        '有底有侧普通袋': '3',
        '手提连底普通拼接袋': '4',
        '手提连底高级拼接袋': '5',
        '手提无连底拼接袋': '6',
        '无底无侧普通款': '1',
        '手提无连底拼接款': '6',
      }

      const rows = await db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        if (/^[1-6]$/.test(currentStyle)) continue

        const numericStyle = styleMap[currentStyle] ?? '1'
        let newQuoteNumber = row.quote_number ?? ''
        for (const [label, code] of Object.entries(styleMap)) {
          if (newQuoteNumber.includes(label)) {
            newQuoteNumber = newQuoteNumber.replace(label, code)
            break
          }
        }
        await db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?').run(numericStyle, newQuoteNumber, row.id)
      }
    },
    down: async (db: any) => {
      const labelMap: Record<string, string> = {
        '1': '无底无侧普通袋',
        '2': '有底无侧普通袋',
        '3': '有底有侧普通袋',
        '4': '手提连底普通拼接袋',
        '5': '手提连底高级拼接袋',
        '6': '手提无连底拼接袋',
      }

      const rows = await db.prepare('SELECT id, productStyle, quote_number FROM quotes').all() as {
        id: string
        productStyle: string
        quote_number: string
      }[]

      for (const row of rows) {
        const currentStyle = row.productStyle ?? ''
        if (!/^[1-6]$/.test(currentStyle)) continue

        const label = labelMap[currentStyle] ?? currentStyle
        let newQuoteNumber = row.quote_number ?? ''
        newQuoteNumber = newQuoteNumber.replace(currentStyle, label)
        await db.prepare('UPDATE quotes SET productStyle = ?, quote_number = ? WHERE id = ?').run(label, newQuoteNumber, row.id)
      }
    },
  },
  {
    version: 5,
    name: 'add-table-data',
    description: '为 quotes 表添加 tableData 字段，持久化在线表格二维数据（用户编辑后的值），仅新增订单时从模板加载，后续以数据库为准',
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN tableData LONGTEXT`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN tableData`)
    },
  },
  {
    version: 6,
    name: 'add-removed-formula-addresses',
    description: '为 quotes 表添加 removedFormulaAddresses 字段，持久化用户已删除的公式地址列表，加载时排除这些公式使 tableData 值生效',
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN removedFormulaAddresses LONGTEXT`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN removedFormulaAddresses`)
    },
  },
  {
    version: 7,
    name: 'add-product-code-and-default-styles',
    description: 'V0.4：为 products 表添加 code 字段（款式编码，对应 quotes.productStyle 1-6），并插入 6 条默认款式产品，使款式数据来源由产品管理模块统一管理',
    up: async (db: any) => {
      // 1. 新增 code 字段（可空，普通产品可为空）
      await db.exec(`ALTER TABLE products ADD COLUMN code VARCHAR(64) DEFAULT ''`)

      // 2. 新增生成列：code 为空时返回 NULL，绕过唯一约束（MySQL 不支持 WHERE 条件的部分索引）
      //    STORED 生成列存储计算结果，可建索引；NULL 值不参与唯一性约束
      await db.exec(`ALTER TABLE products ADD COLUMN code_key VARCHAR(64) GENERATED ALWAYS AS (IF(code = '', NULL, code)) STORED`)

      // 3. 在生成列上建唯一索引（非空 code 唯一，空 code 可重复）
      await db.exec(`CREATE UNIQUE INDEX idx_products_code ON products(code_key)`)

      // 4. 插入 6 条默认款式产品（幂等：INSERT IGNORE 保证重复执行不报错）
      const insertStmt = db.prepare(
        `INSERT IGNORE INTO products (id, name, code, sku, description, price, category, stock)
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
        await insertStmt.run(s.id, s.name, s.code, `STYLE-${s.code}`, `${s.name}款式`, 0, '款式', 0)
      }
    },
    down: async (db: any) => {
      await db.exec(`DELETE FROM products WHERE id IN ('style-1','style-2','style-3','style-4','style-5','style-6')`)
      await db.exec(`DROP INDEX idx_products_code ON products`)
      await db.exec(`ALTER TABLE products DROP COLUMN code_key`)
      await db.exec(`ALTER TABLE products DROP COLUMN code`)
    },
  },
  {
    version: 8,
    name: 'add-modified-formulas',
    description: '为 quotes 表添加 modifiedFormulas 字段，持久化用户修改过的公式内容',
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN modifiedFormulas LONGTEXT`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN modifiedFormulas`)
    },
  },
  {
    version: 9,
    name: 'add-all-formulas',
    description: 'V0.4.2：新增 allFormulas 字段持久化表格中所有单元格的公式（地址→公式字符串），并从老数据（removedFormulaAddresses + modifiedFormulas + 模板公式）计算初始化 allFormulas，加载时直接使用，不再依赖模板比对',
    up: async (db: any) => {
      // 1. 新增 allFormulas 列（JSON 字符串：地址→公式字符串）
      await db.exec(`ALTER TABLE quotes ADD COLUMN allFormulas LONGTEXT`)

      // 2. 内联 6 个款式的模板公式定义（与前端 BagQuote.tsx 一致）
      const STYLE_FORMULAS: Record<string, Record<string, string>> = {
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
          H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B2)*I7+G7',
          A8: '=A4', C8: '=H4*I4*1.2/10000', E8: '=D8*M4/B2+CEILING(M4/100,1)*15/B2+0.04',
          H8: '=O4*0.8', J8: '=(B8+C8+F8+E8+H8/B2)*I8+G8',
          A9: '=A5', E9: '=D9*M5/B2+CEILING(M5/100,1)*15/B2+0.04',
          J9: '=(B9+C9+E9+F9)*I9+G9',
          J10: '=SUM(J7:J9)', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
        },
        '4': {
          B3: '=B2', C3: '=C2', D3: '=D2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*1.5*K3/1000',
          B4: '=B2', C4: '=C2', D4: '=D2', E4: '=E2', H4: '=F4+C4', I4: '=(D4*2+E4+G4)',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B4/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*1.5*K4/1000',
          B5: '=B2', C5: '=C2', D5: '=D2', E5: '=E2', H5: '=F5+C5', I5: '=(D5*2+E5+G5)',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*1.5*K5/1000',
          O2: '=SUM(O3:O5)', P2: '=O2/B2*1000',
          A7: '=A3', C7: '=H3*I3*1.1/10000', E7: '=D7*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
          H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B2)*I7+G7',
          A8: '=A4', C8: '=H4*I4*1.1/10000', E8: '=D8*M4/B2+CEILING(M4/100,1)*15/B2+0.04',
          H8: '=O4*0.8', J8: '=(B8+C8+F8+E8+H8/B2)*I8+G8',
          A9: '=A5', C9: '=H5*I5*1.1/10000', E9: '=D9*M5/B2+CEILING(M5/100,1)*15/B2+0.04',
          H9: '=O5*0.8', J9: '=(B9+C9+F9+E9+H9/B2)*I9+G9',
          J10: '=SUM(J7:J9)', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
        },
        '5': {
          B3: '=B2', C3: '=C2', D3: '=D2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*1.5*K3/1000',
          B4: '=B2', C4: '=C2', D4: '=D2', E4: '=E2', H4: '=F4+C4', I4: '=(D4*2+E4+G4)',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B4/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*1.5*K4/1000',
          B5: '=B2', C5: '=C2', D5: '=D2', E5: '=E2', H5: '=F5+C5', I5: '=(D5*2+E5+G5)',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*1.5*K5/1000',
          O2: '=SUM(O3:O5)', P2: '=O2/B2*1000',
          A7: '=A3', C7: '=H3*I3*1.3/10000', E7: '=D7*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
          H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B2)*I7+G7',
          A8: '=A4', C8: '=H4*I4*1.3/10000', E8: '=D8*M4/B2+CEILING(M4/100,1)*15/B2+0.04',
          H8: '=O4*0.8', J8: '=(B8+C8+F8+E8+H8/B2)*I8+G8',
          A9: '=A5', C9: '=H5*I5*1.3/10000', E9: '=D9*M5/B2+CEILING(M5/100,1)*15/B2+0.04',
          H9: '=O5*0.8', J9: '=(B9+C9+F9+E9+H9/B2)*I9+G9',
          J10: '=SUM(J7:J9)', J11: '=J10+I11', K11: '=J11*1.1', J12: '=(J11-J10)*B2',
        },
        '6': {
          B3: '=B2', C3: '=C2', D3: '=D2', H3: '=F3+C3', I3: '=(D3*2+E3+G3)',
          L3: '=MOD(J3,MIN(H3,I3))', M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100', N3: '=J3/(MIN(H3,I3))',
          O3: '=M3*1.5*K3/1000',
          B4: '=B2', C4: '=C2', D4: '=D2', E4: '=E2', H4: '=F4+C4', I4: '=(D4*2+E4+G4)',
          L4: '=MOD(J4,MIN(H4,I4))', M4: '=CEILING(B4/INT(N4),1)*MAX(H4,I4)/100', N4: '=J4/(MIN(H4,I4))',
          O4: '=M4*1.5*K4/1000',
          B5: '=B2', C5: '=C2', D5: '=D2', E5: '=E2', H5: '=F5+C5', I5: '=(D5*2+E5+G5)',
          L5: '=MOD(J5,MIN(H5,I5))', M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100', N5: '=J5/(MIN(H5,I5))',
          O5: '=M5*1.5*K5/1000',
          O2: '=SUM(O3:O5)', P2: '=O2/B2*1000',
          A7: '=A3', C7: '=H3*I3*1.1/10000', E7: '=D7*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
          H7: '=O3*0.8', J7: '=(B7+C7+F7+E7+H7/B2)*I7+G7',
          A8: '=A4', C8: '=H4*I4*1.1/10000', E8: '=D8*M4/B2+CEILING(M4/100,1)*15/B2+0.04',
          H8: '=O4*0.8', J8: '=(B8+C8+F8+E8+H8/B2)*I8+G8',
          A9: '=A5', C9: '=H5*I5*1.1/10000', E9: '=D9*M5/B2+CEILING(M5/100,1)*15/B2+0.04',
          H9: '=O5*0.8', J9: '=(B9+C9+F9+E9+H9/B2)*I9+G9',
          J14: '=SUM(J7:J9)', I15: '=J15-J14', K15: '=J15*1.1', J16: '=(J15-J14)*B2',
        },
      }

      // 3. 遍历所有 quotes，从老数据计算 allFormulas 并写入
      const rows = await db.prepare('SELECT id, productStyle, removedFormulaAddresses, modifiedFormulas FROM quotes').all() as {
        id: string
        productStyle: string
        removedFormulaAddresses: string | null
        modifiedFormulas: string | null
      }[]

      const updateStmt = db.prepare('UPDATE quotes SET allFormulas = ? WHERE id = ?')

      for (const row of rows) {
        const styleCode = /^[1-6]$/.test(row.productStyle) ? row.productStyle : '1'
        const templateFormulas = STYLE_FORMULAS[styleCode] || STYLE_FORMULAS['1']

        let removed: string[] = []
        try { removed = row.removedFormulaAddresses ? JSON.parse(row.removedFormulaAddresses) : [] } catch { removed = [] }
        let modified: Record<string, string> = {}
        try { modified = row.modifiedFormulas ? JSON.parse(row.modifiedFormulas) : {} } catch { modified = {} }

        const removedSet = new Set(removed)
        const allFormulas: Record<string, string> = {}
        for (const [addr, formula] of Object.entries(templateFormulas)) {
          if (removedSet.has(addr)) continue
          allFormulas[addr] = modified[addr] || formula
        }

        await updateStmt.run(JSON.stringify(allFormulas), row.id)
      }
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN allFormulas`)
    },
  },
  {
    version: 10,
    name: 'add-production-step-status',
    description: 'V0.4.3：新增 productionStepStatus 字段持久化做货流程各步骤的状态（步骤id→pending/in_progress/completed），使做货中状态下设置的生产流程内容可保存',
    up: async (db: any) => {
      await db.exec(`ALTER TABLE quotes ADD COLUMN productionStepStatus LONGTEXT`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN productionStepStatus`)
    },
  },
  {
    version: 11,
    name: 'add-operation-logs',
    description: 'V0.5.1：新增操作日志表，记录所有删除操作（成功和被阻止），包含操作人、时间、数据ID、操作结果等',
    up: async (db: any) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS operation_logs (
          id INT AUTO_INCREMENT PRIMARY KEY,
          operation_type VARCHAR(50) NOT NULL DEFAULT 'delete',
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(255) NOT NULL,
          entity_name VARCHAR(255) DEFAULT '',
          operator VARCHAR(255) DEFAULT 'unknown',
          result VARCHAR(20) NOT NULL DEFAULT 'success',
          blocked_reason TEXT,
          ip_address VARCHAR(45) DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX idx_operation_logs_entity ON operation_logs(entity_type, entity_id);
        CREATE INDEX idx_operation_logs_created ON operation_logs(created_at DESC);
      `)
    },
    down: async (db: any) => {
      await db.exec(`DROP TABLE IF EXISTS operation_logs`)
    },
  },
  {
    version: 12,
    name: 'add-auth-rbac',
    description: 'V0.6：新增 RBAC 用户认证与权限管理系统（users/roles/permissions/role_permissions/user_roles 表），预置权限目录、admin 角色、默认管理员账号',
    up: async (db: any) => {
      // 1. 创建 5 张表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL DEFAULT '',
          phone VARCHAR(64) DEFAULT '',
          status TINYINT NOT NULL DEFAULT 1,
          last_login_at DATETIME DEFAULT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE INDEX idx_users_email (email)
        );

        CREATE TABLE IF NOT EXISTS roles (
          id VARCHAR(64) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(64) NOT NULL,
          description VARCHAR(500) DEFAULT '',
          is_system TINYINT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE INDEX idx_roles_code (code)
        );

        CREATE TABLE IF NOT EXISTS permissions (
          id VARCHAR(64) PRIMARY KEY,
          code VARCHAR(128) NOT NULL,
          name VARCHAR(255) NOT NULL,
          module VARCHAR(64) NOT NULL,
          action VARCHAR(64) NOT NULL,
          type VARCHAR(20) NOT NULL DEFAULT 'button',
          description VARCHAR(500) DEFAULT '',
          sort_order INT NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          UNIQUE INDEX idx_permissions_code (code),
          INDEX idx_permissions_module (module)
        );

        CREATE TABLE IF NOT EXISTS role_permissions (
          role_id VARCHAR(64) NOT NULL,
          permission_id VARCHAR(64) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (role_id, permission_id),
          INDEX idx_role_permissions_perm (permission_id)
        );

        CREATE TABLE IF NOT EXISTS user_roles (
          user_id VARCHAR(64) NOT NULL,
          role_id VARCHAR(64) NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, role_id),
          INDEX idx_user_roles_role (role_id)
        );
      `)

      // 2. 预置权限目录
      const permissions = [
        { id: 'perm-dashboard-view', code: 'dashboard:view', name: '仪表盘', module: 'dashboard', action: 'view', type: 'menu', sort: 1 },
        { id: 'perm-quotes-view', code: 'quotes:view', name: '订单-查看菜单', module: 'quotes', action: 'view', type: 'menu', sort: 10 },
        { id: 'perm-quotes-create', code: 'quotes:create', name: '订单-新增', module: 'quotes', action: 'create', type: 'button', sort: 11 },
        { id: 'perm-quotes-edit', code: 'quotes:edit', name: '订单-编辑', module: 'quotes', action: 'edit', type: 'button', sort: 12 },
        { id: 'perm-quotes-delete', code: 'quotes:delete', name: '订单-删除', module: 'quotes', action: 'delete', type: 'button', sort: 13 },
        { id: 'perm-quotes-copy', code: 'quotes:copy', name: '订单-复制', module: 'quotes', action: 'copy', type: 'button', sort: 14 },
        { id: 'perm-quotes-export', code: 'quotes:export', name: '订单-导出', module: 'quotes', action: 'export', type: 'button', sort: 15 },
        { id: 'perm-quotes-print', code: 'quotes:print', name: '订单-打印', module: 'quotes', action: 'print', type: 'button', sort: 16 },
        { id: 'perm-quotes-status', code: 'quotes:status-transition', name: '订单-状态流转', module: 'quotes', action: 'status-transition', type: 'button', sort: 17 },
        { id: 'perm-quotes-table-view', code: 'quotes-table:view', name: '订单表格版-查看', module: 'quotes-table', action: 'view', type: 'menu', sort: 20 },
        { id: 'perm-quotes-wps-view', code: 'quotes-wps:view', name: '订单WPS版-查看', module: 'quotes-wps', action: 'view', type: 'menu', sort: 30 },
        { id: 'perm-process-costs-view', code: 'process-costs:view', name: '工艺成本-查看', module: 'process-costs', action: 'view', type: 'menu', sort: 40 },
        { id: 'perm-process-costs-create', code: 'process-costs:create', name: '工艺成本-新增', module: 'process-costs', action: 'create', type: 'button', sort: 41 },
        { id: 'perm-process-costs-edit', code: 'process-costs:edit', name: '工艺成本-编辑', module: 'process-costs', action: 'edit', type: 'button', sort: 42 },
        { id: 'perm-process-costs-delete', code: 'process-costs:delete', name: '工艺成本-删除', module: 'process-costs', action: 'delete', type: 'button', sort: 43 },
        { id: 'perm-customers-view', code: 'customers:view', name: '客户管理-查看', module: 'customers', action: 'view', type: 'menu', sort: 50 },
        { id: 'perm-customers-create', code: 'customers:create', name: '客户-新增', module: 'customers', action: 'create', type: 'button', sort: 51 },
        { id: 'perm-customers-edit', code: 'customers:edit', name: '客户-编辑', module: 'customers', action: 'edit', type: 'button', sort: 52 },
        { id: 'perm-customers-delete', code: 'customers:delete', name: '客户-删除', module: 'customers', action: 'delete', type: 'button', sort: 53 },
        { id: 'perm-products-view', code: 'products:view', name: '产品管理-查看', module: 'products', action: 'view', type: 'menu', sort: 60 },
        { id: 'perm-products-create', code: 'products:create', name: '产品-新增', module: 'products', action: 'create', type: 'button', sort: 61 },
        { id: 'perm-products-edit', code: 'products:edit', name: '产品-编辑', module: 'products', action: 'edit', type: 'button', sort: 62 },
        { id: 'perm-products-delete', code: 'products:delete', name: '产品-删除', module: 'products', action: 'delete', type: 'button', sort: 63 },
        { id: 'perm-tasks-view', code: 'tasks:view', name: '跟单任务-查看', module: 'tasks', action: 'view', type: 'menu', sort: 70 },
        { id: 'perm-tasks-create', code: 'tasks:create', name: '任务-新增', module: 'tasks', action: 'create', type: 'button', sort: 71 },
        { id: 'perm-tasks-edit', code: 'tasks:edit', name: '任务-编辑', module: 'tasks', action: 'edit', type: 'button', sort: 72 },
        { id: 'perm-tasks-delete', code: 'tasks:delete', name: '任务-删除', module: 'tasks', action: 'delete', type: 'button', sort: 73 },
        { id: 'perm-reports-view', code: 'reports:view', name: '报表统计-查看', module: 'reports', action: 'view', type: 'menu', sort: 80 },
        { id: 'perm-operation-logs-view', code: 'operation-logs:view', name: '操作日志-查看', module: 'operation-logs', action: 'view', type: 'menu', sort: 90 },
        { id: 'perm-users-view', code: 'users:view', name: '用户管理-查看', module: 'users', action: 'view', type: 'menu', sort: 100 },
        { id: 'perm-users-create', code: 'users:create', name: '用户-新增', module: 'users', action: 'create', type: 'button', sort: 101 },
        { id: 'perm-users-edit', code: 'users:edit', name: '用户-编辑', module: 'users', action: 'edit', type: 'button', sort: 102 },
        { id: 'perm-users-delete', code: 'users:delete', name: '用户-删除', module: 'users', action: 'delete', type: 'button', sort: 103 },
        { id: 'perm-roles-view', code: 'roles:view', name: '角色管理-查看', module: 'roles', action: 'view', type: 'menu', sort: 110 },
        { id: 'perm-roles-create', code: 'roles:create', name: '角色-新增', module: 'roles', action: 'create', type: 'button', sort: 111 },
        { id: 'perm-roles-edit', code: 'roles:edit', name: '角色-编辑', module: 'roles', action: 'edit', type: 'button', sort: 112 },
        { id: 'perm-roles-delete', code: 'roles:delete', name: '角色-删除', module: 'roles', action: 'delete', type: 'button', sort: 113 },
        { id: 'perm-system-admin', code: 'system:admin', name: '系统管理员特权', module: 'system', action: 'admin', type: 'button', sort: 200 },
      ]
      const permStmt = db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const p of permissions) {
        await permStmt.run(p.id, p.code, p.name, p.module, p.action, p.type, '', p.sort)
      }

      // 3. 预置 admin 角色
      await db.prepare(
        'INSERT IGNORE INTO roles (id, name, code, description, is_system) VALUES (?, ?, ?, ?, ?)'
      ).run('role-admin', '系统管理员', 'admin', '拥有系统全部权限的内置管理员角色', 1)

      // 4. 给 admin 角色分配全部权限
      const allPerms = await db.prepare('SELECT id FROM permissions').all() as { id: string }[]
      const rpStmt = db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      )
      for (const p of allPerms) {
        await rpStmt.run('role-admin', p.id)
      }

      // 5. 预置默认管理员账号
      const bcrypt = await import('bcryptjs')
      const defaultPassword = process.env.ADMIN_DEFAULT_PASSWORD || '123456'
      const passwordHash = bcrypt.hashSync(defaultPassword, 10)
      await db.prepare(
        'INSERT IGNORE INTO users (id, email, password_hash, name, status) VALUES (?, ?, ?, ?, ?)'
      ).run('user-admin-default', '517290808@qq.com', passwordHash, '管理员', 1)

      // 6. 给默认管理员账号分配 admin 角色
      await db.prepare(
        'INSERT IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)'
      ).run('user-admin-default', 'role-admin')
    },
    down: async (db: any) => {
      await db.exec(`
        DROP TABLE IF EXISTS user_roles;
        DROP TABLE IF EXISTS role_permissions;
        DROP TABLE IF EXISTS permissions;
        DROP TABLE IF EXISTS roles;
        DROP TABLE IF EXISTS users;
      `)
    },
  },
  {
    version: 13,
    name: 'add-quote-history-triggers',
    description: 'V0.7：新增订单数据修改历史记录表（quote_history）及 INSERT/UPDATE/DELETE 触发器，自动捕获订单业务字段变更（旧值/新值/变更字段列表），操作人优先取 @app_operator 会话变量，回退到数据库用户',
    up: async (db: any) => {
      // 1. 创建历史记录表
      await db.exec(`
        CREATE TABLE IF NOT EXISTS quote_history (
          id BIGINT NOT NULL AUTO_INCREMENT,
          quote_id VARCHAR(64) NOT NULL,
          action VARCHAR(20) NOT NULL,
          old_values LONGTEXT,
          new_values LONGTEXT,
          changed_fields VARCHAR(2000),
          operator VARCHAR(255) NOT NULL DEFAULT '',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_quote_history_quote_id (quote_id),
          KEY idx_quote_history_created_at (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `)

      // 2. 审计追踪的业务字段
      //    排除：id（主键）、created_at/updated_at（元数据，每次写入都变）
      //    排除：6 个 LONGTEXT 大字段（images/tableData/removedFormulaAddresses/modifiedFormulas/allFormulas/productionStepStatus），
      //          避免历史表膨胀；这些字段的变更不进入 old_values/new_values 快照
      const TRACKED_FIELDS = [
        'user_id', 'customer_id', 'quote_number', 'customerName', 'shippingAddress',
        'productStyle', 'productSpec', 'fabricMaterial', 'process', 'handleMaterial',
        'handleSpec', 'quantity', 'boxSpec', 'remark', 'sampleFee', 'sampleDays',
        'massDays', 'unitPrice', 'productionTimeStart', 'productionTimeEnd',
        'sellPriceNoTax', 'sellPriceWithTax', 'status', 'quoteTime', 'sampleTime',
        'productionStartTime', 'shippingTime', 'paymentTime', 'endTime',
        'costPrice', 'priceWithTax',
      ]
      const oldJson = TRACKED_FIELDS.map((f) => `'${f}', OLD.\`${f}\``).join(', ')
      const newJson = TRACKED_FIELDS.map((f) => `'${f}', NEW.\`${f}\``).join(', ')
      // CONCAT_WS 自动跳过 NULL 参数；所有追踪字段均未变时返回空串
      const changedExpr = TRACKED_FIELDS
        .map((f) => `IF(NOT(OLD.\`${f}\` <=> NEW.\`${f}\`), '${f}', NULL)`)
        .join(', ')

      // 3. 创建触发器：单语句触发体（无内部分号），兼容 execMultiStatement 按分号拆分
      //    operator 优先读取应用层 @app_operator 会话变量，回退到 CURRENT_USER()
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_insert`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_insert AFTER INSERT ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'insert', NULL, JSON_OBJECT(${newJson}), NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_update`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_update AFTER UPDATE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'update', JSON_OBJECT(${oldJson}), JSON_OBJECT(${newJson}), CONCAT_WS(',', ${changedExpr}), COALESCE(@app_operator, CURRENT_USER()))
      `)

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_delete`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_delete AFTER DELETE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (OLD.id, 'delete', JSON_OBJECT(${oldJson}), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)
    },
    down: async (db: any) => {
      await db.exec(`
        DROP TRIGGER IF EXISTS quotes_audit_insert
      `)
      await db.exec(`
        DROP TRIGGER IF EXISTS quotes_audit_update
      `)
      await db.exec(`
        DROP TRIGGER IF EXISTS quotes_audit_delete
      `)
      await db.exec(`
        DROP TABLE IF EXISTS quote_history
      `)
    },
  },
  {
    version: 14,
    name: 'add-sample-completed-status',
    description: 'V0.8：新增打样完成状态(7)及 sampleCompletedTime 字段，重构状态流转为指针模式；更新审计触发器追踪新字段',
    up: async (db: any) => {
      // 1. 新增 sampleCompletedTime 字段（打样完成时间节点）
      await db.exec(`ALTER TABLE quotes ADD COLUMN sampleCompletedTime VARCHAR(64) DEFAULT '' AFTER sampleTime`)

      // 2. 更新审计触发器：将 sampleCompletedTime 加入追踪字段列表
      //    需要先 DROP 旧触发器，再用包含新字段的 TRACKED_FIELDS 重建
      const TRACKED_FIELDS = [
        'user_id', 'customer_id', 'quote_number', 'customerName', 'shippingAddress',
        'productStyle', 'productSpec', 'fabricMaterial', 'process', 'handleMaterial',
        'handleSpec', 'quantity', 'boxSpec', 'remark', 'sampleFee', 'sampleDays',
        'massDays', 'unitPrice', 'productionTimeStart', 'productionTimeEnd',
        'sellPriceNoTax', 'sellPriceWithTax', 'status', 'quoteTime', 'sampleTime',
        'sampleCompletedTime', 'productionStartTime', 'shippingTime', 'paymentTime', 'endTime',
        'costPrice', 'priceWithTax',
      ]
      const newJson = TRACKED_FIELDS.map((f) => `'${f}', NEW.\`${f}\``).join(', ')
      const changedExpr = TRACKED_FIELDS
        .map((f) => `IF(NOT(OLD.\`${f}\` <=> NEW.\`${f}\`), '${f}', NULL)`)
        .join(', ')

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_insert`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_insert AFTER INSERT ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'insert', NULL, JSON_OBJECT(${newJson}), NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_update`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_update AFTER UPDATE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'update',
          JSON_OBJECT(${TRACKED_FIELDS.map((f) => `'${f}', OLD.\`${f}\``).join(', ')}),
          JSON_OBJECT(${newJson}),
          CONCAT_WS(',', ${changedExpr}),
          COALESCE(@app_operator, CURRENT_USER()))
      `)

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_delete`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_delete AFTER DELETE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (OLD.id, 'delete', JSON_OBJECT(${TRACKED_FIELDS.map((f) => `'${f}', OLD.\`${f}\``).join(', ')}), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)
    },
    down: async (db: any) => {
      // 恢复旧触发器（不含 sampleCompletedTime）
      const OLD_TRACKED_FIELDS = [
        'user_id', 'customer_id', 'quote_number', 'customerName', 'shippingAddress',
        'productStyle', 'productSpec', 'fabricMaterial', 'process', 'handleMaterial',
        'handleSpec', 'quantity', 'boxSpec', 'remark', 'sampleFee', 'sampleDays',
        'massDays', 'unitPrice', 'productionTimeStart', 'productionTimeEnd',
        'sellPriceNoTax', 'sellPriceWithTax', 'status', 'quoteTime', 'sampleTime',
        'productionStartTime', 'shippingTime', 'paymentTime', 'endTime',
        'costPrice', 'priceWithTax',
      ]
      const oldJson = OLD_TRACKED_FIELDS.map((f) => `'${f}', NEW.\`${f}\``).join(', ')
      const oldChangedExpr = OLD_TRACKED_FIELDS
        .map((f) => `IF(NOT(OLD.\`${f}\` <=> NEW.\`${f}\`), '${f}', NULL)`)
        .join(', ')

      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_insert`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_insert AFTER INSERT ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'insert', NULL, JSON_OBJECT(${oldJson}), NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_update`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_update AFTER UPDATE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'update',
          JSON_OBJECT(${OLD_TRACKED_FIELDS.map((f) => `'${f}', OLD.\`${f}\``).join(', ')}),
          JSON_OBJECT(${oldJson}),
          CONCAT_WS(',', ${oldChangedExpr}),
          COALESCE(@app_operator, CURRENT_USER()))
      `)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_delete`)
      await db.exec(`
        CREATE TRIGGER quotes_audit_delete AFTER DELETE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (OLD.id, 'delete', JSON_OBJECT(${OLD_TRACKED_FIELDS.map((f) => `'${f}', OLD.\`${f}\``).join(', ')}), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()))
      `)

      // 删除 sampleCompletedTime 字段
      await db.exec(`ALTER TABLE quotes DROP COLUMN sampleCompletedTime`)
    },
  },
  {
    version: 15,
    name: 'add-payment-export-permission',
    description: 'V0.9：新增 quotes:export-payment 权限（导出收款单），并分配给 admin 角色',
    up: async (db: any) => {
      // 1. 新增权限（幂等）
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-quotes-export-payment',
        'quotes:export-payment',
        '订单-导出收款单',
        'quotes',
        'export-payment',
        'button',
        '导出已发货未收款订单的收款单（Excel/ZIP）',
        18,
      )

      // 2. 分配给 admin 角色（幂等）
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-quotes-export-payment')
    },
    down: async (db: any) => {
      // 先删角色关联，再删权限（避免外键约束）
      await db.prepare('DELETE FROM role_permissions WHERE permission_id = ?').run('perm-quotes-export-payment')
      await db.prepare('DELETE FROM permissions WHERE id = ?').run('perm-quotes-export-payment')
    },
  },
  {
    version: 16,
    name: 'add-created-by-updated-by',
    description: 'V0.9：quotes表新增 created_by 和 updated_by 字段，记录创建人和修改人',
    up: async (db: any) => {
      // 幂等：MySQL DDL（ALTER TABLE）隐式提交，事务回滚无法撤销已添加的列，
      // 迁移中途失败再重试会因列已存在而报 "Duplicate column name"。
      // 故先通过 information_schema 检查列是否存在，再决定是否 ADD。
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (!(await hasColumn('created_by'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN created_by VARCHAR(64) DEFAULT '' AFTER user_id`)
      }
      if (!(await hasColumn('updated_by'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN updated_by VARCHAR(64) DEFAULT '' AFTER created_by`)
      }
    },
    down: async (db: any) => {
      // 幂等：DROP COLUMN 不存在会报错，先检查再删
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('updated_by')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN updated_by`)
      }
      if (await hasColumn('created_by')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN created_by`)
      }
    },
  },
  {
    version: 17,
    name: 'add-payment-fields',
    description: 'V0.10：quotes表新增收款相关字段（实际收取打样费、打样费抵扣大货、收取定金、待收总金额）',
    up: async (db: any) => {
      // 幂等：先检查列是否存在再 ADD（ALTER TABLE 隐式提交，失败重试会报 Duplicate column）
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (!(await hasColumn('actualSampleFee'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN actualSampleFee DECIMAL(12,2) DEFAULT 0 AFTER sellPriceWithTax`)
      }
      if (!(await hasColumn('sampleFeeDeduct'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN sampleFeeDeduct TINYINT(1) DEFAULT 0 AFTER actualSampleFee`)
      }
      if (!(await hasColumn('deposit'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN deposit DECIMAL(12,2) DEFAULT 0 AFTER sampleFeeDeduct`)
      }
      if (!(await hasColumn('pendingAmount'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN pendingAmount DECIMAL(12,2) DEFAULT 0 AFTER deposit`)
      }
      // 重建审计触发器以追踪 4 个新收款字段（36 个业务字段）
      // 触发器已存在时 DROP TRIGGER IF EXISTS 保证幂等
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_insert`)
      await db.exec(`CREATE TRIGGER quotes_audit_insert AFTER INSERT ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'insert', NULL, JSON_OBJECT('user_id', NEW.user_id, 'customer_id', NEW.customer_id, 'quote_number', NEW.quote_number, 'customerName', NEW.customerName, 'shippingAddress', NEW.shippingAddress, 'productStyle', NEW.productStyle, 'productSpec', NEW.productSpec, 'fabricMaterial', NEW.fabricMaterial, 'process', NEW.process, 'handleMaterial', NEW.handleMaterial, 'handleSpec', NEW.handleSpec, 'quantity', NEW.quantity, 'boxSpec', NEW.boxSpec, 'remark', NEW.remark, 'sampleFee', NEW.sampleFee, 'sampleDays', NEW.sampleDays, 'massDays', NEW.massDays, 'unitPrice', NEW.unitPrice, 'productionTimeStart', NEW.productionTimeStart, 'productionTimeEnd', NEW.productionTimeEnd, 'sellPriceNoTax', NEW.sellPriceNoTax, 'sellPriceWithTax', NEW.sellPriceWithTax, 'actualSampleFee', NEW.actualSampleFee, 'sampleFeeDeduct', NEW.sampleFeeDeduct, 'deposit', NEW.deposit, 'pendingAmount', NEW.pendingAmount, 'status', NEW.status, 'quoteTime', NEW.quoteTime, 'sampleTime', NEW.sampleTime, 'sampleCompletedTime', NEW.sampleCompletedTime, 'productionStartTime', NEW.productionStartTime, 'shippingTime', NEW.shippingTime, 'paymentTime', NEW.paymentTime, 'endTime', NEW.endTime, 'costPrice', NEW.costPrice, 'priceWithTax', NEW.priceWithTax), NULL, COALESCE(@app_operator, CURRENT_USER()))`)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_update`)
      await db.exec(`CREATE TRIGGER quotes_audit_update AFTER UPDATE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'update', JSON_OBJECT('user_id', OLD.user_id, 'customer_id', OLD.customer_id, 'quote_number', OLD.quote_number, 'customerName', OLD.customerName, 'shippingAddress', OLD.shippingAddress, 'productStyle', OLD.productStyle, 'productSpec', OLD.productSpec, 'fabricMaterial', OLD.fabricMaterial, 'process', OLD.process, 'handleMaterial', OLD.handleMaterial, 'handleSpec', OLD.handleSpec, 'quantity', OLD.quantity, 'boxSpec', OLD.boxSpec, 'remark', OLD.remark, 'sampleFee', OLD.sampleFee, 'sampleDays', OLD.sampleDays, 'massDays', OLD.massDays, 'unitPrice', OLD.unitPrice, 'productionTimeStart', OLD.productionTimeStart, 'productionTimeEnd', OLD.productionTimeEnd, 'sellPriceNoTax', OLD.sellPriceNoTax, 'sellPriceWithTax', OLD.sellPriceWithTax, 'actualSampleFee', OLD.actualSampleFee, 'sampleFeeDeduct', OLD.sampleFeeDeduct, 'deposit', OLD.deposit, 'pendingAmount', OLD.pendingAmount, 'status', OLD.status, 'quoteTime', OLD.quoteTime, 'sampleTime', OLD.sampleTime, 'sampleCompletedTime', OLD.sampleCompletedTime, 'productionStartTime', OLD.productionStartTime, 'shippingTime', OLD.shippingTime, 'paymentTime', OLD.paymentTime, 'endTime', OLD.endTime, 'costPrice', OLD.costPrice, 'priceWithTax', OLD.priceWithTax), JSON_OBJECT('user_id', NEW.user_id, 'customer_id', NEW.customer_id, 'quote_number', NEW.quote_number, 'customerName', NEW.customerName, 'shippingAddress', NEW.shippingAddress, 'productStyle', NEW.productStyle, 'productSpec', NEW.productSpec, 'fabricMaterial', NEW.fabricMaterial, 'process', NEW.process, 'handleMaterial', NEW.handleMaterial, 'handleSpec', NEW.handleSpec, 'quantity', NEW.quantity, 'boxSpec', NEW.boxSpec, 'remark', NEW.remark, 'sampleFee', NEW.sampleFee, 'sampleDays', NEW.sampleDays, 'massDays', NEW.massDays, 'unitPrice', NEW.unitPrice, 'productionTimeStart', NEW.productionTimeStart, 'productionTimeEnd', NEW.productionTimeEnd, 'sellPriceNoTax', NEW.sellPriceNoTax, 'sellPriceWithTax', NEW.sellPriceWithTax, 'actualSampleFee', NEW.actualSampleFee, 'sampleFeeDeduct', NEW.sampleFeeDeduct, 'deposit', NEW.deposit, 'pendingAmount', NEW.pendingAmount, 'status', NEW.status, 'quoteTime', NEW.quoteTime, 'sampleTime', NEW.sampleTime, 'sampleCompletedTime', NEW.sampleCompletedTime, 'productionStartTime', NEW.productionStartTime, 'shippingTime', NEW.shippingTime, 'paymentTime', NEW.paymentTime, 'endTime', NEW.endTime, 'costPrice', NEW.costPrice, 'priceWithTax', NEW.priceWithTax), CONCAT_WS(',', IF(NOT(OLD.user_id <=> NEW.user_id), 'user_id', NULL), IF(NOT(OLD.customer_id <=> NEW.customer_id), 'customer_id', NULL), IF(NOT(OLD.quote_number <=> NEW.quote_number), 'quote_number', NULL), IF(NOT(OLD.customerName <=> NEW.customerName), 'customerName', NULL), IF(NOT(OLD.shippingAddress <=> NEW.shippingAddress), 'shippingAddress', NULL), IF(NOT(OLD.productStyle <=> NEW.productStyle), 'productStyle', NULL), IF(NOT(OLD.productSpec <=> NEW.productSpec), 'productSpec', NULL), IF(NOT(OLD.fabricMaterial <=> NEW.fabricMaterial), 'fabricMaterial', NULL), IF(NOT(OLD.process <=> NEW.process), 'process', NULL), IF(NOT(OLD.handleMaterial <=> NEW.handleMaterial), 'handleMaterial', NULL), IF(NOT(OLD.handleSpec <=> NEW.handleSpec), 'handleSpec', NULL), IF(NOT(OLD.quantity <=> NEW.quantity), 'quantity', NULL), IF(NOT(OLD.boxSpec <=> NEW.boxSpec), 'boxSpec', NULL), IF(NOT(OLD.remark <=> NEW.remark), 'remark', NULL), IF(NOT(OLD.sampleFee <=> NEW.sampleFee), 'sampleFee', NULL), IF(NOT(OLD.sampleDays <=> NEW.sampleDays), 'sampleDays', NULL), IF(NOT(OLD.massDays <=> NEW.massDays), 'massDays', NULL), IF(NOT(OLD.unitPrice <=> NEW.unitPrice), 'unitPrice', NULL), IF(NOT(OLD.productionTimeStart <=> NEW.productionTimeStart), 'productionTimeStart', NULL), IF(NOT(OLD.productionTimeEnd <=> NEW.productionTimeEnd), 'productionTimeEnd', NULL), IF(NOT(OLD.sellPriceNoTax <=> NEW.sellPriceNoTax), 'sellPriceNoTax', NULL), IF(NOT(OLD.sellPriceWithTax <=> NEW.sellPriceWithTax), 'sellPriceWithTax', NULL), IF(NOT(OLD.actualSampleFee <=> NEW.actualSampleFee), 'actualSampleFee', NULL), IF(NOT(OLD.sampleFeeDeduct <=> NEW.sampleFeeDeduct), 'sampleFeeDeduct', NULL), IF(NOT(OLD.deposit <=> NEW.deposit), 'deposit', NULL), IF(NOT(OLD.pendingAmount <=> NEW.pendingAmount), 'pendingAmount', NULL), IF(NOT(OLD.status <=> NEW.status), 'status', NULL), IF(NOT(OLD.quoteTime <=> NEW.quoteTime), 'quoteTime', NULL), IF(NOT(OLD.sampleTime <=> NEW.sampleTime), 'sampleTime', NULL), IF(NOT(OLD.sampleCompletedTime <=> NEW.sampleCompletedTime), 'sampleCompletedTime', NULL), IF(NOT(OLD.productionStartTime <=> NEW.productionStartTime), 'productionStartTime', NULL), IF(NOT(OLD.shippingTime <=> NEW.shippingTime), 'shippingTime', NULL), IF(NOT(OLD.paymentTime <=> NEW.paymentTime), 'paymentTime', NULL), IF(NOT(OLD.endTime <=> NEW.endTime), 'endTime', NULL), IF(NOT(OLD.costPrice <=> NEW.costPrice), 'costPrice', NULL), IF(NOT(OLD.priceWithTax <=> NEW.priceWithTax), 'priceWithTax', NULL)), COALESCE(@app_operator, CURRENT_USER()))`)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_delete`)
      await db.exec(`CREATE TRIGGER quotes_audit_delete AFTER DELETE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (OLD.id, 'delete', JSON_OBJECT('user_id', OLD.user_id, 'customer_id', OLD.customer_id, 'quote_number', OLD.quote_number, 'customerName', OLD.customerName, 'shippingAddress', OLD.shippingAddress, 'productStyle', OLD.productStyle, 'productSpec', OLD.productSpec, 'fabricMaterial', OLD.fabricMaterial, 'process', OLD.process, 'handleMaterial', OLD.handleMaterial, 'handleSpec', OLD.handleSpec, 'quantity', OLD.quantity, 'boxSpec', OLD.boxSpec, 'remark', OLD.remark, 'sampleFee', OLD.sampleFee, 'sampleDays', OLD.sampleDays, 'massDays', OLD.massDays, 'unitPrice', OLD.unitPrice, 'productionTimeStart', OLD.productionTimeStart, 'productionTimeEnd', OLD.productionTimeEnd, 'sellPriceNoTax', OLD.sellPriceNoTax, 'sellPriceWithTax', OLD.sellPriceWithTax, 'actualSampleFee', OLD.actualSampleFee, 'sampleFeeDeduct', OLD.sampleFeeDeduct, 'deposit', OLD.deposit, 'pendingAmount', OLD.pendingAmount, 'status', OLD.status, 'quoteTime', OLD.quoteTime, 'sampleTime', OLD.sampleTime, 'sampleCompletedTime', OLD.sampleCompletedTime, 'productionStartTime', OLD.productionStartTime, 'shippingTime', OLD.shippingTime, 'paymentTime', OLD.paymentTime, 'endTime', OLD.endTime, 'costPrice', OLD.costPrice, 'priceWithTax', OLD.priceWithTax), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()))`)
    },
    down: async (db: any) => {
      // 幂等：先检查列是否存在再 DROP
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('pendingAmount')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN pendingAmount`)
      }
      if (await hasColumn('deposit')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN deposit`)
      }
      if (await hasColumn('sampleFeeDeduct')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN sampleFeeDeduct`)
      }
      if (await hasColumn('actualSampleFee')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN actualSampleFee`)
      }
      // 恢复 v16 版审计触发器（不含 4 个收款字段）
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_insert`)
      await db.exec(`CREATE TRIGGER quotes_audit_insert AFTER INSERT ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'insert', NULL, JSON_OBJECT('user_id', NEW.user_id, 'customer_id', NEW.customer_id, 'quote_number', NEW.quote_number, 'customerName', NEW.customerName, 'shippingAddress', NEW.shippingAddress, 'productStyle', NEW.productStyle, 'productSpec', NEW.productSpec, 'fabricMaterial', NEW.fabricMaterial, 'process', NEW.process, 'handleMaterial', NEW.handleMaterial, 'handleSpec', NEW.handleSpec, 'quantity', NEW.quantity, 'boxSpec', NEW.boxSpec, 'remark', NEW.remark, 'sampleFee', NEW.sampleFee, 'sampleDays', NEW.sampleDays, 'massDays', NEW.massDays, 'unitPrice', NEW.unitPrice, 'productionTimeStart', NEW.productionTimeStart, 'productionTimeEnd', NEW.productionTimeEnd, 'sellPriceNoTax', NEW.sellPriceNoTax, 'sellPriceWithTax', NEW.sellPriceWithTax, 'status', NEW.status, 'quoteTime', NEW.quoteTime, 'sampleTime', NEW.sampleTime, 'sampleCompletedTime', NEW.sampleCompletedTime, 'productionStartTime', NEW.productionStartTime, 'shippingTime', NEW.shippingTime, 'paymentTime', NEW.paymentTime, 'endTime', NEW.endTime, 'costPrice', NEW.costPrice, 'priceWithTax', NEW.priceWithTax), NULL, COALESCE(@app_operator, CURRENT_USER()))`)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_update`)
      await db.exec(`CREATE TRIGGER quotes_audit_update AFTER UPDATE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (NEW.id, 'update', JSON_OBJECT('user_id', OLD.user_id, 'customer_id', OLD.customer_id, 'quote_number', OLD.quote_number, 'customerName', OLD.customerName, 'shippingAddress', OLD.shippingAddress, 'productStyle', OLD.productStyle, 'productSpec', OLD.productSpec, 'fabricMaterial', OLD.fabricMaterial, 'process', OLD.process, 'handleMaterial', OLD.handleMaterial, 'handleSpec', OLD.handleSpec, 'quantity', OLD.quantity, 'boxSpec', OLD.boxSpec, 'remark', OLD.remark, 'sampleFee', OLD.sampleFee, 'sampleDays', OLD.sampleDays, 'massDays', OLD.massDays, 'unitPrice', OLD.unitPrice, 'productionTimeStart', OLD.productionTimeStart, 'productionTimeEnd', OLD.productionTimeEnd, 'sellPriceNoTax', OLD.sellPriceNoTax, 'sellPriceWithTax', OLD.sellPriceWithTax, 'status', OLD.status, 'quoteTime', OLD.quoteTime, 'sampleTime', OLD.sampleTime, 'sampleCompletedTime', OLD.sampleCompletedTime, 'productionStartTime', OLD.productionStartTime, 'shippingTime', OLD.shippingTime, 'paymentTime', OLD.paymentTime, 'endTime', OLD.endTime, 'costPrice', OLD.costPrice, 'priceWithTax', OLD.priceWithTax), JSON_OBJECT('user_id', NEW.user_id, 'customer_id', NEW.customer_id, 'quote_number', NEW.quote_number, 'customerName', NEW.customerName, 'shippingAddress', NEW.shippingAddress, 'productStyle', NEW.productStyle, 'productSpec', NEW.productSpec, 'fabricMaterial', NEW.fabricMaterial, 'process', NEW.process, 'handleMaterial', NEW.handleMaterial, 'handleSpec', NEW.handleSpec, 'quantity', NEW.quantity, 'boxSpec', NEW.boxSpec, 'remark', NEW.remark, 'sampleFee', NEW.sampleFee, 'sampleDays', NEW.sampleDays, 'massDays', NEW.massDays, 'unitPrice', NEW.unitPrice, 'productionTimeStart', NEW.productionTimeStart, 'productionTimeEnd', NEW.productionTimeEnd, 'sellPriceNoTax', NEW.sellPriceNoTax, 'sellPriceWithTax', NEW.sellPriceWithTax, 'status', NEW.status, 'quoteTime', NEW.quoteTime, 'sampleTime', NEW.sampleTime, 'sampleCompletedTime', NEW.sampleCompletedTime, 'productionStartTime', NEW.productionStartTime, 'shippingTime', NEW.shippingTime, 'paymentTime', NEW.paymentTime, 'endTime', NEW.endTime, 'costPrice', NEW.costPrice, 'priceWithTax', NEW.priceWithTax), CONCAT_WS(',', IF(NOT(OLD.user_id <=> NEW.user_id), 'user_id', NULL), IF(NOT(OLD.customer_id <=> NEW.customer_id), 'customer_id', NULL), IF(NOT(OLD.quote_number <=> NEW.quote_number), 'quote_number', NULL), IF(NOT(OLD.customerName <=> NEW.customerName), 'customerName', NULL), IF(NOT(OLD.shippingAddress <=> NEW.shippingAddress), 'shippingAddress', NULL), IF(NOT(OLD.productStyle <=> NEW.productStyle), 'productStyle', NULL), IF(NOT(OLD.productSpec <=> NEW.productSpec), 'productSpec', NULL), IF(NOT(OLD.fabricMaterial <=> NEW.fabricMaterial), 'fabricMaterial', NULL), IF(NOT(OLD.process <=> NEW.process), 'process', NULL), IF(NOT(OLD.handleMaterial <=> NEW.handleMaterial), 'handleMaterial', NULL), IF(NOT(OLD.handleSpec <=> NEW.handleSpec), 'handleSpec', NULL), IF(NOT(OLD.quantity <=> NEW.quantity), 'quantity', NULL), IF(NOT(OLD.boxSpec <=> NEW.boxSpec), 'boxSpec', NULL), IF(NOT(OLD.remark <=> NEW.remark), 'remark', NULL), IF(NOT(OLD.sampleFee <=> NEW.sampleFee), 'sampleFee', NULL), IF(NOT(OLD.sampleDays <=> NEW.sampleDays), 'sampleDays', NULL), IF(NOT(OLD.massDays <=> NEW.massDays), 'massDays', NULL), IF(NOT(OLD.unitPrice <=> NEW.unitPrice), 'unitPrice', NULL), IF(NOT(OLD.productionTimeStart <=> NEW.productionTimeStart), 'productionTimeStart', NULL), IF(NOT(OLD.productionTimeEnd <=> NEW.productionTimeEnd), 'productionTimeEnd', NULL), IF(NOT(OLD.sellPriceNoTax <=> NEW.sellPriceNoTax), 'sellPriceNoTax', NULL), IF(NOT(OLD.sellPriceWithTax <=> NEW.sellPriceWithTax), 'sellPriceWithTax', NULL), IF(NOT(OLD.status <=> NEW.status), 'status', NULL), IF(NOT(OLD.quoteTime <=> NEW.quoteTime), 'quoteTime', NULL), IF(NOT(OLD.sampleTime <=> NEW.sampleTime), 'sampleTime', NULL), IF(NOT(OLD.sampleCompletedTime <=> NEW.sampleCompletedTime), 'sampleCompletedTime', NULL), IF(NOT(OLD.productionStartTime <=> NEW.productionStartTime), 'productionStartTime', NULL), IF(NOT(OLD.shippingTime <=> NEW.shippingTime), 'shippingTime', NULL), IF(NOT(OLD.paymentTime <=> NEW.paymentTime), 'paymentTime', NULL), IF(NOT(OLD.endTime <=> NEW.endTime), 'endTime', NULL), IF(NOT(OLD.costPrice <=> NEW.costPrice), 'costPrice', NULL), IF(NOT(OLD.priceWithTax <=> NEW.priceWithTax), 'priceWithTax', NULL)), COALESCE(@app_operator, CURRENT_USER()))`)
      await db.exec(`DROP TRIGGER IF EXISTS quotes_audit_delete`)
      await db.exec(`CREATE TRIGGER quotes_audit_delete AFTER DELETE ON quotes FOR EACH ROW
        INSERT INTO quote_history (quote_id, action, old_values, new_values, changed_fields, operator)
        VALUES (OLD.id, 'delete', JSON_OBJECT('user_id', OLD.user_id, 'customer_id', OLD.customer_id, 'quote_number', OLD.quote_number, 'customerName', OLD.customerName, 'shippingAddress', OLD.shippingAddress, 'productStyle', OLD.productStyle, 'productSpec', OLD.productSpec, 'fabricMaterial', OLD.fabricMaterial, 'process', OLD.process, 'handleMaterial', OLD.handleMaterial, 'handleSpec', OLD.handleSpec, 'quantity', OLD.quantity, 'boxSpec', OLD.boxSpec, 'remark', OLD.remark, 'sampleFee', OLD.sampleFee, 'sampleDays', OLD.sampleDays, 'massDays', OLD.massDays, 'unitPrice', OLD.unitPrice, 'productionTimeStart', OLD.productionTimeStart, 'productionTimeEnd', OLD.productionTimeEnd, 'sellPriceNoTax', OLD.sellPriceNoTax, 'sellPriceWithTax', OLD.sellPriceWithTax, 'status', OLD.status, 'quoteTime', OLD.quoteTime, 'sampleTime', OLD.sampleTime, 'sampleCompletedTime', OLD.sampleCompletedTime, 'productionStartTime', OLD.productionStartTime, 'shippingTime', OLD.shippingTime, 'paymentTime', OLD.paymentTime, 'endTime', OLD.endTime, 'costPrice', OLD.costPrice, 'priceWithTax', OLD.priceWithTax), NULL, NULL, COALESCE(@app_operator, CURRENT_USER()))`)
    },
  },
  {
    version: 18,
    name: 'add-receivable-sample-fee',
    description: 'V0.11：quotes表新增应收打样费字段（receivableSampleFee），待收总额计算公式调整',
    up: async (db: any) => {
      // 幂等：先检查列是否存在再 ADD（ALTER TABLE 隐式提交，失败重试会报 Duplicate column）
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (!(await hasColumn('receivableSampleFee'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN receivableSampleFee DECIMAL(12,2) DEFAULT 0 AFTER sellPriceWithTax`)
      }
    },
    down: async (db: any) => {
      // 幂等：先检查列是否存在再 DROP
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'quotes' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('receivableSampleFee')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN receivableSampleFee`)
      }
    },
  },
  {
    version: 19,
    name: 'add-sheet-templates',
    description: 'V0.12：新增在线表格模板表（sheet_templates）及管理权限，支持模板在线可视化编辑。内置模板作为兜底，数据库存储覆盖版本',
    up: async (db: any) => {
      // 1. 模板表（幂等：CREATE TABLE IF NOT EXISTS）
      await db.exec(`CREATE TABLE IF NOT EXISTS sheet_templates (
        id VARCHAR(64) PRIMARY KEY,
        style_code VARCHAR(8) NOT NULL COMMENT '款式 code（1-6）',
        name VARCHAR(64) NOT NULL DEFAULT '' COMMENT '款式名称',
        data LONGTEXT NOT NULL COMMENT '表格二维数据 JSON',
        formulas LONGTEXT NOT NULL COMMENT '公式映射 JSON',
        updated_by VARCHAR(64) DEFAULT '' COMMENT '最后修改人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_style_code (style_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='在线表格模板（数据库覆盖版本，前端内置模板为兜底）'`)

      // 2. 新增权限（幂等）
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-sheet-templates-view',
        'sheet-templates:view',
        '模板管理-查看',
        'sheet-templates',
        'view',
        'menu',
        '查看在线表格模板管理页面',
        19,
      )
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-sheet-templates-edit',
        'sheet-templates:edit',
        '模板管理-编辑',
        'sheet-templates',
        'edit',
        'button',
        '编辑并保存在线表格模板',
        20,
      )

      // 3. 分配给 admin 角色（幂等）
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-sheet-templates-view')
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-sheet-templates-edit')
    },
    down: async (db: any) => {
      // 先删角色关联，再删权限，最后删表（避免外键约束）
      await db.prepare('DELETE FROM role_permissions WHERE permission_id IN (?, ?)').run('perm-sheet-templates-view', 'perm-sheet-templates-edit')
      await db.prepare('DELETE FROM permissions WHERE id IN (?, ?)').run('perm-sheet-templates-view', 'perm-sheet-templates-edit')
      await db.exec(`DROP TABLE IF EXISTS sheet_templates`)
    },
  },
  {
    version: 20,
    name: 'add-order-templates',
    description: 'V0.13：新增订单模板表（order_templates）及管理权限，支持将订单信息保存为可复用模板。与款式模板（sheet_templates）数据结构相互独立',
    up: async (db: any) => {
      // 1. 新增订单模板表（幂等）
      await db.exec(`CREATE TABLE IF NOT EXISTS order_templates (
        id VARCHAR(64) NOT NULL COMMENT '模板ID',
        name VARCHAR(128) NOT NULL COMMENT '模板名称',
        order_data LONGTEXT NOT NULL COMMENT '订单信息快照 JSON（款式/材质/工艺/价格等可复用字段）',
        created_by VARCHAR(64) DEFAULT '' COMMENT '创建人',
        updated_by VARCHAR(64) DEFAULT '' COMMENT '最后修改人',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单模板（可复用的订单信息快照）'`)

      // 2. 新增权限（幂等）
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-order-templates-view',
        'order-templates:view',
        '订单模板-查看',
        'order-templates',
        'view',
        'menu',
        '查看订单模板管理页面',
        21,
      )
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-order-templates-edit',
        'order-templates:edit',
        '订单模板-编辑',
        'order-templates',
        'edit',
        'button',
        '保存/编辑/重命名/删除订单模板',
        22,
      )

      // 3. 分配给 admin 角色（幂等）
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-order-templates-view')
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-order-templates-edit')
    },
    down: async (db: any) => {
      // 先删角色关联，再删权限，最后删表（避免外键约束）
      await db.prepare('DELETE FROM role_permissions WHERE permission_id IN (?, ?)').run('perm-order-templates-view', 'perm-order-templates-edit')
      await db.prepare('DELETE FROM permissions WHERE id IN (?, ?)').run('perm-order-templates-view', 'perm-order-templates-edit')
      await db.exec(`DROP TABLE IF EXISTS order_templates`)
    },
  },
  {
    version: 21,
    name: 'add-user-tags-notes',
    description: 'V0.13.1：users表新增 tags（用户标签）和 notes（用户备注）字段',
    up: async (db: any) => {
      // 幂等：MySQL DDL（ALTER TABLE）隐式提交，先通过 information_schema 检查列是否存在再 ADD
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (!(await hasColumn('tags'))) {
        await db.exec(`ALTER TABLE users ADD COLUMN tags VARCHAR(500) AFTER phone`)
      }
      if (!(await hasColumn('notes'))) {
        await db.exec(`ALTER TABLE users ADD COLUMN notes TEXT AFTER tags`)
      }
    },
    down: async (db: any) => {
      // 幂等：DROP COLUMN 不存在会报错，先检查再删
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('notes')) {
        await db.exec(`ALTER TABLE users DROP COLUMN notes`)
      }
      if (await hasColumn('tags')) {
        await db.exec(`ALTER TABLE users DROP COLUMN tags`)
      }
    },
  },
  {
    version: 22,
    name: 'add-customer-tags-remark',
    description: 'V0.14：customers表新增 tags（客户标签，JSON数组字符串）和 remark（备注）字段',
    up: async (db: any) => {
      // 幂等：MySQL DDL（ALTER TABLE）隐式提交，先通过 information_schema 检查列是否存在再 ADD
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      // tags：JSON 数组字符串，如 '["重点客户","老客户"]'；空字符串表示无标签
      if (!(await hasColumn('tags'))) {
        await db.exec(`ALTER TABLE customers ADD COLUMN tags TEXT AFTER industry`)
      }
      // remark：自由文本备注
      if (!(await hasColumn('remark'))) {
        await db.exec(`ALTER TABLE customers ADD COLUMN remark TEXT AFTER tags`)
      }
    },
    down: async (db: any) => {
      // 幂等：DROP COLUMN 不存在会报错，先检查再删
      const hasColumn = async (col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = ?`
        ).get(col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('remark')) {
        await db.exec(`ALTER TABLE customers DROP COLUMN remark`)
      }
      if (await hasColumn('tags')) {
        await db.exec(`ALTER TABLE customers DROP COLUMN tags`)
      }
    },
  },
  {
    version: 23,
    name: 'sheet-templates-one-to-many',
    description: 'V0.15：款式模板升级为一对多关系（同一款式可建多个差异化模板），quotes表新增template_id记录订单使用的模板',
    up: async (db: any) => {
      // 幂等：MySQL DDL（ALTER TABLE）隐式提交，先通过 information_schema 检查再执行
      const hasColumn = async (table: string, col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`
        ).get(table, col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      const hasIndex = async (table: string, indexName: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`
        ).get(table, indexName)
        return Number((row as any)?.cnt ?? 0) > 0
      }

      // 1. 去掉 style_code 唯一键（原一对一约束，放开后同款式可有多个模板）
      if (await hasIndex('sheet_templates', 'uk_style_code')) {
        await db.exec(`ALTER TABLE sheet_templates DROP INDEX uk_style_code`)
      }
      // 2. 新增 sort_order（同款式内的排序）
      if (!(await hasColumn('sheet_templates', 'sort_order'))) {
        await db.exec(`ALTER TABLE sheet_templates ADD COLUMN sort_order INT NOT NULL DEFAULT 0 COMMENT '同款式内排序（小在前）' AFTER formulas`)
      }
      // 3. 同款式模板名称唯一（业务唯一性约束）
      if (!(await hasIndex('sheet_templates', 'uk_style_name'))) {
        await db.exec(`ALTER TABLE sheet_templates ADD UNIQUE KEY uk_style_name (style_code, name)`)
      }
      // 4. quotes 记录订单使用的模板（'' = 内置默认模板，兼容历史订单）
      if (!(await hasColumn('quotes', 'template_id'))) {
        await db.exec(`ALTER TABLE quotes ADD COLUMN template_id VARCHAR(64) NOT NULL DEFAULT '' COMMENT '使用的款式模板id（空=内置默认模板）' AFTER productStyle`)
      }
    },
    down: async (db: any) => {
      const hasColumn = async (table: string, col: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`
        ).get(table, col)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      const hasIndex = async (table: string, indexName: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`
        ).get(table, indexName)
        return Number((row as any)?.cnt ?? 0) > 0
      }

      // 1. quotes 移除 template_id
      if (await hasColumn('quotes', 'template_id')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN template_id`)
      }
      // 2. 移除同款式名称唯一键 + sort_order
      if (await hasIndex('sheet_templates', 'uk_style_name')) {
        await db.exec(`ALTER TABLE sheet_templates DROP INDEX uk_style_name`)
      }
      if (await hasColumn('sheet_templates', 'sort_order')) {
        await db.exec(`ALTER TABLE sheet_templates DROP COLUMN sort_order`)
      }
      // 3. 恢复一对一约束：同款式仅保留最新一条（其余删除），再建 style_code 唯一键
      if (!(await hasIndex('sheet_templates', 'uk_style_code'))) {
        await db.exec(`DELETE t1 FROM sheet_templates t1
          INNER JOIN sheet_templates t2
          ON t1.style_code = t2.style_code
          AND (t1.updated_at < t2.updated_at OR (t1.updated_at = t2.updated_at AND t1.id < t2.id))`)
        await db.exec(`ALTER TABLE sheet_templates ADD UNIQUE KEY uk_style_code (style_code)`)
      }
    },
  },
  {
    version: 24,
    name: 'production-task-gantt',
    description: 'V0.16：新增quote_production_tasks表存储订单做货流程任务（甘特图数据：计划/实际起止时间、状态、材料清单），迁移存量productionStepStatus数据',
    up: async (db: any) => {
      const hasTable = async (table: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = ?`
        ).get(table)
        return Number((row as any)?.cnt ?? 0) > 0
      }

      // 1. 创建任务表
      if (!(await hasTable('quote_production_tasks'))) {
        await db.exec(`CREATE TABLE quote_production_tasks (
          id            VARCHAR(64)  NOT NULL COMMENT '任务id（prod-task-{ts}-{rand}）',
          quote_id      VARCHAR(64)  NOT NULL COMMENT '所属订单（quotes.id）',
          step_order    INT          NOT NULL DEFAULT 1 COMMENT '步骤顺序（甘特图行序，小在前）',
          name          VARCHAR(64)  NOT NULL COMMENT '步骤名称',
          plan_start    DATE         NULL COMMENT '计划开始',
          plan_end      DATE         NULL COMMENT '计划结束',
          actual_start  DATE         NULL COMMENT '实际开始',
          actual_end    DATE         NULL COMMENT '实际结束',
          status        TINYINT      NOT NULL DEFAULT 0 COMMENT '0未开始 1进行中 2已完成',
          remark        VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
          materials     LONGTEXT     NULL COMMENT '材料清单 JSON：[{name,spec,quantity,unit,ready}]',
          created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_qpt_quote_id (quote_id),
          KEY idx_qpt_plan_start (plan_start)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单做货流程任务（甘特图数据，V24）'`)
      }

      // 2. 存量数据迁移：productionStepStatus 非空的订单按 6 个标准步骤生成任务行（分批 ≤1000 单）
      //    状态映射：pending→0, in_progress→1, completed→2；旧数据无时间信息，日期全部 NULL
      const DEFAULT_STEPS = ['面料采购', '裁剪', '印刷', '缝纫', '质检', '包装']
      const STATUS_MAP: Record<string, number> = { pending: 0, in_progress: 1, completed: 2 }
      let lastQuoteId = ''
      for (;;) {
        const rows = await db.prepare(
          `SELECT id, productionStepStatus FROM quotes
           WHERE productionStepStatus IS NOT NULL AND productionStepStatus != '' AND productionStepStatus != '{}'
             AND id > ? ORDER BY id ASC LIMIT 1000`
        ).all(lastQuoteId)
        if (rows.length === 0) break
        for (const row of rows as Array<{ id: string; productionStepStatus: string }>) {
          lastQuoteId = row.id
          // 已迁移过（幂等）：跳过
          const existed = await db.prepare(
            'SELECT COUNT(*) AS cnt FROM quote_production_tasks WHERE quote_id = ?'
          ).get(row.id) as { cnt: number }
          if (Number(existed.cnt) > 0) continue
          let stepStatus: Record<string, string>
          try {
            stepStatus = JSON.parse(row.productionStepStatus) || {}
          } catch {
            continue // JSON 损坏跳过，保持可重跑
          }
          const now = new Date().toISOString().slice(0, 19).replace('T', ' ')
          for (let i = 0; i < DEFAULT_STEPS.length; i++) {
            const stepId = String(i + 1)
            const status = STATUS_MAP[stepStatus[stepId] || 'pending'] ?? 0
            const taskId = `prod-task-${row.id}-${stepId}`
            await db.prepare(
              `INSERT IGNORE INTO quote_production_tasks
               (id, quote_id, step_order, name, plan_start, plan_end, actual_start, actual_end, status, remark, materials, created_at, updated_at)
               VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, '[]', ?, ?)`
            ).run(taskId, row.id, i + 1, DEFAULT_STEPS[i], status, '', now, now)
          }
        }
        if ((rows as unknown[]).length < 1000) break
      }
    },
    down: async (db: any) => {
      const hasTable = async (table: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = ?`
        ).get(table)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (!(await hasTable('quote_production_tasks'))) return

      // 1. 任务数据聚合回 quotes.productionStepStatus（completed > in_progress > pending 取每单最高进度映射）
      const STATUS_TO_OLD: Record<number, string> = { 2: 'completed', 1: 'in_progress', 0: 'pending' }
      let lastQuoteId = ''
      for (;;) {
        const rows = await db.prepare(
          `SELECT quote_id, step_order, status FROM quote_production_tasks
           WHERE quote_id > ? ORDER BY quote_id ASC, step_order ASC LIMIT 5000`
        ).all(lastQuoteId)
        if (rows.length === 0) break
        const byQuote = new Map<string, Array<{ step_order: number; status: number }>>()
        for (const r of rows as Array<{ quote_id: string; step_order: number; status: number }>) {
          lastQuoteId = r.quote_id
          const list = byQuote.get(r.quote_id) || []
          list.push({ step_order: r.step_order, status: r.status })
          byQuote.set(r.quote_id, list)
        }
        for (const [quoteId, tasks] of byQuote) {
          const stepStatus: Record<string, string> = {}
          for (const t of tasks) {
            stepStatus[String(t.step_order)] = STATUS_TO_OLD[t.status] ?? 'pending'
          }
          await db.prepare('UPDATE quotes SET productionStepStatus = ? WHERE id = ?')
            .run(JSON.stringify(stepStatus), quoteId)
        }
        if ((rows as unknown[]).length < 5000) break
      }
      // 2. 删除任务表
      await db.exec(`DROP TABLE IF EXISTS quote_production_tasks`)
    },
  },
  {
    version: 25,
    name: 'sheet-templates-style-code-widen',
    description: 'V0.17：sheet_templates.style_code 扩容至 VARCHAR(64)，支持新增产品款式编码与无编码产品 id 绑定模板（款式模板与产品管理联动）',
    up: async (db: any) => {
      // 幂等：列长度不足 64 时才扩容（纯扩容操作，无数据变更，不影响既有 1-6 编码模板）
      const row = await db.prepare(
        `SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = 'sheet_templates' AND column_name = 'style_code'`
      ).get()
      if (Number((row as any)?.len ?? 0) >= 64) return
      await db.exec(
        `ALTER TABLE sheet_templates MODIFY COLUMN style_code VARCHAR(64) NOT NULL COMMENT '款式编码（内置1-6/产品自定义编码/无编码产品id）'`
      )
    },
    down: async (db: any) => {
      // 回滚：仅当不存在超长值时缩回 VARCHAR(8)；有产品 id 绑定的模板时拒绝（防截断丢数据）
      const row = await db.prepare(
        `SELECT COUNT(*) AS cnt FROM sheet_templates WHERE CHAR_LENGTH(style_code) > 8`
      ).get()
      if (Number((row as any)?.cnt ?? 0) > 0) {
        throw new Error('存在长度超过 8 的款式编码模板（产品 id 绑定），无法回滚缩容；请先删除对应模板')
      }
      await db.exec(
        `ALTER TABLE sheet_templates MODIFY COLUMN style_code VARCHAR(8) NOT NULL COMMENT '款式 code（1-6）'`
      )
    },
  },
  {
    version: 26,
    name: 'unify-table-collation',
    description: 'V0.18：统一 quote_production_tasks / sheet_templates 表排序规则为 utf8mb4_unicode_ci（v23/v24 增量建表未显式指定 COLLATE 落到 MySQL 8 默认 utf8mb4_0900_ai_ci，与 quotes 等表 JOIN 时报 Illegal mix of collations，导致做货跟踪总览接口 500）',
    up: async (db: any) => {
      // 幂等：仅当表存在且排序规则不是 utf8mb4_unicode_ci 时才转换
      //（全量脚本建表环境已带正确 COLLATE，直接跳过；纯元数据变更，无数据变更）
      for (const table of ['quote_production_tasks', 'sheet_templates']) {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = ?
             AND table_collation IS NOT NULL AND table_collation != 'utf8mb4_unicode_ci'`
        ).get(table)
        if (Number((row as any)?.cnt ?? 0) > 0) {
          await db.exec(
            `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
          )
        }
      }
    },
    down: async (db: any) => {
      // 回滚：还原为 MySQL 8 默认排序规则（utf8mb4 内互转无数据损失；
      // 回滚后跨表 JOIN 会重新出现 collation 冲突，仅用于版本回退）
      for (const table of ['quote_production_tasks', 'sheet_templates']) {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = ?
             AND table_collation IS NOT NULL AND table_collation != 'utf8mb4_0900_ai_ci'`
        ).get(table)
        if (Number((row as any)?.cnt ?? 0) > 0) {
          await db.exec(
            `ALTER TABLE \`${table}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`
          )
        }
      }
    },
  },
  {
    version: 27,
    name: 'rename-dashboard-to-workbench',
    description: 'V0.19：仪表盘更名为工作台，更新 dashboard:view 菜单权限显示名',
    up: async (db: any) => {
      // 幂等：仅当当前名称为「仪表盘」时更新，重跑无副作用
      await db.exec(
        `UPDATE permissions SET name = '工作台' WHERE code = 'dashboard:view' AND name = '仪表盘'`
      )
    },
    down: async (db: any) => {
      await db.exec(
        `UPDATE permissions SET name = '仪表盘' WHERE code = 'dashboard:view' AND name = '工作台'`
      )
    },
  },
  {
    version: 28,
    name: 'order-reconciliation',
    description: 'V0.20：订单对账管理——quotes 新增 reconciledTime 对账时间字段，新建 quote_reconciliation_costs 表存储对账工艺成本明细（工艺名称/单价/数量/成本/备注）',
    up: async (db: any) => {
      const hasColumn = async (table: string, column: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`
        ).get(table, column)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      const hasTable = async (table: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables
           WHERE table_schema = DATABASE() AND table_name = ?`
        ).get(table)
        return Number((row as any)?.cnt ?? 0) > 0
      }

      // 1. quotes 新增对账时间字段
      if (!(await hasColumn('quotes', 'reconciledTime'))) {
        await db.exec(
          `ALTER TABLE quotes ADD COLUMN reconciledTime VARCHAR(64) DEFAULT '' COMMENT '对账时间（状态8已对账，V28）' AFTER paymentTime`
        )
      }

      // 2. 对账工艺成本明细表（显式 COLLATE utf8mb4_unicode_ci，避免 MySQL 8 默认排序规则冲突）
      if (!(await hasTable('quote_reconciliation_costs'))) {
        await db.exec(`CREATE TABLE quote_reconciliation_costs (
          id          VARCHAR(64)    NOT NULL COMMENT '明细id（recon-cost-{ts}-{rand}）',
          quote_id    VARCHAR(64)    NOT NULL COMMENT '所属订单（quotes.id）',
          name        VARCHAR(128)   NOT NULL COMMENT '工艺名称（必填）',
          unit_price  DECIMAL(12,2)  NOT NULL DEFAULT 0 COMMENT '工艺单价',
          quantity    DECIMAL(12,2)  NOT NULL DEFAULT 0 COMMENT '工艺数量',
          cost        DECIMAL(12,2)  NOT NULL DEFAULT 0 COMMENT '工艺成本（必填）',
          remark      VARCHAR(500)   NOT NULL DEFAULT '' COMMENT '工艺备注',
          sort_order  INT            NOT NULL DEFAULT 1 COMMENT '明细顺序（小在前）',
          created_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          KEY idx_qrc_quote_id (quote_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='订单对账工艺成本明细（V28）'`)
      }
    },
    down: async (db: any) => {
      // 逆序撤销：先删明细表，再删 quotes 对账时间列
      await db.exec(`DROP TABLE IF EXISTS quote_reconciliation_costs`)
      const hasColumn = async (table: string, column: string): Promise<boolean> => {
        const row = await db.prepare(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`
        ).get(table, column)
        return Number((row as any)?.cnt ?? 0) > 0
      }
      if (await hasColumn('quotes', 'reconciledTime')) {
        await db.exec(`ALTER TABLE quotes DROP COLUMN reconciledTime`)
      }
    },
  },
  {
    version: 29,
    name: 'add-quotes-quick-edit-permission',
    description: 'V0.21：订单管理新增 quotes:quick-edit 权限（双击订单行直接进入编辑模式的开关，需与 quotes:edit 同时持有才生效）。为兼容存量行为，自动分配给所有已拥有 quotes:edit 的角色',
    up: async (db: any) => {
      // 1. 新增权限（幂等）
      await db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        'perm-quotes-quick-edit',
        'quotes:quick-edit',
        '订单-双击进入编辑',
        'quotes',
        'quick-edit',
        'button',
        '双击订单行直接进入编辑模式（需同时拥有「订单-编辑」权限）',
        18,
      )

      // 2. 分配给 admin 角色（幂等）
      await db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      ).run('role-admin', 'perm-quotes-quick-edit')

      // 3. 存量兼容：自动分配给所有已拥有 quotes:edit 的角色，
      //    保证升级后既有"双击直接编辑"行为不变；管理员可在角色管理中按需收回
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-quotes-quick-edit'
        FROM role_permissions rp
        JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:edit'
      `)
    },
    down: async (db: any) => {
      // 先删角色关联，再删权限（避免外键约束）
      await db.prepare('DELETE FROM role_permissions WHERE permission_id = ?').run('perm-quotes-quick-edit')
      await db.prepare('DELETE FROM permissions WHERE id = ?').run('perm-quotes-quick-edit')
    },
  },
  {
    version: 30,
    name: 'add-business-module-permissions',
    description: 'V0.22：做货跟踪/订单对账管理/年度业务报表三个功能模块从订单与报表权限中独立，新增 6 项模块权限（production-tracking:view/edit、reconciliation:view/edit/execute、annual-report:view）。为兼容存量行为，自动按原等效权限分配给已有角色',
    up: async (db: any) => {
      // 1. 新增权限（幂等）
      const modulePerms: Array<[string, string, string, string, string, string, string, number]> = [
        // [id, code, name, module, action, type, description, sort_order]
        ['perm-production-tracking-view', 'production-tracking:view', '做货跟踪-查看', 'production-tracking', 'view', 'menu', '做货跟踪模块访问（甘特图与订单状态跟踪）', 23],
        ['perm-production-tracking-edit', 'production-tracking:edit', '做货跟踪-编辑', 'production-tracking', 'edit', 'button', '编辑做货任务（新增/修改/删除/移动/一键排期/拖拽）', 24],
        ['perm-reconciliation-view', 'reconciliation:view', '订单对账-查看', 'reconciliation', 'view', 'menu', '订单对账管理模块访问（待对账/已对账双列表与对账详情）', 25],
        ['perm-reconciliation-edit', 'reconciliation:edit', '订单对账-编辑', 'reconciliation', 'edit', 'button', '录入/编辑对账工艺成本明细', 26],
        ['perm-reconciliation-execute', 'reconciliation:execute', '订单对账-执行', 'reconciliation', 'execute', 'button', '确认对账（5→8）与退回对账（8→5）', 27],
        ['perm-annual-report-view', 'annual-report:view', '年度业务报表-查看', 'annual-report', 'view', 'menu', '年度业务报表模块访问（业绩统计/月度汇总/订单转化）', 81],
      ]
      const permStmt = db.prepare(
        'INSERT IGNORE INTO permissions (id, code, name, module, action, type, description, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      for (const p of modulePerms) {
        await permStmt.run(...p)
      }

      // 2. 存量兼容：按原等效权限自动分配，保证升级后既有角色的模块访问与操作行为零变化
      //    （原做货跟踪/对账入口挂靠 quotes:view/edit/status-transition，年报挂靠 reports:view）
      const permIds = modulePerms.map((p) => p[0])
      const rpStmt = db.prepare(
        'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)'
      )
      // 2.1 admin 角色直接分配全部 6 项
      for (const pid of permIds) {
        await rpStmt.run('role-admin', pid)
      }
      // 2.2 存量角色：拥有原权限 → 获得对应新模块权限
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-production-tracking-view'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:view'
      `)
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-reconciliation-view'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:view'
      `)
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-production-tracking-edit'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:edit'
      `)
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-reconciliation-edit'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:edit'
      `)
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-reconciliation-execute'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'quotes:status-transition'
      `)
      await db.exec(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT rp.role_id, 'perm-annual-report-view'
        FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
        WHERE p.code = 'reports:view'
      `)
    },
    down: async (db: any) => {
      // 逆序撤销：先删全部角色关联，再删 6 项权限（避免外键约束）
      const permIds = [
        'perm-production-tracking-view', 'perm-production-tracking-edit',
        'perm-reconciliation-view', 'perm-reconciliation-edit', 'perm-reconciliation-execute',
        'perm-annual-report-view',
      ]
      await db.prepare(
        `DELETE FROM role_permissions WHERE permission_id IN (${permIds.map(() => '?').join(', ')})`
      ).run(...permIds)
      await db.prepare(
        `DELETE FROM permissions WHERE id IN (${permIds.map(() => '?').join(', ')})`
      ).run(...permIds)
    },
  },
  {
    version: 31,
    name: 'product-cost-items-config',
    description: 'V0.23：「工艺成本管理」正式更名为「产品成本项配置」，重构为三层结构：产品成本项（product_cost_items）→ 可选工艺（product_cost_processes，多对一，含名称/成本/公式/特点/备注）→ 自定义字段（product_cost_custom_fields，支持文本/数字/日期/下拉、显隐与排序）。存量 process_costs 数据按「一行→同名成本项+其下一条工艺」无损迁移（旧表保留不删）。权限码 process-costs:* 保持不变，显示名更新为「产品成本项-*」',
    up: async (db: any) => {
      // 1. 三张新表（显式 COLLATE utf8mb4_unicode_ci，与存量表 JOIN 排序规则一致，见 v26 教训）
      await db.exec(`
        CREATE TABLE IF NOT EXISTS product_cost_items (
          id VARCHAR(64) NOT NULL,
          name VARCHAR(255) NOT NULL COMMENT '成本项名称（如：印刷成本、布料成本）',
          sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品成本项配置（父级）'
      `)
      await db.exec(`
        CREATE TABLE IF NOT EXISTS product_cost_processes (
          id VARCHAR(64) NOT NULL,
          cost_item_id VARCHAR(64) NOT NULL COMMENT '所属成本项（多对一）',
          name VARCHAR(255) NOT NULL COMMENT '工艺名称',
          cost DOUBLE DEFAULT 0 COMMENT '工艺成本金额',
          formula VARCHAR(500) DEFAULT '' COMMENT '成本计算公式',
          features VARCHAR(1000) DEFAULT '' COMMENT '工艺特点描述',
          remark VARCHAR(1000) DEFAULT '' COMMENT '工艺备注',
          custom_values LONGTEXT COMMENT '自定义字段值 JSON（字段id→值）',
          sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_pcp_item (cost_item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品成本项-可选工艺（一对多）'
      `)
      await db.exec(`
        CREATE TABLE IF NOT EXISTS product_cost_custom_fields (
          id VARCHAR(64) NOT NULL,
          cost_item_id VARCHAR(64) NOT NULL COMMENT '所属成本项（字段对该成本项下所有工艺生效）',
          name VARCHAR(255) NOT NULL COMMENT '字段显示名',
          field_type VARCHAR(20) NOT NULL DEFAULT 'text' COMMENT '字段类型：text/number/date/select',
          options VARCHAR(2000) DEFAULT '' COMMENT 'select 下拉选项（JSON 数组字符串）',
          visible TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否显示（0=隐藏：列表与编辑均不渲染，已录值保留）',
          sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（小在前）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_pccf_item (cost_item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品成本项-自定义字段定义'
      `)

      // 2. 存量数据迁移：旧工艺成本行 → 同名成本项 + 其下一条可选工艺（幂等，INSERT IGNORE）
      //    旧 process_costs 表保留不删：应用层切换到新表，旧表数据回滚时零损失
      const legacyRows = await db.prepare(
        'SELECT id, name, cost, formula FROM process_costs ORDER BY created_at ASC, id ASC'
      ).all() as Array<{ id: string; name: string; cost: number; formula: string }>
      for (const row of legacyRows) {
        const itemId = `pci-${row.id}`
        await db.prepare(
          'INSERT IGNORE INTO product_cost_items (id, name, sort_order) VALUES (?, ?, ?)'
        ).run(itemId, row.name || row.id, 0)
        await db.prepare(
          `INSERT IGNORE INTO product_cost_processes
             (id, cost_item_id, name, cost, formula, features, remark, custom_values, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(`pcp-${row.id}`, itemId, row.name || row.id, Number(row.cost ?? 0) || 0, row.formula || '', '', '', '{}', 0)
      }

      // 3. 权限更名：模块显示名由「工艺成本」更新为「产品成本项」
      //    权限码 process-costs:* 保持不变（role_permissions 按 id 关联，零迁移成本）
      await db.exec(`
        UPDATE permissions SET name = '产品成本项-查看', description = '产品成本项配置模块访问（成本项、可选工艺与自定义字段管理）'
        WHERE code = 'process-costs:view'
      `)
      await db.exec(`
        UPDATE permissions SET name = '产品成本项-新增', description = '新增产品成本项、可选工艺与自定义字段'
        WHERE code = 'process-costs:create'
      `)
      await db.exec(`
        UPDATE permissions SET name = '产品成本项-编辑', description = '编辑产品成本项、可选工艺与自定义字段'
        WHERE code = 'process-costs:edit'
      `)
      await db.exec(`
        UPDATE permissions SET name = '产品成本项-删除', description = '删除产品成本项、可选工艺与自定义字段'
        WHERE code = 'process-costs:delete'
      `)
    },
    down: async (db: any) => {
      // 1. 权限显示名回退（code 不变，仅回退 name/description）
      const rollbackPerms: Array<[string, string, string]> = [
        ['process-costs:view', '工艺成本-查看', ''],
        ['process-costs:create', '工艺成本-新增', ''],
        ['process-costs:edit', '工艺成本-编辑', ''],
        ['process-costs:delete', '工艺成本-删除', ''],
      ]
      for (const [code, name, description] of rollbackPerms) {
        await db.prepare(
          'UPDATE permissions SET name = ?, description = ? WHERE code = ?'
        ).run(name, description, code)
      }

      // 2. 删除三张新表（先子后父；旧 process_costs 表未动，数据零损失）
      await db.exec('DROP TABLE IF EXISTS product_cost_processes')
      await db.exec('DROP TABLE IF EXISTS product_cost_custom_fields')
      await db.exec('DROP TABLE IF EXISTS product_cost_items')
    },
  },
  {
    version: 32,
    name: 'product-media-gallery',
    description: 'V0.24：产品图册——新增 product_media 表（图片/视频，原图存储不压缩，sort_order 支持上传顺序与自定义排序），媒体文件存于 api/uploads/products/，由 /api/products/:id/media 系列接口管理',
    up: async (db: any) => {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS product_media (
          id VARCHAR(64) NOT NULL,
          product_id VARCHAR(64) NOT NULL COMMENT '所属产品',
          media_type VARCHAR(10) NOT NULL DEFAULT 'image' COMMENT '媒体类型：image / video',
          file_name VARCHAR(500) NOT NULL COMMENT '原始文件名（上传时的名称）',
          file_path VARCHAR(1000) NOT NULL COMMENT '存储相对路径（相对 api/uploads/，如 products/xxx.jpg）',
          file_size BIGINT NOT NULL DEFAULT 0 COMMENT '文件大小（字节，原图不压缩）',
          mime_type VARCHAR(100) NOT NULL DEFAULT '' COMMENT 'MIME 类型',
          sort_order INT NOT NULL DEFAULT 0 COMMENT '排序（小在前：上传顺序或自定义重排后的顺序）',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          INDEX idx_pm_product (product_id, sort_order)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='产品图册（图片/视频，保留原始质量与分辨率）'
      `)
    },
    down: async (db: any) => {
      await db.exec('DROP TABLE IF EXISTS product_media')
    },
  },
]

export class MigrationRunner {
  private db: any
  private appliedVersions: Set<number> = new Set()

  constructor(db: any) {
    this.db = db
  }

  async ensureMigrationTable(): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
  }

  async loadAppliedVersions(): Promise<void> {
    const rows = await this.db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]
    this.appliedVersions = new Set(rows.map((r) => r.version))
  }

  async getCurrentVersion(): Promise<number> {
    await this.ensureMigrationTable()
    await this.loadAppliedVersions()
    if (this.appliedVersions.size === 0) return 0
    return Math.max(...this.appliedVersions)
  }

  getPendingMigrations(): Migration[] {
    return migrations.filter((m) => !this.appliedVersions.has(m.version))
  }

  async migrate(upToVersion?: number): Promise<{ applied: string[]; skipped: string[] }> {
    const pending = this.getPendingMigrations()
    const targetVersion = upToVersion ?? CURRENT_SCHEMA_VERSION
    const toApply = pending.filter((m) => m.version <= targetVersion)

    const applied: string[] = []
    const skipped: string[] = []

    if (toApply.length === 0) {
      skipped.push('无待执行的迁移')
      return { applied, skipped }
    }

    const migrateAll = this.db.transaction(async () => {
      for (const migration of toApply) {
        await migration.up(this.db)
        await this.db.prepare(
          'INSERT INTO schema_migrations (version, name, description) VALUES (?, ?, ?)'
        ).run(migration.version, migration.name, migration.description)
        this.appliedVersions.add(migration.version)
        applied.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    await migrateAll()

    return { applied, skipped }
  }

  async rollback(toVersion: number): Promise<{ rolledBack: string[] }> {
    const applied = migrations
      .filter((m) => this.appliedVersions.has(m.version) && m.version > toVersion)
      .sort((a, b) => b.version - a.version)

    const rolledBack: string[] = []

    const rollbackAll = this.db.transaction(async () => {
      for (const migration of applied) {
        await migration.down(this.db)
        await this.db.prepare('DELETE FROM schema_migrations WHERE version = ?').run(migration.version)
        this.appliedVersions.delete(migration.version)
        rolledBack.push(`v${String(migration.version).padStart(4, '0')} - ${migration.name}`)
      }
    })

    await rollbackAll()

    return { rolledBack }
  }

  async reset(): Promise<{ rolledBack: string[] }> {
    return this.rollback(0)
  }

  static fromPath(): Migration[] {
    return migrations
  }
}

export function getMigrations(): Migration[] {
  return [...migrations]
}
