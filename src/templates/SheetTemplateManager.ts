/**
 * 在线表格模板管理类（Factory + 不可变快照模式）
 *
 * 设计思路：
 *   - 将原 BagQuote.tsx 中的 6 个模板常量和 getTemplateByStyle 映射逻辑封装为独立类
 *   - 模板数据设为 private static readonly，仅通过方法返回深拷贝，防止外部意外修改
 *   - 提供 hasTemplate / getAllStyles 等查询方法，提升可扩展性
 *   - 新增款式只需在 TEMPLATES 映射中添加条目，无需修改调用方代码（开闭原则）
 *
 * 模板对应关系（与产品款式 code 1-6 一一对应）：
 *   '1' → 无底无侧普通袋（默认模板）
 *   '2' → 有底无侧普通袋
 *   '3' → 有底有侧普通袋
 *   '4' → 手提连底普通拼接袋
 *   '5' → 手提连底高级拼接袋
 *   '6' → 手提无连底拼接袋
 *
 * 业务规则：无绑定模板的产品（无 code 或 code 非 1-6）默认使用「无底无侧」模板
 *
 * 布料米数取整：M 列（布料米数）公式整体包裹 CEILING(...,1)、静态缓存值同步向上取整，
 * 口径统一见 src/services/fabricMeters.ts（前后端同口径，勿单边修改）
 */

import type { SheetTemplate } from './types'
import { api } from '../api'

/** 数据库模板条目（一对多：id 为唯一键，同款式可有多个） */
export interface SheetTemplateEntry {
  id: string
  styleCode: string
  name: string
  template: SheetTemplate
}

export class SheetTemplateManager {
  /** 默认款式 code（无底无侧普通袋） */
  static readonly DEFAULT_STYLE = '1'

  /**
   * 数据库模板缓存（v23：sheet_templates 表，款式一对多）
   * key = 模板 id，value = { styleCode, name, data, formulas }
   * 内置模板始终可用作兜底：订单 templateId 为空或模板被删除时使用内置默认
   */
  private static entries: Record<string, SheetTemplateEntry> = {}
  /** 缓存是否已从后端加载（进程内只加载一次，管理页保存后同步更新） */
  private static entriesLoaded = false

  /**
   * 从后端加载数据库模板到内存缓存（幂等，进程内只请求一次）
   * - 订单编辑/新建页初始化表格前调用，确保使用最新模板列表
   * - 网络失败时静默回退内置模板（下次调用可重试）
   * @param force 强制重新加载（管理页保存后刷新）
   */
  static async loadOverrides(force = false): Promise<void> {
    if (SheetTemplateManager.entriesLoaded && !force) return
    try {
      const records = await api.sheetTemplates.getAll() as Array<{
        id: string
        styleCode: string
        name: string
        data: (string | number | null)[][]
        formulas: Record<string, string>
        columnWidthConfig?: Array<{ key: number; width: number }>
        rowHeightConfig?: Array<{ key: number; height: number }>
      }>
      const next: Record<string, SheetTemplateEntry> = {}
      for (const r of records) {
        if (r?.id && r.styleCode && Array.isArray(r.data) && r.data.length > 0) {
          next[r.id] = {
            id: r.id,
            styleCode: r.styleCode,
            name: r.name || '',
            template: {
              data: r.data,
              formulas: r.formulas || {},
              // 布局配置（v34）：新建订单继承所选模板的行列尺寸
              columnWidthConfig: Array.isArray(r.columnWidthConfig) ? r.columnWidthConfig : [],
              rowHeightConfig: Array.isArray(r.rowHeightConfig) ? r.rowHeightConfig : [],
            },
          }
        }
      }
      SheetTemplateManager.entries = next
      SheetTemplateManager.entriesLoaded = true
    } catch {
      // 加载失败（网络/权限等）：保持内置模板，允许下次重试
    }
  }

  /**
   * 写入/更新单条模板缓存（模板管理页保存成功后调用，无需重新拉取全量）
   */
  static setOverride(id: string, styleCode: string, name: string, template: SheetTemplate): void {
    SheetTemplateManager.entries[id] = {
      id, styleCode, name,
      template: SheetTemplateManager.deepClone(template),
    }
    SheetTemplateManager.entriesLoaded = true
  }

