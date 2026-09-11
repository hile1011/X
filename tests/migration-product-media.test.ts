/**
 * 数据库迁移 v32 - product-media-gallery 单元测试
 *
 * 产品图册：新增 product_media 表（图片/视频，原图存储不压缩）。
 *
 * 测试目标：
 *   - product_media 表存在且结构正确（关键列 + 排序规则 utf8mb4_unicode_ci，见 v26 教训）
 *   - db.productMedia 数据层：create/getByProduct（按 sort_order 排序）/nextSortOrder/
 *     deleteById/deleteByProduct/reorder（合法与非法列表）
 *   - 幂等性：rollback + 重新 migrate 后表结构不重复、数据无重复
 *   - down 回滚：表被删除；重新 migrate 后恢复
 *
 * 使用 MySQL 测试数据库（quote_system_test），已迁移至最新版本。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { db } from '../api/db'
import { pool } from '../api/dbClient.js'
import { resetTestDatabase } from './helpers/db-reset'
import { CURRENT_SCHEMA_VERSION } from '../api/migrations/index.js'

beforeAll(async () => {
  // 确保 schema 在最新版本（前一个测试文件可能通过 rollback 修改了 schema）
  await db.runner.migrate()
  // 重置数据：确保产品/RBAC 为干净的种子状态
  await resetTestDatabase()
})

afterAll(async () => {
  // 确保所有测试结束后 schema 恢复到最新版本
  const version = await db.getSchemaVersion()
  if (version < CURRENT_SCHEMA_VERSION) {
    await db.runner.migrate()
  }
})

/** 查询单行 */
async function queryOne(sql: string, params: any[] = []): Promise<any> {
  const [rows] = await pool.execute(sql, params)
  return (rows as any[])[0] ?? null
}

// ============================================================
// 表结构
// ============================================================
describe('迁移 v32 - 表结构', () => {
  it('product_media 表存在且排序规则为 utf8mb4_unicode_ci', async () => {
    const row = await queryOne(
      'SELECT TABLE_COLLATION FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_media'],
    )
    expect(row).toBeTruthy()
    expect(row.TABLE_COLLATION).toBe('utf8mb4_unicode_ci')
  })

  it('product_media 含业务列（product_id/media_type/file_name/file_path/file_size/mime_type/sort_order）', async () => {
    const [cols] = await pool.execute(
      'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_media'],
    )
    const names = (cols as any[]).map((c) => c.COLUMN_NAME)
    for (const col of ['product_id', 'media_type', 'file_name', 'file_path', 'file_size', 'mime_type', 'sort_order']) {
      expect(names).toContain(col)
    }
  })

  it('product_media 含 (product_id, sort_order) 联合索引', async () => {
    const [indexes] = await pool.execute(
      'SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_media'],
    )
    const names = (indexes as any[]).map((i) => i.INDEX_NAME)
    expect(names).toContain('idx_pm_product')
  })

  it('Schema 版本为最新版本（32）', async () => {
    const version = await db.getSchemaVersion()
    expect(version).toBe(CURRENT_SCHEMA_VERSION)
    expect(version).toBe(32)
  })
})

