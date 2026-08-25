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
      }>
      const next: Record<string, SheetTemplateEntry> = {}
      for (const r of records) {
        if (r?.id && r.styleCode && Array.isArray(r.data) && r.data.length > 0) {
          next[r.id] = {
            id: r.id,
            styleCode: r.styleCode,
            name: r.name || '',
            template: { data: r.data, formulas: r.formulas || {} },
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
    // 款式1：无底无侧普通袋（底=0）
    '1': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
        ['成品', 7200, 38, 40, 0, null, null, null, null, null, null, null, null, null, null, null],
        ['正反面', 7200, 38, 40, 0, 3, 10, 41, 90, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
        ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
        [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
        ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
        ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, 2.97, null, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.45, 3.42, 3.76, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 3240, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
        H3: '=F3+C3',
        I3: '=(D3*2+E3+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        P3: '=M3*4/(I4/100)',
        B4: '=B2', I4: '=D4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=I4/100*2*B4/INT(J4/H4)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        A6: '=A3',
        C6: '=H3*I3*1.1/10000',
        E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H6: '=O3*0.8',
        J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
        A7: '=A4',
        E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H7: '=O4*0.8',
        J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
        J8: '=SUM(J6:J7)',
        J9: '=J8+I9',
        K9: '=J9*1.1',
        J10: '=(J9-J8)*B2',
      },
    },

    // 款式2：有底无侧普通袋（底>0，影响计算逻辑）
    '2': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', '带刀手提条数'],
        ['成品', 7200, 38, 40, 8, null, null, null, null, null, null, null, null, null, null, null],
        ['正反面', 7200, 38, 40, 8, 3, 10, 41, 98, 154, 280, 31, 2160, 3.7561, 907.2, 12342.8571],
        ['手提', 7200, 2.5, 70, 0, null, null, 6, 70, 154, 280, 4, 403.2, 25.6667, 169.344, null],
        ['底部', 7200, 38, 8, 0, 3, 3, 41, 14, 154, 280, 154, null, 11, null, null],
        [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '参考卖价', '含税价', '实际卖价', null, null, null, null],
        ['正反面', 0.51, 0.4059, 4.4, 1.4058, 0.05, 0.1, 725.76, 1.03, 2.6467, null, null, null, null, null, null],
        ['手提', null, 0, 4.4, 0.2968, null, null, 135.48, 1.03, 0.3251, null, null, null, null, null, null],
        ['底部', null, 0, 4.4, null, null, null, null, 1.03, null, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.45, null, null, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
        H3: '=F3+C3',
        I3: '=(D3*2+E3+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        P3: '=M3*4/(I4/100)',
        B4: '=B2', I4: '=D4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=I4/100*2*B4/INT(J4/H4)',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B2', C5: '=C2', D5: '=E2',
        H5: '=F5+C5',
        I5: '=D5+G5*2',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        A7: '=A3',
        C7: '=H3*I3*1.1/10000',
        E7: '=D7*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H7: '=O3*0.8',
        J7: '=(B7+C7+F7+E7+H7/B3)*I7+G7',
        A8: '=A4',
        E8: '=D8*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H8: '=O4*0.8',
        J8: '=(B8+C8+E8+F8+H8/B4)*I8+G8',
        A9: '=A5',
        E9: '=D9*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        J9: '=(B9+C9+E9+F9)*I9+G9',
        J10: '=SUM(J7:J9)',
        J11: '=J10+I11',
        K11: '=J11*1.1',
        J12: '=(J11-J10)*B2',
      },
    },

    // 款式3：有底有侧普通袋
    '3': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 300, 40, 35, 12, null, null, null, null, null, null, null, null, null, 96, 320],
        ['正反面', 300, 40, 35, 0, 2, 10, 42, 80, 154, 500, 28, 80, 3.66666666666667, 60, null],
        ['侧底', 300, 12, 110, 0, 2, 10, 14, 120, 154, 500, 0, 33.6, 11, 25.2, null],
        ['手提', 300, 3.8, 60, 0, null, null, 6, 60, 154, 500, 4, 14.4, 25.6666666666667, 10.8, null],
        [null, '加工费(元/个)', '印刷双面（元/个）', '布料价格', '布料成本（元）', '额外工艺成本-打叉', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['正反面', 1.5, 0.4032, 7.2, 2.01, 1.25, 0.2, 108, 1.03, 5.888896, null, null, null, null, null, null],
        ['侧底', null, null, 7.2, 0.8964, 0, 0, 45.36, 1.03, 1.079028, null, null, null, null, null, null],
        ['手提', null, null, 7.2, 1.7, null, null, 19.44, 1.03, 1.817744, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, null, null, 8.785668, 9.6642348, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 1, 9.785668, 10.7642348, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 300, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', D3: '=D2',
        H3: '=F3+C2',
        I3: '=(D3*2+G3)',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*1.5*K3/1000',
        B4: '=B2', C4: '=E2', D4: '=C2+D2*2',
        H4: '=E2+F4',
        I4: '=C2+D2*2+G4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(B3/INT(N4),1)*MAX(H4,I4)/100',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*1.5*K4/1000',
        B5: '=B2', I5: '=D5',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=I5/100*2*B2/INT(J5/H5)',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*1.5*K5/1000',
        O2: '=SUM(O3:O5)',
        P2: '=O2/B2*1000',
        A7: '=A3', C7: '=H3*I3*1.2/10000',
        E7: '=D7*M3/B2+CEILING(M3/100,1)*15/B2+0.04',
        H7: '=O3*1.8',
        J7: '=(B7+F7+C7+E7+H7/B2)*I7+G7',
        A8: '=A4',
        E8: '=D8*M4/B3+CEILING(M4/100,1)*15/B3+0.04',
        H8: '=O4*1.8',
        J8: '=(B8+F8+C8+E8+H8/B3)*I8+G8',
        A9: '=A5', H9: '=O5*1.8',
        J9: '=(B9+C9+E9+F9+H9/B2)*I9+G9',
        J10: '=SUM(J7:J9)', K10: '=J10*1.1',
        J11: '=J10+I11', K11: '=J11*1.1',
        J12: '=(J11-J10)*B2',
      },
    },

    // 款式4：手提连底普通拼接袋
    '4': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 1000, 40, 35, 10, null, null, null, null, null, null, null, null, null, 212.7873, 212.7873],
        ['底部', 1000, 40, 5, 10, 4, 3, 44, 23, 148, 340, 10, 73.48, 6.43478260869565, 37.4748, null],
        ['正面', 1000, 40, 30, null, 4, 6, 44, 36, 154, 340, 10, 110, 4.27777777777778, 56.1, null],
        ['反面', 1000, 40, 30, null, 4, 6, 44, 36, 154, 340, 10, 110, 4.27777777777778, 56.1, null],
        ['外口袋', 1000, 17, 17, null, 2, 2, 19, 19, 154, 340, 2, 23.75, 8.10526315789474, 12.1125, null],
        ['手提', 1000, 2.5, 120, 0, null, null, 6, 120, 148, 340, 4, 100, 24.6666666666667, 51, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 1.8, 0, 9.5, 0.75306, 0.2, 0.15, 29.97984, 1.03, 3.0165310352, null, null, null, null, null, null],
        ['正面', 0, 0, 5.2, 0.642, 0, 0, 44.88, 1.03, 0.7074864, null, null, null, null, null, null],
        ['反面', 0, 0, 5.2, 0.642, 0, 0, 44.88, 1.03, 0.7074864, null, null, null, null, null, null],
        ['外口袋', 0, 0.5, 5.2, 0.1785, 0, 0, 9.69, 1.03, 0.7088357, null, null, null, null, null, null],
        ['手提', null, 0, 9.5, 1, null, null, 40.8, 1.03, 1.072024, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 170.22984, null, 6.2123635352, 6.83359988872, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 1.2, 7.4123635352, 8.15359988872, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 1200, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2',
        H3: '=F3+C3', I3: '=E3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B2', C4: '=C2', D4: '=D2-D3',
        H4: '=F4+C2', I4: '=G4+D2-E2/2',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B2', C5: '=C2', D5: '=D2-D3',
        H5: '=F5+C2', I5: '=G5+D2-E2/2',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B3', H6: '=F6+C6', I6: '=G6+D6-E6/2',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(B3/INT(N6),1)*MAX(H6,I6)/100',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B2', I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=I7/100*2*B2/INT(J7/H7)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
        A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*0.8',
        J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*0.8',
        J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*0.8',
        J11: '=(B11+C11+E11+H11/B2)*I11+G11',
        A12: '=A6',
        E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04',
        H12: '=O6*0.8',
        J12: '=(B12+C12+E12+F12+H12/B4)*I12+G12',
        A13: '=A7',
        E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7',
        H13: '=O7*0.8',
        J13: '=(E13+H13/B2)*I13+G13',
        H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
        J15: '=J14+I15', K15: '=J15*1.1',
        J16: '=(J15-J14)*B2',
      },
    },

    // 款式5：手提连底高级拼接袋
    '5': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量(kg)', '单个克重'],
        ['成品', 500, 45, 35, 15, null, null, null, null, null, null, null, null, null, 168.561557142857, 337.123114285714],
        ['底部', 500, 45, 4, 15, 4, 4, 49, 27, 148, 340, 13, 49, 5.48148148148148, 24.99, null],
        ['正反面', 500, 45, 31, null, 4, 6, 49, 91, 154, 340, 7, 151.97, 3.14285714285714, 77.5047, null],
        ['包边条', 500, 4, 160, 0, null, null, 4, 160, 154, 340, 2, 22.4, 38.5, 11.424, null],
        ['手提', 500, 3.2, 120, 0, null, null, 6, 120, 148, 340, 4, 50, 24.6666666666667, 25.5, null],
        ['阴阳手提-本色', 500, 3.5, 120, 0, null, null, 7, 120, 148, 340, 1, 57.1428571428571, 21.1428571428571, 29.1428571428571, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 5, 0, 13, 1.344, 0.2, 0.15, 44.982, 1.03, 6.98298292, null, null, null, null, null, null],
        ['正反面', 0, 0.5, 7.5, 2.37955, 0, 0, 139.50846, 1.03, 3.2533239276, null, null, null, null, null, null],
        ['包边条', 0.3, 0, 5.5, 0.3164, 0, 0, 20.5632, 1.03, 0.6760184, null, null, null, null, null, null],
        ['手提', 0.432, null, 13, 1.32, null, null, 45.9, 1.03, 1.899114, null, null, null, null, null, null],
        ['阴阳手提-本色', null, null, 9.5, 1.10571428571429, null, null, 52.4571428571429, 1.03, 1.24694742857143, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 250.95366, null, 12.8114392476, 14.09258317236, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 4, 16.8114392476, 18.49258317236, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 2000, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', E3: '=E2',
        H3: '=F3+C3', I3: '=E3+D3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B3', C4: '=C2', D4: '=D2-D3',
        H4: '=F4+C2', I4: '=D2*2+E2+G4',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B3', D5: '=(D2+C2)*2',
        H5: '=C5', I5: '=D5',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(B3/INT(N5),1)*MAX(H5,I5)/100',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B2', I6: '=D6',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=I6/100*2*B6/INT(J6/H6)',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B2', D7: '=D6', I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=I7/100*2*B7/INT(J7/H7)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
        A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*1.8',
        J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*1.8',
        J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*1.8',
        J11: '=(B11+C11+E11+F11)*I11+H11/B3+G11',
        A12: '=A6',
        B12: '=D6/100*2*0.18',
        E12: '=(M6*D12/B6+CEILING(M6/100,1)*10/B6)',
        H12: '=O6*1.8',
        J12: '=(B12+E12+H12/B2)*I12+G12',
        A13: '=A7',
        E13: '=(M7*D13/B7+CEILING(M7/100,1)*10/B7)',
        H13: '=O7*1.8',
        J13: '=(B13+E13+H13/B3)*I13+G13',
        H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
        J15: '=J14+I15', K15: '=J15*1.1',
        J16: '=(J15-J14)*B2',
      },
    },

    // 款式6：手提无连底拼接袋
    '6': {
      data: [
        [null, '数量 (个)', '宽(CM)', '高(CM)', '底(CM)', '宽出血', '高出血', '切片宽', '切片高', '布料门幅', '克重', '门幅剩余废料', '布料米数(M)', '门幅最大面数(个)', '总重量', null],
        ['成品', 1000, 33, 28, 15, null, null, null, null, null, null, null, null, null, 144.84, 144.84],
        ['底部', 1000, 33, 7.5, 15, 4, 3, 37, 33, 148, 340, 16, 92.5, 4.48484848484848, 47.175, null],
        ['正面', 1000, 33, 20.5, null, 4, 3, 37, 23.5, 154, 340, 13, 61.79, 6.5531914893617, 31.5129, null],
        ['反面', 1000, 33, 20.5, null, 4, 3, 37, 23.5, 154, 340, 13, 61.79, 6.5531914893617, 31.5129, null],
        ['外口袋', 1000, 14, 14, 0, 2, 2, 16, 16, 154, 340, 10, 17.92, 9.625, 9.1392, null],
        ['手提', 1000, 2.5, 60, 0, null, null, 6, 60, 148, 340, 4, 50, 24.6666666666667, 25.5, null],
        [null, '加工费(元/个)', '印刷（元/个）', '布料价格', '不同安数布料成本（元）', '额外工艺成本', '包装费', '运费单价(元)', '损耗系数', '单个布袋总价（元）', null, null, null, null, null, null],
        ['底部', 1.3, 0, 9.5, 0.93375, 0.2, 0.15, 84.915, 1.03, 2.74422495, null, null, null, null, null, null],
        ['正面', 0, 0.2, 5.5, 0.394845, 0, 0, 56.72322, 1.03, 0.6711152666, null, null, null, null, null, null],
        ['反面', 0, 0, 5.5, 0.394845, 0, 0, 56.72322, 1.03, 0.4651152666, null, null, null, null, null, null],
        ['外口袋', 0, 0, 5.5, 0.15356, 0, 0, 16.45056, 1.03, 0.17461736, null, null, null, null, null, null],
        ['手提', null, null, 9.5, 0.525, null, null, 45.9, 1.03, 0.588027, null, null, null, null, null, null],
        ['汇总', null, null, null, null, null, null, 260.712, null, 4.6430998432, 5.10740982752, null, null, null, null, null],
        ['参考卖价', null, null, null, null, null, null, null, 0.856900156799999, 5.5, 6.05, null, null, null, null, null],
        ['利润', null, null, null, null, null, null, null, null, 856.900156799999, null, null, null, null, null, null],
      ],
      formulas: {
        B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2',
        H3: '=F3+C3', I3: '=E3*2+G3',
        L3: '=MOD(J3,MIN(H3,I3))',
        M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
        N3: '=J3/(MIN(H3,I3))',
        O3: '=M3*K3*1.5/1000',
        B4: '=B2', C4: '=C2', D4: '=D2-D3',
        H4: '=F4+C2', I4: '=G4+D2-E2/2',
        L4: '=MOD(J4,MIN(H4,I4))',
        M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
        N4: '=J4/(MIN(H4,I4))',
        O4: '=M4*K4*1.5/1000',
        B5: '=B4', C5: '=C2', D5: '=D2-D3',
        H5: '=F5+C2', I5: '=G5+D2-E2/2',
        L5: '=MOD(J5,MIN(H5,I5))',
        M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100',
        N5: '=J5/(MIN(H5,I5))',
        O5: '=M5*K5*1.5/1000',
        B6: '=B5', H6: '=F6+C6', I6: '=G6+D6',
        L6: '=MOD(J6,MIN(H6,I6))',
        M6: '=CEILING(B2/INT(N6),1)*MAX(H6,I6)/100',
        N6: '=J6/(MIN(H6,I6))',
        O6: '=M6*K6*1.5/1000',
        B7: '=B6', I7: '=D7',
        L7: '=MOD(J7,MIN(H7,I7))',
        M7: '=I7/100*2*B2/INT(J7/H7)',
        N7: '=J7/(MIN(H7,I7))',
        O7: '=M7*K7*1.5/1000',
        O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
        A9: '=A3', E9: '=D9*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
        H9: '=O3*1.8',
        J9: '=(B9+C9+E9+H9/B2+F9)*I9+G9',
        A10: '=A4',
        E10: '=D10*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
        H10: '=O4*1.8', I10: '=I9',
        J10: '=(B10+C10+E10+F10+H10/B2)*I10+G10',
        A11: '=A5',
        E11: '=D11*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
        H11: '=O5*1.8', I11: '=I10',
        J11: '=(B11+C11+E11+H11/B2)*I11+G11',
        A12: '=A6',
        E12: '=D12*M6/B6+CEILING(M6/100,1)*15/B6+0.04',
        H12: '=O6*1.8', I12: '=I11',
        J12: '=(B12+C12+E12+F12)*I12+H12/B2+G12',
        A13: '=A7',
        E13: '=M7*D13/B7+0.04+CEILING(M7/100,1)*10/B7',
        H13: '=O7*1.8', I13: '=I12',
        J13: '=(E13+H13/B2)*I13+G13',
        H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
        I15: '=J15-J14', K15: '=J15*1.1',
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
   */
  private static deepClone(template: SheetTemplate): SheetTemplate {
    return {
      data: template.data.map((row) => [...row]),
      formulas: { ...template.formulas },
    }
  }
}
