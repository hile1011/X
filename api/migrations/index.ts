export const CURRENT_SCHEMA_VERSION = 16

export interface Migration {
  version: number
  name: string
  description: string
  up: (db: any) => Promise<void>
  down: (db: any) => Promise<void>
}

const migrations: Migration[] = [
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
      await db.exec(`ALTER TABLE quotes ADD COLUMN created_by VARCHAR(64) DEFAULT '' AFTER user_id`)
      await db.exec(`ALTER TABLE quotes ADD COLUMN updated_by VARCHAR(64) DEFAULT '' AFTER created_by`)
    },
    down: async (db: any) => {
      await db.exec(`ALTER TABLE quotes DROP COLUMN created_by`)
      await db.exec(`ALTER TABLE quotes DROP COLUMN updated_by`)
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