  /**
   * 删除单条模板缓存（模板管理页删除模板后调用）
   */
  static removeOverride(id: string): void {
    delete SheetTemplateManager.entries[id]
  }

  /**
   * 获取指定款式的全部数据库模板（一对多，按后端排序）
   */
  static listByStyle(styleCode: string): SheetTemplateEntry[] {
    return Object.values(SheetTemplateManager.entries)
      .filter((e) => e.styleCode === styleCode)
      .sort((a, b) => a.id.localeCompare(b.id))
  }

  /**
   * 按模板 id 获取数据库模板（深拷贝）；不存在时返回 null
   */
  static getTemplateById(id: string): SheetTemplate | null {
    const entry = SheetTemplateManager.entries[id]
    return entry ? SheetTemplateManager.deepClone(entry.template) : null
  }

  /**
   * 按模板 id 获取模板名称；不存在时返回 null
   */
  static getTemplateName(id: string): string | null {
    return SheetTemplateManager.entries[id]?.name ?? null
  }

  /**
   * 判断指定款式是否存在数据库覆盖版本
   */
  static isOverridden(styleCode: string): boolean {
    return SheetTemplateManager.listByStyle(styleCode).length > 0
  }

  /**
   * 所有模板映射（private，防止外部直接访问）
   * key = 款式 code，value = 模板数据
   */
  private static readonly TEMPLATES: Readonly<Record<string, SheetTemplate>> = {

    // 款式1：无底无侧普通袋（默认模板）
    // 基准来源：生产环境手动创建模板「12安涤棉」（sheet-tpl-1787670604999-773，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '1': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
        ['成品', 1000, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
        ['正反面', 1000, 38, 40, 0, 3, 10, 41, 90, 154, 340, 31, 316, 3.7560975609756095, 160.9713, 1942.3384615384618],
        ['手提', 1000, 2.5, 65, 0, null, null, 6, 65, 154, 340, 4, 55, 25.666666666666668, 27.846, null],
        [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
        ['正反面', 0.51, 0.4428, 5.2, 1.7412760000000005, 0.05, 0.1, 128.77704000000003, 1.05, 3.029431892000001, null, null, null, null, null, null],
        ['手提', null, 0, 5.2, 0.33892, null, null, 22.2768, 1.05, 0.36231064, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, 3.391742532000001, null, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.8417425320000014, 4.225916785200002, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 450.00000000000017, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2',
        C3: '=C2',
        D3: '=D2',
        E3: '=E2',
        H3: '=F3+C3',
        I3: '=(D3*2+E3+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B3/INT(N3),1)*MAX(H3,I3)/100*I6,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        P3: '=M3*4/(I4/100)',
        B4: '=B2',
        I4: '=D4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(I4/100*2*B4/INT(J4/H4)*I7,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        A6: '=A3',
        C6: '=H3*I3*1.2/10000',
        E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H6: '=O3*0.8',
        J6: '=(B6+C6+F6+H6/B3)*I6+E6+G6',
        A7: '=A4',
        E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H7: '=O4*0.8',
        J7: '=(B7+C7+F7+H7/B4)*I7+E7+G7',
        J8: '=SUM(J6:J7)',
        J9: '=J8+I9',
        K9: '=J9*1.1',
        J10: '=(J9-J8)*B2',
      },
    },

    // 款式2：有底无侧普通袋
    // 基准来源：生产环境手动创建模板「12安涤棉」（sheet-tpl-1787670684354-689，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '2': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
        ['成品', 1000, 38, 40, 8, null, null, null, null, null, null, null, null, null, null, null],
        ['正反面', 1000, 38, 40, 8, 3, 10, 41, 98, 154, 340, 31, 344, 3.7560975609756095, 175.27986, 2114.9907692307693],
        ['手提', 1000, 2.5, 65, 0, null, null, 6, 65, 154, 340, 4, 55, 25.666666666666668, 27.846, null],
        [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
        ['正反面', 0.6, 0.4821599999999999, 5.2, 1.8871672000000004, 0.05, 0.1, 140.22388800000002, 1.05, 3.3231702824000005, null, null, null, null, null, null],
        ['手提', null, 0, 5.2, 0.33892, null, null, 22.2768, 1.05, 0.36231064, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, 3.6854809224000005, null, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.45, 4.1354809224, 4.54902901464, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 449.9999999999997, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2',
        C3: '=C2',
        D3: '=D2',
        E3: '=E2',
        H3: '=F3+C3',
        I3: '=(D3*2+E3+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B3/INT(N3),1)*MAX(H3,I3)/100*I6,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        P3: '=M3*4/(I4/100)',
        B4: '=B2',
        I4: '=D4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(I4/100*2*B4/INT(J4/H4)*I6,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        A6: '=A3',
        C6: '=H3*I3*1.2/10000',
        E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H6: '=O3*0.8',
        J6: '=(B6+C6+F6+H6/B3)*I6+G6+E6',
        A7: '=A4',
        E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H7: '=O4*0.8',
        J7: '=(B7+C7+F7+H7/B4)*I7+G7+E7',
        J8: '=SUM(J6:J7)',
        J9: '=J8+I9',
        K9: '=J9*1.1',
        J10: '=(J9-J8)*B2',
      },
    },

    // 款式3：有底有侧普通袋
    // 基准来源：生产环境手动创建模板「12安-侧底相连」（sheet-tpl-1787713562515-988，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '3': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 300, 40, 35, 12, null, null, null, null, null, null, null, null, null, 70.686, 235.62000000000003],
        ['正面', 300, 40, 35, 0, 2, 5, 42, 40, 154, 340, 34, 45, 3.85, 22.491000000000003, null],
        ['反面', 300, 40, 35, '0.00', '2.00', '5.00', 42, 40, '154.00', '340.00', 34, 45, 3.85, 22.491000000000003, ''],
        ['侧底', 300, 12, 110, 0, 2, 10, 14, 120, 154, 340, 0, 36, 11, 17.9928, null],
        ['手提', 300, 2.5, 60, 0, null, null, 6, 60, 154, 340, 4, 16, 25.666666666666668, 7.7112, null],
        ['', '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本-打叉', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['正面', 1.2, 0.2016, 5.2, 0.8544000000000002, 0.05, 0.15, 40.48380000000001, 1.05, 2.6702733000000003, null, null, null, null, null, null],
        ['反面', '0', 0, '5.2', 0.8544000000000002, '0', '0', 40.48380000000001, '1.05', 0.9960933000000002, '', '', '', '', '', ''],
        ['侧底', null, null, 5.2, 0.7015200000000001, 0, 0, 32.38704, 1.05, 0.8148746400000001, null, null, null, null, null, null],
        ['手提', null, null, 5.2, 0.35208, null, null, 13.88016, 1.05, 0.40066056, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, 4.8819018000000005, 5.370091980000001, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.6, 5.4819018, 6.030091980000001, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 179.9999999999999, null, null, null, null, null, null],
      ],
      formulas: {
        O2: '=SUM(O3:O6)',
        P2: '=O2/B2*1000',
        B3: '=B2',
        C3: '=C2',
        D3: '=D2',
        H3: '=F3+C3',
        I3: '=(D3+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B2/INT(N3),1)*MAX(H3,I3)/100*I8,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*1.5*K3/1000',
        B4: '=B3',
        C4: '=C3',
        D4: '=D3',
        H4: '=F4+C4',
        I4: '=(D4+G4)',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(CEILING(B3/INT(N4),1)*MAX(H4,I4)/100*I9,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*1.5*K4/1000',
        B5: '=B2',
        C5: '=E2',
        D5: '=C2+D2*2',
        H5: '=E2+F5',
        I5: '=D5+G5',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(CEILING(B4/INT(N5),1)*MAX(H5,I5)/100*I10,1)',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*1.5*K5/1000',
        B6: '=B2',
        I6: '=D6',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(I6/100*2*B2/INT(J6/H6)*I11,1)',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*1.5*K6/1000',
        A8: '=A3',
        C8: '=H3*I3*1.2/10000',
        E8: '=D8*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
        H8: '=O3*1.8',
        J8: '=(B8+F8+C8+H8/B2)*I8+G8+E8',
        A9: '=A4',
        E9: '=D9*M4/B3+CEILING(M4/100,1)*15/B3+0.04',
        H9: '=O4*1.8',
        J9: '=(B9+F9+C9+H9/B3)*I9+G9+E9',
        A10: '=A5',
        E10: '=D10*M5/B3+CEILING(M5/100,1)*15/B3+0.04',
        H10: '=O5*1.8',
        J10: '=(B10+F10+C10+H10/B4)*I10+G10+E10',
        A11: '=A6',
        E11: '=D11*M6/B4+CEILING(M6/100,1)*15/B4+0.04',
        H11: '=O6*1.8',
        J11: '=(B11+F11+C11+H11/B5)*I11+G11+E11',
        J12: '=SUM(J8:J11)',
        K12: '=J12*1.1',
        J13: '=J12+I13',
        K13: '=J13*1.1',
        J14: '=(J13-J12)*B2',
      },
    },

    // 款式4：手提连底普通拼接袋
    // 基准来源：生产环境手动创建模板「33*28*15」（sheet-tpl-1787798945855-182，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '4': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 1000, 33, 28, 15, null, null, null, null, null, null, null, null, null, 185.90596500000004, 185.90596500000004],
        ['底部', 1000, 33, 7.5, 15, 4, 3, 37, 33, 148, 340, 16, 101, 4.484848484848484, 51.42075, null],
        ['正面', 1000, 33, 20.5, null, 4, 4, 37, 24.5, 154, 340, 7, 65, 6.285714285714286, 33.088545, null],
        ['反面', 1000, 33, 20.5, null, 4, 4, 37, 24.5, 154, 340, 7, 65, 6.285714285714286, 33.088545, null],
        ['外口袋', 1000, 17, 17, null, 2, 2, 19, 19, 154, 340, 2, 25, 8.105263157894736, 12.718125, null],
        ['手提', 1000, 3.2, 95, 0, null, null, 7.6, 95, 148, 340, 3.6000000000000068, 110, 19.473684210526315, 55.59000000000002, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 1.8, 0, 9.5, 1.0278375, 0.2, 0.15, 41.1366, 1.09, 3.402676394, null, null, null, null, null, null],
        ['正面', 0, 0, 5.2, 0.39237340000000004, 0, 0, 26.470836000000006, 1.05, 0.42016777780000003, null, null, null, null, null, null],
        ['反面', 0, 0, 5.2, 0.39237340000000004, 0, 0, 26.470836000000006, 1.05, 0.42016777780000003, null, null, null, null, null, null],
        ['外口袋', 0, 0.5, 5.2, 0.184675, 0, 0, 10.174500000000002, 1.05, 0.720358225, null, null, null, null, null, null],
        ['手提', null, 0, 9.5, 1.0955000000000004, null, null, 44.472000000000016, 1.09, 1.1439744800000005, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 148.72477200000003, null, 6.107344654600001, 6.718079120060002, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 1.2, 7.307344654600001, 8.038079120060003, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 1200.0000000000002, null, null, null, null, null, null],
      ],
      formulas: {
        O2: '=SUM(O3:O7)',
        P2: '=O2/B2*1000',
        B3: '=B2',
        C3: '=C2',
        D3: '=E2/2',
        E3: '=E2',
        H3: '=F3+C3',
        I3: '=E3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B2/INT(N3),1)*MAX(H3,I3)/100*I9,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B2',
        C4: '=C2',
        D4: '=D2-D3',
        H4: '=F4+C2',
        I4: '=G4+D2-E2/2',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(CEILING(B3/INT(N4),1)*MAX(H4,I4)/100*I10,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B2',
        C5: '=C2',
        D5: '=D2-D3',
        H5: '=F5+C2',
        I5: '=G5+D2-E2/2',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(CEILING(B4/INT(N5),1)*MAX(H5,I5)/100*I11,1)',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B3',
        H6: '=F6+C6',
        I6: '=G6+D6-E6/2',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(CEILING(B5/INT(N6),1)*MAX(H6,I6)/100*I12,1)',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B2',
        I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=CEILING(I7/100*2*B2/INT(J7/H7)*I13,1)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        A9: '=A3',
        E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*0.8',
        J9: '=(B9+C9+H9/B2+F9)*I9+G9+E9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*0.8',
        J10: '=(B10+C10+H10/B3+F10)*I10+G10+E10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*0.8',
        J11: '=(B11+C11+H11/B4+F11)*I11+G11+E11',
        A12: '=A6',
        E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04',
        H12: '=O6*0.8',
        J12: '=(B12+C12+H12/B5+F12)*I12+G12+E12',
        A13: '=A7',
        E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7',
        H13: '=O7*0.8',
        J13: '=(B13+C13+H13/B6+F13)*I13+G13+E13',
        H14: '=SUM(H9:H13)',
        J14: '=SUM(J9:J13)',
        K14: '=J14*1.1',
        J15: '=J14+I15',
        K15: '=J15*1.1',
        J16: '=(J15-J14)*B2',
      },
    },

    // 款式5：手提连底高级拼接袋
    // 基准来源：生产环境手动创建模板「45*35*15」（sheet-tpl-1788699442238-853，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '5': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量(kg)', '单个克重'],
        ['成品', 500, 45, 35, 15, null, null, null, null, null, null, null, null, null, 236.9239875, 473.847975],
        ['底部', 500, 45, 4, 15, 4, 4, 49, 27, 148, 450, 13, 54, 5.481481481481482, 36.05175, null],
        ['正反面', 500, 45, 31, null, 4, 6, 49, 91, 154, 450, 7, 160, 3.142857142857143, 107.70873749999998, null],
        ['包边条', 500, 4, 160, 0, null, null, 4, 160, 154, 450, 2, 24, 38.5, 15.876, null],
        ['手提', 500, 3.2, 120, 0, null, null, 6, 120, 148, 450, 4, 55, 24.666666666666668, 36.78750000000001, null],
        ['阴阳手提-本色', 500, 3.5, 120, 0, null, null, 7, 120, 148, 450, 1, 61, 21.142857142857142, 40.50000000000001, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 5, 0, 13, 1.45866, 0.2, 0.15, 64.89315, 1.09, 7.418127067000001, null, null, null, null, null, null],
        ['正反面', 0, 0.5, 7, 2.333959, 0, 0, 193.87572749999998, 1.05, 3.26609802775, null, null, null, null, null, null],
        ['包边条', 0.3, 0, 5.5, 0.32871999999999996, 0, 0, 28.5768, 1.05, 0.70373128, null, null, null, null, null, null],
        ['手提', 0.432, null, 13, 1.4370000000000003, null, null, 66.21750000000002, 1.09, 2.0522341500000003, null, null, null, null, null, null],
        ['阴阳手提-本色', null, null, 7, 0.8600000000000001, null, null, 72.90000000000002, 1.05, 1.01309, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 426.46317750000003, null, 14.453280524750001, 15.898608577225003, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 4, 18.45328052475, 20.298608577225, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 1999.999999999999, null, null, null, null, null, null],
      ],
      formulas: {
        O2: '=SUM(O3:O7)',
        P2: '=O2/B2*1000',
        B3: '=B2',
        C3: '=C2',
        E3: '=E2',
        H3: '=F3+C3',
        I3: '=E3+D3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B2/INT(N3),1)*MAX(H3,I3)/100*I9,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B3',
        C4: '=C2',
        D4: '=D2-D3',
        H4: '=F4+C2',
        I4: '=D2*2+E2+G4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(CEILING(B3/INT(N4),1)*MAX(H4,I4)/100*I10,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B3',
        D5: '=(D2+C2)*2',
        H5: '=C5',
        I5: '=D5',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(CEILING(B4/INT(N5),1)*MAX(H5,I5)/100*I11,1)',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B2',
        I6: '=D6',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(I6/100*2*B6/INT(J6/H6)*I12,1)',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B2',
        D7: '=D6',
        I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=CEILING(I7/100*2*B7/INT(J7/H7)*I13,1)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        A9: '=A3',
        E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*1.8',
        J9: '=(B9+C9+H9/B2+F9)*I9+G9+E9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*1.8',
        J10: '=(B10+C10+H10/B3+F10)*I10+G10+E10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*1.8',
        J11: '=(B11+C11+H11/B4+F11)*I11+G11+E11',
        A12: '=A6',
        B12: '=D6/100*2*0.18',
        E12: '=(M6*D12/B6+CEILING(M6/100,1)*10/B6)',
        H12: '=O6*1.8',
        J12: '=(B12+C12+H12/B5+F12)*I12+G12+E12',
        A13: '=A7',
        E13: '=(M7*D13/B7+CEILING(M7/100,1)*10/B7)',
        H13: '=O7*1.8',
        J13: '=(B13+C13+H13/B6+F13)*I13+G13+E13',
        H14: '=SUM(H9:H13)',
        J14: '=SUM(J9:J13)',
        K14: '=J14*1.1',
        J15: '=J14+I15',
        K15: '=J15*1.1',
        J16: '=(J15-J14)*B2',
      },
    },

    // 款式6：手提无连底拼接袋
    // 基准来源：生产环境手动创建模板「40*35*10」（sheet-tpl-1788700559087-470，2026-09-14 导出）
    // 布料米数已按取整口径处理（M 列数值向上取整、公式整体包裹 CEILING(...,1)，见 src/services/fabricMeters.ts）
    '6': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 1000, 33, 28, 15, null, null, null, null, null, null, null, null, null, 154.98900000000003, 154.98900000000003],
        ['底部', 1000, 33, 7.5, 15, 4, 3, 37, 33, 148, 340, 16, 101, 4.484848484848484, 51.42075, null],
        ['正面', 1000, 33, 20.5, null, 4, 3, 37, 23.5, 154, 340, 13, 65, 6.553191489361702, 33.088545, null],
        ['反面', 1000, 33, 20.5, null, 4, 3, 37, 23.5, 154, 340, 13, 65, 6.553191489361702, 33.088545, null],
        ['外口袋', 1000, 14, 14, 0, 2, 2, 16, 16, 154, 340, 10, 19, 9.625, 9.59616, null],
        ['手提', 1000, 2.5, 60, 0, null, null, 6, 60, 148, 340, 4, 55, 24.666666666666668, 27.79500000000001, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 1.3, 0, 9.5, 1.0278375, 0.2, 0.15, 92.55735, 1.09, 2.9137250115000004, null, null, null, null, null, null],
        ['正面', 0, 0.2, 5.5, 0.41183725000000004, 0, 0, 59.55938100000001, 1.05, 0.6843746000500002, null, null, null, null, null, null],
        ['反面', 0, 0, 5.5, 0.41183725000000004, 0, 0, 59.55938100000001, 1.05, 0.47437460005000004, null, null, null, null, null, null],
        ['外口袋', 0, 0, 5.5, 0.15848800000000002, 0, 0, 17.273087999999998, 1.05, 0.1766247424, null, null, null, null, null, null],
        ['手提', null, null, 9.5, 0.5677500000000002, null, null, 50.03100000000002, 1.09, 0.6222837900000002, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 278.9802, null, 4.871382744, 5.3585210184, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.6286172560000001, 5.5, 6.050000000000001, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 628.6172560000001, null, null, null, null, null, null],
      ],
      formulas: {
        O2: '=SUM(O3:O7)',
        P2: '=O2/B2*1000',
        B3: '=B2',
        C3: '=C2',
        D3: '=E2/2',
        E3: '=E2',
        H3: '=F3+C3',
        I3: '=E3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(CEILING(B2/INT(N3),1)*MAX(H3,I3)/100*I9,1)',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B2',
        C4: '=C2',
        D4: '=D2-D3',
        H4: '=F4+C2',
        I4: '=G4+D2-E2/2',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(CEILING(B3/INT(N4),1)*MAX(H4,I4)/100*I10,1)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B4',
        C5: '=C2',
        D5: '=D2-D3',
        H5: '=F5+C2',
        I5: '=G5+D2-E2/2',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(CEILING(B4/INT(N5),1)*MAX(H5,I5)/100*I11,1)',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B5',
        H6: '=F6+C6',
        I6: '=G6+D6',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(CEILING(B5/INT(N6),1)*MAX(H6,I6)/100*I12,1)',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B6',
        I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=CEILING(I7/100*2*B2/INT(J7/H7)*I13,1)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        A9: '=A3',
        E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*1.8',
        J9: '=(B9+C9+H9/B2+F9)*I9+G9+E9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*1.8',
        J10: '=(B10+C10+H10/B3+F10)*I10+G10+E10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*1.8',
        J11: '=(B11+C11+H11/B4+F11)*I11+G11+E11',
        A12: '=A6',
        E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04',
        H12: '=O6*1.8',
        J12: '=(B12+C12+H12/B5+F12)*I12+G12+E12',
        A13: '=A7',
        E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7',
        H13: '=O7*1.8',
        J13: '=(B13+C13+H13/B6+F13)*I13+G13+E13',
        H14: '=SUM(H9:H13)',
        J14: '=SUM(J9:J13)',
        K14: '=J14*1.1',
        I15: '=J15-J14',
        K15: '=J15*1.1',
        J16: '=(J15-J14)*B2',
      },
    },
  }

  /**
   * 根据款式 code + 模板 id 获取模板（返回深拷贝，防止外部修改内部数据）
   *
   * 查找优先级：templateId 对应的数据库模板 → 内置款式模板 → 默认内置模板
   * - templateId 为空（历史订单/未选择）：使用内置模板兜底
   * - templateId 对应模板已被删除：回退内置模板（订单保存的 tableData 不受影响）
   *
   * @param style 款式 code（'1'-'6'）或其他值
   * @param templateId 数据库模板 id（'' = 内置默认）
   * @returns 模板的深拷贝
   */
  static getTemplate(style: string, templateId?: string): SheetTemplate {
    if (templateId) {
      const byId = SheetTemplateManager.getTemplateById(templateId)
      if (byId) return byId
    }
    const template = SheetTemplateManager.TEMPLATES[style]
      ?? SheetTemplateManager.TEMPLATES[SheetTemplateManager.DEFAULT_STYLE]
    return SheetTemplateManager.deepClone(template)
  }

  /**
   * 获取内置默认模板（无底无侧普通袋）的深拷贝
   */
  static getDefaultTemplate(): SheetTemplate {
    return SheetTemplateManager.deepClone(SheetTemplateManager.TEMPLATES[SheetTemplateManager.DEFAULT_STYLE])
  }

  /**
   * 获取内置模板（忽略数据库覆盖）的深拷贝 — 模板管理页"从当前模板开始编辑"时使用
   */
  static getBuiltinTemplate(style: string): SheetTemplate {
    const template = SheetTemplateManager.TEMPLATES[style] ?? SheetTemplateManager.TEMPLATES[SheetTemplateManager.DEFAULT_STYLE]
    return SheetTemplateManager.deepClone(template)
  }

  /**
   * 判断指定款式是否有专属模板
   */
  static hasTemplate(style: string): boolean {
    return style in SheetTemplateManager.TEMPLATES
  }

  /**
   * 获取所有有模板的款式 code 列表
   */
  static getAllStyles(): string[] {
    return Object.keys(SheetTemplateManager.TEMPLATES)
  }

  /**
   * 深拷贝模板（防止外部修改污染内部数据）
   * - data: 逐行拷贝数组
   * - formulas: 展开到新对象
   * - 布局配置（v34）: 展开到新数组
   */
  private static deepClone(template: SheetTemplate): SheetTemplate {
    return {
      data: template.data.map((row) => [...row]),
      formulas: { ...template.formulas },
      columnWidthConfig: (template.columnWidthConfig ?? []).map((c) => ({ ...c })),
      rowHeightConfig: (template.rowHeightConfig ?? []).map((h) => ({ ...h })),
    }
  }
}