// ============================================================
// 数据层 db.productMedia
// ============================================================
describe('db.productMedia 数据层', () => {
  it('create：新增媒体记录（含元数据）', async () => {
    const created = await db.productMedia.create({
      productId: 'style-1',
      mediaType: 'image',
      fileName: '产品图.jpg',
      filePath: 'products/123-abc.jpg',
      fileSize: 204800,
      mimeType: 'image/jpeg',
      sortOrder: 0,
    })
    expect(created.id).toMatch(/^pmedia-/)
    expect(created.product_id).toBe('style-1')
    expect(created.media_type).toBe('image')
    expect(created.file_name).toBe('产品图.jpg')
    expect(created.file_path).toBe('products/123-abc.jpg')
    expect(Number(created.file_size)).toBe(204800)
    expect(created.mime_type).toBe('image/jpeg')
    expect(Number(created.sort_order)).toBe(0)
  })

  it('getByProduct：按 sort_order 升序返回（上传顺序/自定义排序）', async () => {
    await db.productMedia.deleteByProduct('style-2')
    await db.productMedia.create({ productId: 'style-2', mediaType: 'video', fileName: 'v2.mp4', filePath: 'products/v2.mp4', fileSize: 1, mimeType: 'video/mp4', sortOrder: 5 })
    await db.productMedia.create({ productId: 'style-2', mediaType: 'image', fileName: 'a.jpg', filePath: 'products/a.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 1 })
    await db.productMedia.create({ productId: 'style-2', mediaType: 'image', fileName: 'b.jpg', filePath: 'products/b.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 3 })

    const list = await db.productMedia.getByProduct('style-2')
    expect(list).toHaveLength(3)
    expect(list.map((m) => m.file_name)).toEqual(['a.jpg', 'b.jpg', 'v2.mp4'])
  })

  it('nextSortOrder：返回当前最大序号 + 1（空产品返回 0）', async () => {
    expect(await db.productMedia.nextSortOrder('style-3')).toBe(0)
    await db.productMedia.create({ productId: 'style-3', mediaType: 'image', fileName: 'x.jpg', filePath: 'products/x.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 7 })
    expect(await db.productMedia.nextSortOrder('style-3')).toBe(8)
  })

  it('reorder：整体重写序号（自定义排序）', async () => {
    await db.productMedia.deleteByProduct('style-4')
    const m1 = await db.productMedia.create({ productId: 'style-4', mediaType: 'image', fileName: '1.jpg', filePath: 'products/1.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 0 })
    const m2 = await db.productMedia.create({ productId: 'style-4', mediaType: 'image', fileName: '2.jpg', filePath: 'products/2.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 1 })
    const m3 = await db.productMedia.create({ productId: 'style-4', mediaType: 'video', fileName: '3.mp4', filePath: 'products/3.mp4', fileSize: 1, mimeType: 'video/mp4', sortOrder: 2 })

    // 重排：3 → 1 → 2
    await db.productMedia.reorder('style-4', [m3.id, m1.id, m2.id])
    const list = await db.productMedia.getByProduct('style-4')
    expect(list.map((m) => m.file_name)).toEqual(['3.mp4', '1.jpg', '2.jpg'])
    expect(list.map((m) => Number(m.sort_order))).toEqual([0, 1, 2])
  })

  it('reorder：列表与现有媒体不一致时拒绝', async () => {
    await db.productMedia.deleteByProduct('style-5')
    const m1 = await db.productMedia.create({ productId: 'style-5', mediaType: 'image', fileName: '1.jpg', filePath: 'products/1.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 0 })
    const m2 = await db.productMedia.create({ productId: 'style-5', mediaType: 'image', fileName: '2.jpg', filePath: 'products/2.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 1 })

    // 少一个 id
    await expect(db.productMedia.reorder('style-5', [m1.id])).rejects.toThrow()
    // 多一个未知 id
    await expect(db.productMedia.reorder('style-5', [m1.id, m2.id, 'pmedia-unknown'])).rejects.toThrow()
    // 顺序交换不影响合法性（仍是全部现有 id）
    await expect(db.productMedia.reorder('style-5', [m2.id, m1.id])).resolves.toBe(true)
  })

  it('deleteById：删除并返回被删记录', async () => {
    const m = await db.productMedia.create({ productId: 'style-6', mediaType: 'image', fileName: 'del.jpg', filePath: 'products/del.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 0 })
    const removed = await db.productMedia.deleteById(m.id)
    expect(removed?.id).toBe(m.id)
    expect(await db.productMedia.getById(m.id)).toBeNull()
    // 再删返回 null
    expect(await db.productMedia.deleteById(m.id)).toBeNull()
  })

  it('deleteByProduct：删除产品下全部媒体并返回列表（产品删除联动清理）', async () => {
    await db.productMedia.create({ productId: 'prod-del-all', mediaType: 'image', fileName: 'a.jpg', filePath: 'products/a.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 0 })
    await db.productMedia.create({ productId: 'prod-del-all', mediaType: 'video', fileName: 'b.mp4', filePath: 'products/b.mp4', fileSize: 1, mimeType: 'video/mp4', sortOrder: 1 })
    const removed = await db.productMedia.deleteByProduct('prod-del-all')
    expect(removed).toHaveLength(2)
    expect(await db.productMedia.getByProduct('prod-del-all')).toHaveLength(0)
  })

  it('getFirstImages：每个产品返回图册排序最前的 image（跳过排在前面的视频）', async () => {
    await db.productMedia.deleteByProduct('prod-first-1')
    await db.productMedia.deleteByProduct('prod-first-2')
    // prod-first-1：视频排最前 → 第一张图片应为 sort_order=1 的 second.jpg
    await db.productMedia.create({ productId: 'prod-first-1', mediaType: 'video', fileName: 'intro.mp4', filePath: 'products/intro.mp4', fileSize: 1, mimeType: 'video/mp4', sortOrder: 0 })
    await db.productMedia.create({ productId: 'prod-first-1', mediaType: 'image', fileName: 'second.jpg', filePath: 'products/second.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 1 })
    await db.productMedia.create({ productId: 'prod-first-1', mediaType: 'image', fileName: 'third.jpg', filePath: 'products/third.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 2 })
    // prod-first-2：只有图片，取 sort_order 最小
    await db.productMedia.create({ productId: 'prod-first-2', mediaType: 'image', fileName: 'cover.jpg', filePath: 'products/cover.jpg', fileSize: 1, mimeType: 'image/jpeg', sortOrder: 3 })

    const first = await db.productMedia.getFirstImages()
    const map = new Map(first.map((m) => [m.product_id, m]))
    expect(map.get('prod-first-1')?.file_name).toBe('second.jpg')
    expect(map.get('prod-first-2')?.file_name).toBe('cover.jpg')
    // 无媒体产品不出现
    expect(map.has('prod-no-media-xxx')).toBe(false)
  })
})

// ============================================================
// 幂等性 & 回滚
// ============================================================
describe('迁移 v32 - 幂等性与回滚', () => {
  it('迁移幂等：重新 migrate 不报错、表不重复', async () => {
    await db.runner.migrate()
    const row = await queryOne(
      "SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'product_media'",
    )
    expect(Number(row.cnt)).toBe(1)
  })

  it('down 回滚：product_media 表被删除', async () => {
    await db.runner.rollback(31)
    const row = await queryOne(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_media'],
    )
    expect(row).toBeNull()
    expect(await db.getSchemaVersion()).toBe(31)
  })

  it('重新 migrate：表恢复且版本回到最新', async () => {
    await db.runner.migrate()
    const row = await queryOne(
      'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
      ['product_media'],
    )
    expect(row).toBeTruthy()
    expect(await db.getSchemaVersion()).toBe(CURRENT_SCHEMA_VERSION)
  })
})
