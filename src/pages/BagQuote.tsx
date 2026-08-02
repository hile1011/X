import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { RotateCcw, TrendingUp, DollarSign, ShoppingBag, Image as ImageIcon, Upload, X, ClipboardList, Table2, Save, ArrowLeft, CheckCircle, ChevronRight, ChevronLeft, Square, Circle, CircleDot, Play, Flag, Download, Loader2 } from 'lucide-react'
import { VTableSheet } from '@visactor/vtable-sheet'
import { TableExportPlugin, ExcelImportPlugin } from '@visactor/vtable-plugins'
import { api, downloadBlob } from '../api'
import CustomerSelect from '../components/CustomerSelect'
import { findTablePositions } from '../services/tableLocator'

interface OrderInfo {
  unitPrice: string
  productionTimeStart: string
  productionTimeEnd: string
  customerName: string
  shippingAddress: string
  productStyle: string
  productSpec: string
  fabricMaterial: string
  process: string
  handleMaterial: string
  handleSpec: string
  quantity: string
  boxSpec: string
  remark: string
  sampleFee: string
  sampleDays: string
  massDays: string
}

const today = new Date().toISOString().split('T')[0]

// 日期加天数：返回 YYYY-MM-DD 格式
const addDaysToDate = (dateStr: string, days: number): string => {
  if (!dateStr || !days || isNaN(days)) return ''
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return ''
  date.setDate(date.getDate() + days)
  return date.toISOString().split('T')[0]
}

const DEFAULT_ORDER_INFO: OrderInfo = {
  unitPrice: '',
  productionTimeStart: today,
  productionTimeEnd: '',
  customerName: '',
  shippingAddress: '',
  productStyle: '1',
  productSpec: '',
  fabricMaterial: '10安涤棉新本色',
  process: '单面数码uv印刷',
  handleMaterial: '帆布手提',
  handleSpec: '',
  quantity: '',
  boxSpec: '',
  remark: '',
  sampleFee: '',
  sampleDays: '',
  massDays: '',
}

const STATUS_OPTIONS = [
  { value: 1, label: '报价中' },
  { value: 2, label: '打样中' },
  { value: 3, label: '做货中' },
  { value: 4, label: '已发货未收款' },
  { value: 5, label: '已发货已收款' },
  { value: 6, label: '结束' },
]

const PRODUCT_STYLE_OPTIONS = [
  { value: '1', label: '无底无侧普通袋' },
  { value: '2', label: '有底无侧普通袋' },
  { value: '3', label: '有底有侧普通袋' },
  { value: '4', label: '手提连底普通拼接袋' },
  { value: '5', label: '手提连底高级拼接袋' },
  { value: '6', label: '手提无连底拼接袋' },
]

const PRODUCTION_STEPS = [
  { id: 1, name: '面料采购', description: '采购所需面料' },
  { id: 2, name: '裁剪', description: '根据规格裁剪面料' },
  { id: 3, name: '印刷', description: '进行图案印刷' },
  { id: 4, name: '缝纫', description: '缝制袋子' },
  { id: 5, name: '质检', description: '质量检查' },
  { id: 6, name: '包装', description: '包装入库' },
]

// 在线表格初始数据（来源：帆布袋价格试算表-规格试算.xlsx sheet1）
// 根据款式类型定义不同的表格模版
interface SheetTemplate {
  data: (string | number | null)[][]
  formulas: Record<string, string>
}

// 空模板（款式没有对应模板时使用）
const EMPTY_TEMPLATE: SheetTemplate = {
  data: [],
  formulas: {},
}

// 款式1：无底无侧普通袋（底=0）
const TEMPLATE_NO_BOTTOM_NO_SIDE: SheetTemplate = {
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
    // 行2 正反面（规格试算）
    B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
    H3: '=F3+C3',
    I3: '=(D3*2+E3+G3)',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*K3*1.5/1000',
    P3: '=M3*4/(I4/100)',
    // 行3 手提（规格试算）
    B4: '=B2', I4: '=D4',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=I4/100*2*B4/INT(J4/H4)',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*K4*1.5/1000',
    // 行5 正反面（成本核算）
    A6: '=A3',
    C6: '=H3*I3*1.1/10000',
    E6: '=D6*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
    H6: '=O3*0.8',
    J6: '=(B6+C6+F6+E6+H6/B3)*I6+G6',
    // 行6 手提（成本核算）
    A7: '=A4',
    E7: '=D7*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
    H7: '=O4*0.8',
    J7: '=(B7+C7+E7+F7+H7/B4)*I7+G7',
    // 行7 汇总
    J8: '=SUM(J6:J7)',
    // 行8 参考卖价
    J9: '=J8+I9',
    K9: '=J9*1.1',
    // 行9 利润
    J10: '=(J9-J8)*B2',
  },
}

// 款式2：有底无侧普通袋（底>0，影响计算逻辑）
const TEMPLATE_WITH_BOTTOM_NO_SIDE: SheetTemplate = {
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
    // 行2 正反面（规格试算）
    B3: '=B2', C3: '=C2', D3: '=D2', E3: '=E2',
    H3: '=F3+C3',
    I3: '=(D3*2+E3+G3)',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B3/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*K3*1.5/1000',
    P3: '=M3*4/(I4/100)',
    // 行3 手提（规格试算）
    B4: '=B2', I4: '=D4',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=I4/100*2*B4/INT(J4/H4)',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*K4*1.5/1000',
    // 行4 底部（规格试算）
    B5: '=B2', C5: '=C2', D5: '=E2',
    H5: '=F5+C5',
    I5: '=D5+G5*2',
    L5: '=MOD(J5,MIN(H5,I5))',
    M5: '=CEILING(B5/INT(N5),1)*MAX(H5,I5)/100',
    N5: '=J5/(MIN(H5,I5))',
    O5: '=M5*K5*1.5/1000',
    // 行6 正反面（成本核算）
    A7: '=A3',
    C7: '=H3*I3*1.1/10000',
    E7: '=D7*M3/B3+CEILING(M3/100,1)*15/B3+0.04',
    H7: '=O3*0.8',
    J7: '=(B7+C7+F7+E7+H7/B3)*I7+G7',
    // 行7 手提（成本核算）
    A8: '=A4',
    E8: '=D8*M4/B4+CEILING(M4/100,1)*15/B4+0.04',
    H8: '=O4*0.8',
    J8: '=(B8+C8+E8+F8+H8/B4)*I8+G8',
    // 行8 底部（成本核算）
    A9: '=A5',
    E9: '=D9*M5/B5+CEILING(M5/100,1)*15/B5+0.04',
    J9: '=(B9+C9+E9+F9)*I9+G9',
    // 行9 汇总
    J10: '=SUM(J7:J9)',
    // 行10 参考卖价
    J11: '=J10+I11',
    K11: '=J11*1.1',
    // 行11 利润
    J12: '=(J11-J10)*B2',
  },
}

// 款式3：有底有侧普通袋
const TEMPLATE_WITH_BOTTOM_AND_SIDE: SheetTemplate = {
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
    // 行2 正反面
    B3: '=B2', C3: '=C2', D3: '=D2',
    H3: '=F3+C2',
    I3: '=(D3*2+G3)',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*1.5*K3/1000',
    // 行3 侧底
    B4: '=B2', C4: '=E2', D4: '=C2+D2*2',
    H4: '=E2+F4',
    I4: '=C2+D2*2+G4',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=CEILING(B3/INT(N4),1)*MAX(H4,I4)/100',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*1.5*K4/1000',
    // 行4 手提
    B5: '=B2', I5: '=D5',
    L5: '=MOD(J5,MIN(H5,I5))',
    M5: '=I5/100*2*B2/INT(J5/H5)',
    N5: '=J5/(MIN(H5,I5))',
    O5: '=M5*1.5*K5/1000',
    // 汇总行
    O2: '=SUM(O3:O5)',
    P2: '=O2/B2*1000',
    // 成本核算
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
    // 汇总
    J10: '=SUM(J7:J9)', K10: '=J10*1.1',
    // 参考卖价
    J11: '=J10+I11', K11: '=J11*1.1',
    // 利润
    J12: '=(J11-J10)*B2',
  },
}

// 款式4：手提连底普通拼接袋
const TEMPLATE_HAND_HELD_NORMAL_SPLICING: SheetTemplate = {
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
    // 行2 底部
    B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2',
    H3: '=F3+C3', I3: '=E3*2+G3',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*K3*1.5/1000',
    // 行3 正面
    B4: '=B2', C4: '=C2', D4: '=D2-D3',
    H4: '=F4+C2', I4: '=G4+D2-E2/2',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*K4*1.5/1000',
    // 行4 反面
    B5: '=B2', C5: '=C2', D5: '=D2-D3',
    H5: '=F5+C2', I5: '=G5+D2-E2/2',
    L5: '=MOD(J5,MIN(H5,I5))',
    M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100',
    N5: '=J5/(MIN(H5,I5))',
    O5: '=M5*K5*1.5/1000',
    // 行5 外口袋
    B6: '=B3', H6: '=F6+C6', I6: '=G6+D6-E6/2',
    L6: '=MOD(J6,MIN(H6,I6))',
    M6: '=CEILING(B3/INT(N6),1)*MAX(H6,I6)/100',
    N6: '=J6/(MIN(H6,I6))',
    O6: '=M6*K6*1.5/1000',
    // 行6 手提
    B7: '=B2', I7: '=D7',
    L7: '=MOD(J7,MIN(H7,I7))',
    M7: '=I7/100*2*B2/INT(J7/H7)',
    N7: '=J7/(MIN(H7,I7))',
    O7: '=M7*K7*1.5/1000',
    // 汇总行
    O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
    // 成本核算
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
    // 汇总
    H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
    // 参考卖价
    J15: '=J14+I15', K15: '=J15*1.1',
    // 利润
    J16: '=(J15-J14)*B2',
  },
}

// 款式5：手提连底高级拼接袋
const TEMPLATE_HAND_HELD_PREMIUM_SPLICING: SheetTemplate = {
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
    // 行2 底部
    B3: '=B2', C3: '=C2', E3: '=E2',
    H3: '=F3+C3', I3: '=E3+D3*2+G3',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*K3*1.5/1000',
    // 行3 正反面
    B4: '=B3', C4: '=C2', D4: '=D2-D3',
    H4: '=F4+C2', I4: '=D2*2+E2+G4',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*K4*1.5/1000',
    // 行4 包边条
    B5: '=B3', D5: '=(D2+C2)*2',
    H5: '=C5', I5: '=D5',
    L5: '=MOD(J5,MIN(H5,I5))',
    M5: '=CEILING(B3/INT(N5),1)*MAX(H5,I5)/100',
    N5: '=J5/(MIN(H5,I5))',
    O5: '=M5*K5*1.5/1000',
    // 行5 手提（原阴阳手提-染色）
    B6: '=B2', I6: '=D6',
    L6: '=MOD(J6,MIN(H6,I6))',
    M6: '=I6/100*2*B6/INT(J6/H6)',
    N6: '=J6/(MIN(H6,I6))',
    O6: '=M6*K6*1.5/1000',
    // 行6 阴阳手提-本色
    B7: '=B2', D7: '=D6', I7: '=D7',
    L7: '=MOD(J7,MIN(H7,I7))',
    M7: '=I7/100*2*B7/INT(J7/H7)',
    N7: '=J7/(MIN(H7,I7))',
    O7: '=M7*K7*1.5/1000',
    // 汇总行
    O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
    // 成本核算
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
    // 汇总
    H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
    // 参考卖价
    J15: '=J14+I15', K15: '=J15*1.1',
    // 利润
    J16: '=(J15-J14)*B2',
  },
}

// 款式6：手提无连底拼接袋
const TEMPLATE_HAND_HELD_NO_BOTTOM_SPLICING: SheetTemplate = {
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
    // 行2 底部
    B3: '=B2', C3: '=C2', D3: '=E2/2', E3: '=E2',
    H3: '=F3+C3', I3: '=E3*2+G3',
    L3: '=MOD(J3,MIN(H3,I3))',
    M3: '=CEILING(B2/INT(N3),1)*MAX(H3,I3)/100',
    N3: '=J3/(MIN(H3,I3))',
    O3: '=M3*K3*1.5/1000',
    // 行3 正面
    B4: '=B2', C4: '=C2', D4: '=D2-D3',
    H4: '=F4+C2', I4: '=G4+D2-E2/2',
    L4: '=MOD(J4,MIN(H4,I4))',
    M4: '=CEILING(B2/INT(N4),1)*MAX(H4,I4)/100',
    N4: '=J4/(MIN(H4,I4))',
    O4: '=M4*K4*1.5/1000',
    // 行4 反面
    B5: '=B4', C5: '=C2', D5: '=D2-D3',
    H5: '=F5+C2', I5: '=G5+D2-E2/2',
    L5: '=MOD(J5,MIN(H5,I5))',
    M5: '=CEILING(B2/INT(N5),1)*MAX(H5,I5)/100',
    N5: '=J5/(MIN(H5,I5))',
    O5: '=M5*K5*1.5/1000',
    // 行5 外口袋
    B6: '=B5', H6: '=F6+C6', I6: '=G6+D6',
    L6: '=MOD(J6,MIN(H6,I6))',
    M6: '=CEILING(B2/INT(N6),1)*MAX(H6,I6)/100',
    N6: '=J6/(MIN(H6,I6))',
    O6: '=M6*K6*1.5/1000',
    // 行6 手提
    B7: '=B6', I7: '=D7',
    L7: '=MOD(J7,MIN(H7,I7))',
    M7: '=I7/100*2*B2/INT(J7/H7)',
    N7: '=J7/(MIN(H7,I7))',
    O7: '=M7*K7*1.5/1000',
    // 汇总行
    O2: '=SUM(O3:O7)', P2: '=O2/B2*1000',
    // 成本核算
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
    // 汇总
    H14: '=SUM(H9:H13)', J14: '=SUM(J9:J13)', K14: '=J14*1.1',
    // 参考卖价
    I15: '=J15-J14', K15: '=J15*1.1',
    // 利润
    J16: '=(J15-J14)*B2',
  },
}

// 根据款式获取表格模版
const getTemplateByStyle = (style: string): SheetTemplate => {
  switch (style) {
    case '1': // 无底无侧普通袋
      return TEMPLATE_NO_BOTTOM_NO_SIDE
    case '2': // 有底无侧普通袋
      return TEMPLATE_WITH_BOTTOM_NO_SIDE
    case '3': // 有底有侧普通袋
      return TEMPLATE_WITH_BOTTOM_AND_SIDE
    case '4': // 手提连底普通拼接袋
      return TEMPLATE_HAND_HELD_NORMAL_SPLICING
    case '5': // 手提连底高级拼接袋
      return TEMPLATE_HAND_HELD_PREMIUM_SPLICING
    case '6': // 手提无连底拼接袋
      return TEMPLATE_HAND_HELD_NO_BOTTOM_SPLICING
    default:
      return EMPTY_TEMPLATE
  }
}

// 在线表格样式（来源：帆布袋价格试算表-规格试算.xlsx sheet1）
const SC = {
  yellow: '#FFFF00', blue: '#91AADF', orange: '#F4B382',
  darkOrange: '#EE822F', lightOrange: '#F8CBAD', red: '#FF0000', black: '#000000',
  headerBg: '#4472C4', headerColor: '#FFFFFF',
}
const BORDER = { borderColor: SC.black, borderLineWidth: 1 }

// 单元格样式覆盖（右键菜单设置）：key = "col,row"，value = 样式属性
const cellStyleOverrides = new Map<string, Record<string, unknown>>()
// 单元格数字格式覆盖：key = "col,row"，value = 小数位数（-1=常规, 0=整数, 2=2位, 4=4位）
const cellFormatOverrides = new Map<string, number>()

// 辅助：构建单元格样式（字体统一加大4号、加粗）
const cs = (
  bg?: string, color = SC.black, size = 10, bold = true, border = true,
): Record<string, unknown> => ({
  bgColor: bg, color, fontSize: size + 4,
  fontWeight: bold ? 'bold' : 'normal',
  ...(border ? BORDER : {}),
})

// 按行+列返回单元格样式（VTable 行列均为 0-based）
// 规则：第一列无值但其他列有值的行 → 标题颜色；其余行无背景色
const getCellStyle = (args: { row: number; col: number; table?: any }): Record<string, unknown> => {
  const { row, col, table } = args
  // 判断是否为标题行（第一列无值但其他列有值）
  let isTitleRow = false
  if (table?.getCellOriginValue) {
    const firstColValue = table.getCellOriginValue(0, row)
    if (firstColValue == null || firstColValue === '') {
      for (let c = 1; c < 16; c++) {
        const val = table.getCellOriginValue(c, row)
        if (val != null && val !== '') { isTitleRow = true; break }
      }
    }
  }
  const style = isTitleRow ? cs(SC.headerBg, SC.headerColor) : cs(undefined)

  // 合并用户通过右键菜单设置的样式覆盖
  const override = cellStyleOverrides.get(`${col},${row}`)
  return override ? { ...style, ...override } : style
}

const COL_WIDTHS = [100, 90, 80, 80, 80, 90, 90, 90, 90, 90, 80, 120, 110, 130, 100, 120]

const SHEET_COLUMNS = COL_WIDTHS.map((width, field) => ({
  field,
  width,
  style: getCellStyle,
  // 数值类型单元格保留2位小数（可通过右键菜单覆盖；不影响公式计算，公式引擎直接读取 data 原始值）
  fieldFormat: (record: any, col?: number, row?: number) => {
    const value = record?.[field]
    if (typeof value === 'number' && !isNaN(value)) {
      const fmt = (col != null && row != null) ? cellFormatOverrides.get(`${col},${row}`) : undefined
      if (fmt === -1) return value              // 常规
      if (fmt === 0) return Math.round(value)   // 整数
      if (fmt === 4) return value.toFixed(4)    // 4位小数
      return value.toFixed(2)                    // 默认2位小数
    }
    return value
  },
}))

export default function BagQuote() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isEditMode = !!id
  const customerId = searchParams.get('customerId')
  const [orderInfo, setOrderInfo] = useState<OrderInfo>(DEFAULT_ORDER_INFO)
  const [productImages, setProductImages] = useState<string[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [showSaveSuccess, setShowSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string>('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string>('')
  const [status, setStatus] = useState<number>(1)
  const [statusTimeNodes, setStatusTimeNodes] = useState<{
    quoteTime: string
    sampleTime: string
    productionStartTime: string
    shippingTime: string
    paymentTime: string
    endTime: string
  }>({
    quoteTime: '',
    sampleTime: '',
    productionStartTime: '',
    shippingTime: '',
    paymentTime: '',
    endTime: '',
  })
  const [productionStepStatus, setProductionStepStatus] = useState<Record<number, 'pending' | 'in_progress' | 'completed'>>({})

  const sheetContainerRef = useRef<HTMLDivElement>(null)
  const sheetInstanceRef = useRef<VTableSheet | null>(null)
  // 表格对订单信息的联动：成本价、含税价、单个卖价(不含税)/单个卖价(含税)
  const [costPrice, setCostPrice] = useState<number | null>(null)
  const [priceWithTax, setPriceWithTax] = useState<number | null>(null)
  const [sellPrices, setSellPrices] = useState<{ noTax: number | null; withTax: number | null }>({ noTax: null, withTax: null })

  useEffect(() => {
    if (isEditMode) {
      loadQuote()
    } else if (customerId) {
      // 从客户详情跳转过来，预填充客户信息
      loadCustomerInfo()
    }
  }, [isEditMode, customerId])

  const loadCustomerInfo = async () => {
    try {
      const customer = await api.customers.getById(customerId!)
      if (customer) {
        setOrderInfo(prev => ({
          ...prev,
          customerName: customer.name || '',
          shippingAddress: customer.address || '',
        }))
      }
    } catch (error) {
      console.error('加载客户信息失败:', error)
    }
  }

  const loadQuote = async () => {
    setLoading(true)
    try {
      const data = await api.quotes.getById(id!)
      if (data) {
        setOrderInfo({
          unitPrice: data.unitPrice || '',
          productionTimeStart: data.productionTimeStart || today,
          productionTimeEnd: data.productionTimeEnd || '',
          customerName: data.customerName || '',
          shippingAddress: data.shippingAddress || '',
          productStyle: data.productStyle || '1',
          productSpec: data.productSpec || '',
          fabricMaterial: data.fabricMaterial || '10安涤棉新本色',
          process: data.process || '单面数码uv印刷',
          handleMaterial: data.handleMaterial || '帆布手提',
          handleSpec: data.handleSpec || '',
          quantity: data.quantity || '',
          boxSpec: data.boxSpec || '',
          remark: data.remark || '',
          sampleFee: (data.sampleFee || '').replace(/元$/, ''),
          sampleDays: data.sampleDays || '',
          massDays: data.massDays || '',
        })
        setSellPrices({
          noTax: data.sellPriceNoTax || null,
          withTax: data.sellPriceWithTax || null,
        })
        setCostPrice(data.costPrice || null)
        setPriceWithTax(data.priceWithTax || null)
        setStatus(data.status || 1)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setProductImages(data.images || [])
      }
    } catch (error) {
      console.error('加载报价失败:', error)
    }
    setLoading(false)
  }

  const handleSave = async () => {
    setLoading(true)
    setSaveError('')
    try {
      // 同步客户名称和地址到客户管理
      const customerName = orderInfo.customerName.trim()
      if (customerName) {
        const existingCustomer = await api.customers.getByName(customerName)
        if (existingCustomer) {
          // 更新现有客户的地址
          await api.customers.update(existingCustomer.id, {
            address: orderInfo.shippingAddress || existingCustomer.address,
          })
        } else {
          // 创建新客户
          await api.customers.create({
            name: customerName,
            address: orderInfo.shippingAddress || '',
          })
        }
      }

      const quoteData = {
        ...orderInfo,
        costPrice: costPrice || 0,
        priceWithTax: priceWithTax || 0,
        sellPriceNoTax: sellPrices.noTax || 0,
        sellPriceWithTax: sellPrices.withTax || 0,
        status,
        images: productImages,
      }
      if (isEditMode) {
        await api.quotes.update(id!, quoteData)
      } else {
        await api.quotes.create(quoteData)
      }
      setShowSaveSuccess(true)
      setTimeout(() => setShowSaveSuccess(false), 3000)
      if (!isEditMode) {
        navigate('/quotes')
      }
    } catch (error: any) {
      console.error('保存报价失败:', error)
      setSaveError(error?.message || '保存失败，请重试')
      setTimeout(() => setSaveError(''), 5000)
    }
    setLoading(false)
  }

  // 导出当前订单 + 在线表格（含公式）到 Excel
  const handleExportWithTable = async () => {
    if (!id) {
      setExportError('请先保存订单后再导出')
      setTimeout(() => setExportError(''), 5000)
      return
    }
    const sheet = sheetInstanceRef.current
    if (!sheet) {
      setExportError('表格未初始化')
      setTimeout(() => setExportError(''), 5000)
      return
    }
    setExporting(true)
    setExportError('')
    try {
      // 从表格实例提取当前二维数据（包含用户编辑后的值）
      const ws = sheet.getActiveSheet()
      const activeTable = ws?.tableInstance as any
      const rowCount = activeTable?.rowCount ?? 0
      const colCount = activeTable?.colCount ?? 16
      const tableData: (string | number | null)[][] = []
      for (let r = 0; r < rowCount; r++) {
        const rowData: (string | number | null)[] = []
        for (let c = 0; c < colCount; c++) {
          rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
        }
        tableData.push(rowData)
      }
      // 从当前款式模板获取公式定义
      const template = getTemplateByStyle(orderInfo.productStyle)
      const blob = await api.export.orderWithTable(id, { data: tableData, formulas: template.formulas })
      const now = new Date()
      const ts = now.toISOString().replace(/[-T:]/g, '').substring(0, 14)
      downloadBlob(blob, `Order_${orderInfo.customerName || 'Export'}_${ts}.xlsx`)
    } catch (error) {
      console.error('导出失败:', error)
      setExportError(error instanceof Error ? error.message : '导出失败，请重试')
      setTimeout(() => setExportError(''), 5000)
    }
    setExporting(false)
  }

  useEffect(() => {
    if (!sheetContainerRef.current) return

    const template = getTemplateByStyle(orderInfo.productStyle)
    
    const sheet = new VTableSheet(sheetContainerRef.current, {
      undoRedo: { show: true },
      VTablePluginModules: [
        { module: TableExportPlugin },
        { module: ExcelImportPlugin },
      ],
      sheets: [
        {
          sheetKey: 'sheet1',
          sheetTitle: 'sheet1',
          columns: SHEET_COLUMNS,
          data: template.data,
          formulas: template.formulas,
          showHeader: false,
        },
      ],
    })
    sheetInstanceRef.current = sheet

    // 表格对订单信息的联动（动态定位行和列）：
    // 成本价       = 汇总行 × 参考卖价列（以"汇总"文字定位行，以"参考卖价"列标题定位列）
    // 单个卖价(不含税) = 参考卖价行 × 参考卖价列（以"参考卖价"文字定位行）
    // 单个卖价(含税)   = 参考卖价行 × 含税价列
    // 产品规格 = 成品行 宽(CM) "*" 高(CM) "*" 底(CM)
    // 数量     = 成品行 数量(个)
    // 直接通过 formulaManager 读取公式计算结果（构造时已载入引擎，编辑后由 WorkSheet 级联重算）
    const SHEET_KEY = 'sheet1'
    const activeWs = sheet.getActiveSheet()
    const activeTable = activeWs?.tableInstance as any
    const syncFromTable = () => {
      const fm = (sheet as any).formulaManager
      if (!fm) return
      try {
        // 从表格实例构建二维数组（用于动态定位行和列）
        const rowCount = activeTable?.rowCount ?? 0
        const colCount = activeTable?.colCount ?? 16
        const tableData: any[][] = []
        for (let r = 0; r < rowCount; r++) {
          const rowData: any[] = []
          for (let c = 0; c < colCount; c++) {
            rowData.push(activeTable.getCellOriginValue?.(c, r) ?? null)
          }
          tableData.push(rowData)
        }

        // 动态定位：汇总行、参考卖价行、成品行、参考卖价列、含税价列
        const pos = findTablePositions(tableData)

        // 成本价 = 汇总行 × 参考卖价列（公式单元格，读取引擎计算结果）
        const rCost = pos.summaryRow >= 0
          ? fm.getCellValue({ sheet: SHEET_KEY, row: pos.summaryRow, col: pos.refSellCol })
          : null
        const costVal = rCost && typeof rCost.value === 'number' && !isNaN(rCost.value) ? rCost.value : null
        setCostPrice(costVal)
        // 含税价 = 成本价 × 1.1（自动计算）
        setPriceWithTax(costVal !== null ? Number((costVal * 1.1).toFixed(2)) : null)

        // 卖价（公式单元格，读取引擎计算结果）
        const rNoTax = pos.refSellRow >= 0
          ? fm.getCellValue({ sheet: SHEET_KEY, row: pos.refSellRow, col: pos.refSellCol })
          : null
        const rWithTax = pos.refSellRow >= 0
          ? fm.getCellValue({ sheet: SHEET_KEY, row: pos.refSellRow, col: pos.withTaxCol })
          : null
        setSellPrices({
          noTax: rNoTax && typeof rNoTax.value === 'number' && !isNaN(rNoTax.value) ? rNoTax.value : null,
          withTax: rWithTax && typeof rWithTax.value === 'number' && !isNaN(rWithTax.value) ? rWithTax.value : null,
        })

        // 产品规格 / 数量（成品行数据单元格）
        const fmtVal = (v: any): string => (v == null || v === '') ? '' : String(v)
        const width = fm.getCellValue({ sheet: SHEET_KEY, row: pos.finishedRow, col: 2 })
        const height = fm.getCellValue({ sheet: SHEET_KEY, row: pos.finishedRow, col: 3 })
        const base = fm.getCellValue({ sheet: SHEET_KEY, row: pos.finishedRow, col: 4 })
        const qty = fm.getCellValue({ sheet: SHEET_KEY, row: pos.finishedRow, col: 1 })
        const newSpec = [fmtVal(width?.value), fmtVal(height?.value), fmtVal(base?.value)].join('*')
        const newQty = fmtVal(qty?.value)

        // 手提规格联动：找到第一个叫"手提"的行，拼接成品尺寸和切片尺寸
        let handleSpec = ''
        for (let r = 0; r < rowCount; r++) {
          const rowLabel = activeTable.getCellOriginValue?.(0, r) ?? activeTable.getCellValue?.(0, r)
          if (rowLabel === '手提') {
            const hw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 2 })
            const hh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 3 })
            const sw = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 7 })
            const sh = fm.getCellValue({ sheet: SHEET_KEY, row: r, col: 8 })
            const w = fmtVal(hw?.value), h = fmtVal(hh?.value)
            const sW = fmtVal(sw?.value), sH = fmtVal(sh?.value)
            const parts: string[] = []
            if (w && h) parts.push(`成品尺寸：${w}*${h}`)
            if (sW && sH) parts.push(`切片尺寸${sW}*${sH}`)
            handleSpec = parts.join('，')
            break
          }
        }

        setOrderInfo((prev) => {
          if (prev.productSpec === newSpec && prev.quantity === newQty && prev.handleSpec === handleSpec) return prev
          return { ...prev, productSpec: newSpec, quantity: newQty, handleSpec }
        })
      } catch {
        // 公式引擎未就绪时忽略，后续 change_cell_value 事件会重新读取
      }
    }
    // 初始读取（公式在构造时已载入引擎并完成计算）
    syncFromTable()
    // 公式引擎可能在构造后异步完成计算，延迟再次读取以确保成本价/卖价正确初始化
    const initTimer1 = setTimeout(syncFromTable, 100)
    const initTimer2 = setTimeout(syncFromTable, 500)
    // 监听单元格变更：WorkSheet 的 change_cell_value 监听器先于本监听器注册，
    // 会同步完成依赖公式的级联重算，因此此处可直接读取最新结果
    const onCellChange = () => syncFromTable()
    if (activeTable?.on) {
      activeTable.on('change_cell_value', onCellChange)
    }

    // 监听新增列事件，确保新增列也有样式和字段格式化函数
    const onAddColumn = () => {
      try {
        const currentCols = activeTable?.columns || []
        const newCols = currentCols.map((_col: any, index: number) => ({
          field: index,
          key: index,
          width: COL_WIDTHS[index] || 100, // 使用默认宽度
          style: getCellStyle,
          fieldFormat: (record: any, col?: number, row?: number) => {
            const value = record?.[index]
            if (typeof value === 'number' && !isNaN(value)) {
              const fmt = (col != null && row != null) ? cellFormatOverrides.get(`${col},${row}`) : undefined
              if (fmt === -1) return value              // 常规
              if (fmt === 0) return Math.round(value)   // 整数
              if (fmt === 4) return value.toFixed(4)    // 4位小数
              return value.toFixed(2)                    // 默认2位小数
            }
            return value
          },
        }))
        activeTable?.updateColumns(newCols)
      } catch (error) {
        console.error('更新列定义失败:', error)
      }
    }
    if (activeTable?.on) {
      activeTable.on('add_column', onAddColumn)
    }

    // 监听容器尺寸变化（如收缩/展开左侧菜单栏），触发 VTable 重新布局
    const resizeObserver = new ResizeObserver(() => {
      sheet.resize()
    })
    resizeObserver.observe(sheetContainerRef.current)

    // 修复子菜单位置：VTable 子菜单 position 为 absolute，但 left/top 使用视口坐标，
    // 页面滚动时会错位。在子菜单添加到 DOM 后（VTable 已设置好 left/top 像素值），
    // 将 position 改为 fixed，使 left/top 基于视口（MutationObserver 在微任务中执行，无闪烁）
    const menuObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof HTMLElement && node.classList.contains('vtable-context-submenu-container')) {
            node.style.position = 'fixed'
          }
        }
      }
    })
    menuObserver.observe(document.body, { childList: true })

    return () => {
      if (activeTable?.off) {
        activeTable.off('change_cell_value', onCellChange)
        activeTable.off('add_column', onAddColumn)
      }
      clearTimeout(initTimer1)
      clearTimeout(initTimer2)
      resizeObserver.disconnect()
      menuObserver.disconnect()
      sheet.release()
      sheetInstanceRef.current = null
      cellStyleOverrides.clear()
      cellFormatOverrides.clear()
    }
  }, [orderInfo.productStyle])

  const processFiles = (files: File[]) => {
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return
    imageFiles.forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        setProductImages((prev) => [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    })
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return
    processFiles(Array.from(files))
    e.target.value = ''
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = e.dataTransfer.files
    if (!files || files.length === 0) return
    processFiles(Array.from(files))
  }

  const handleImageRemove = (index: number) => {
    setProductImages((prev) => prev.filter((_, i) => i !== index))
  }

  const updateOrderField = (field: keyof OrderInfo, value: string) => {
    setOrderInfo((prev) => ({ ...prev, [field]: value }))
  }

  const handleReset = () => {
    setOrderInfo(DEFAULT_ORDER_INFO)
    setProductImages([])
  }

  const handleNextStatus = async () => {
    if (!isEditMode || status === 6) return
    setLoading(true)
    try {
      const data = await api.quotes.nextStatus(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('状态流转失败:', error)
    }
    setLoading(false)
  }

  const handlePrevStatus = async () => {
    if (!isEditMode || status === 1) return
    setLoading(true)
    try {
      const data = await api.quotes.prevStatus(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('状态退回失败:', error)
    }
    setLoading(false)
  }

  const handleEndQuote = async () => {
    if (!isEditMode || (status !== 1 && status !== 2)) return
    setLoading(true)
    try {
      const data = await api.quotes.endQuote(id!)
      if (data) {
        setStatus(data.status)
        setStatusTimeNodes({
          quoteTime: data.quoteTime || '',
          sampleTime: data.sampleTime || '',
          productionStartTime: data.productionStartTime || '',
          shippingTime: data.shippingTime || '',
          paymentTime: data.paymentTime || '',
          endTime: data.endTime || '',
        })
        setShowSaveSuccess(true)
        setTimeout(() => setShowSaveSuccess(false), 3000)
      }
    } catch (error) {
      console.error('结束报价失败:', error)
    }
    setLoading(false)
  }

  const handleProductionStepChange = (stepId: number, newStatus: 'pending' | 'in_progress' | 'completed') => {
    setProductionStepStatus(prev => ({ ...prev, [stepId]: newStatus }))
  }

  const canGoNext = status >= 1 && status <= 5
  const canGoPrev = status >= 2 && status <= 6
  const canEnd = status >= 1 && status <= 5

  // === 价格联动计算（实时联动：依赖 成本价/含税价/单个卖价/数量） ===
  // 保留2位小数辅助函数：总额计算以保留2位小数的价格为基础
  const round2 = (n: number) => Math.round(n * 100) / 100
  const qty = parseFloat(orderInfo.quantity) || 0
  // 基础价格统一保留2位小数后参与计算
  const costVal = round2(costPrice ?? 0)
  const priceWithTaxVal = round2(priceWithTax ?? 0)
  const sellNoTaxVal = round2(sellPrices.noTax ?? 0)
  const sellWithTaxVal = round2(sellPrices.withTax ?? 0)
  // 单个利润 = 单个卖价 - 成本价（不含税/含税 分别对应），结果保留2位小数
  const profitPerNoTax = round2(sellNoTaxVal - costVal)
  const profitPerWithTax = round2(sellWithTaxVal - priceWithTaxVal)
  // 利润总额 = (单个卖价 - 成本价) × 数量，以保留2位小数的单个利润为计算基础
  const profitTotalNoTax = round2(profitPerNoTax * qty)
  const profitTotalWithTax = round2(profitPerWithTax * qty)
  // 销售总额 = 数量 × 单个卖价，以保留2位小数的单个卖价为计算基础
  const sellTotalNoTax = round2(sellNoTaxVal * qty)
  const sellTotalWithTax = round2(sellWithTaxVal * qty)

  return (
    <div className="min-h-screen flex flex-col">
      {/* 顶部悬浮栏（sticky 使其限定在 main 内容区内，不覆盖左侧菜单栏） */}
      <div className="shrink-0 sticky top-0 z-50 bg-white/95 backdrop-blur-sm shadow-sm border-b border-gray-100">
        <div className="px-4 py-2 max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-blue-100 rounded-lg flex items-center justify-center">
                <ShoppingBag className="text-blue-600" size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-gray-800 leading-tight">订单管理</h1>
                <p className="text-[11px] text-gray-500 leading-tight">订单信息管理</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => navigate('/quotes')} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <ArrowLeft size={16} />
                返回列表
              </button>
              <button onClick={handleSave} disabled={loading} className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors disabled:opacity-50">
                <Save size={16} />
                {showSaveSuccess ? '保存成功' : '保存'}
              </button>
              <button onClick={handleExportWithTable} disabled={exporting || !isEditMode} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-primary-700 border border-primary-200 bg-white rounded-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title={!isEditMode ? '请先保存订单' : '导出订单及在线表格到 Excel（保留公式）'}>
                {exporting ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                {exporting ? '导出中...' : '导出 Excel'}
              </button>
              <button onClick={handleReset} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <RotateCcw size={16} />
                重置
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 主内容区域（shrink-0：订单信息区按内容高度，不压缩） */}
      <div className="shrink-0 px-4 pt-4 pb-0 max-w-7xl mx-auto w-full">
        {/* 状态流转（位于卖价上方） */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-2">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-1.5">
              <Flag className="text-gray-400" size={15} />
              <h3 className="text-xs font-semibold text-gray-700">订单状态流转</h3>
            </div>
            <div className="flex items-center gap-1.5">
              {isEditMode && canGoPrev && (
                <button
                  onClick={handlePrevStatus}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs border border-gray-300 text-gray-600 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <ChevronLeft size={13} />
                  退回
                </button>
              )}
              {isEditMode && canGoNext && (
                <button
                  onClick={handleNextStatus}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors disabled:opacity-50"
                >
                  下一节点
                  <ChevronRight size={13} />
                </button>
              )}
              {isEditMode && canEnd && (
                <button
                  onClick={handleEndQuote}
                  disabled={loading}
                  className="flex items-center gap-0.5 px-2 py-1 text-xs border border-red-300 text-red-600 rounded hover:bg-red-50 transition-colors disabled:opacity-50"
                >
                  <Square size={11} />
                  结束
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center px-1">
            {STATUS_OPTIONS.map((option, index) => {
              const isCurrent = option.value === status
              const isPast = option.value < status
              const nodeTime = statusTimeNodes[
                option.value === 1 ? 'quoteTime' :
                option.value === 2 ? 'sampleTime' :
                option.value === 3 ? 'productionStartTime' :
                option.value === 4 ? 'shippingTime' :
                option.value === 5 ? 'paymentTime' : 'endTime'
              ] as string

              return (
                <div key={option.value} className="flex items-center">
                  <div className="flex flex-col items-center text-center" title={`${option.label}：${nodeTime || '-'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                      isCurrent ? 'bg-primary-500 text-white ring-2 ring-primary-100' :
                      isPast ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'
                    }`}>
                      {isCurrent ? (
                        <CircleDot size={13} />
                      ) : isPast ? (
                        <CheckCircle size={12} />
                      ) : (
                        <Circle size={12} />
                      )}
                    </div>
                    <p className={`text-[10px] font-medium mt-1 ${
                      isCurrent ? 'text-primary-600' : 'text-gray-600'
                    }`}>{option.label}</p>
                  </div>
                  {index < STATUS_OPTIONS.length - 1 && (
                    <div className="flex items-center px-1 flex-1">
                      <div className={`flex-1 h-0.5 ${isPast ? 'bg-primary-500' : 'bg-gray-200'}`}></div>
                      <ChevronRight size={14} className={isPast ? 'text-primary-500' : 'text-gray-300'} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* 做货流程（状态为做货中时显示） */}
        {status === 3 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-3 mb-2">
            <div className="flex items-center gap-1.5 mb-2">
              <Play className="text-gray-400" size={15} />
              <h3 className="text-xs font-semibold text-gray-700">订单做货流程</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {PRODUCTION_STEPS.map((step, index) => {
                const stepStatus = productionStepStatus[step.id] || 'pending'
                return (
                  <div key={step.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                      stepStatus === 'completed' ? 'bg-green-500 text-white' :
                      stepStatus === 'in_progress' ? 'bg-primary-500 text-white' : 'bg-gray-300 text-gray-500'
                    }`}>
                      {stepStatus === 'completed' ? (
                        <CheckCircle size={13} />
                      ) : stepStatus === 'in_progress' ? (
                        <Play size={11} />
                      ) : (
                        <span className="text-[11px] font-medium">{index + 1}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium ${
                        stepStatus === 'completed' ? 'text-green-700' :
                        stepStatus === 'in_progress' ? 'text-primary-700' : 'text-gray-700'
                      }`}>{step.name}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'pending')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'pending' ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-500 hover:bg-gray-100'
                        }`}
                      >
                        待处理
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'in_progress')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'in_progress' ? 'bg-primary-200 text-primary-700' : 'bg-white text-gray-500 hover:bg-primary-50'
                        }`}
                      >
                        进行中
                      </button>
                      <button
                        onClick={() => handleProductionStepChange(step.id, 'completed')}
                        className={`px-1.5 py-0.5 text-[11px] rounded ${
                          stepStatus === 'completed' ? 'bg-green-200 text-green-700' : 'bg-white text-gray-500 hover:bg-green-50'
                        }`}
                      >
                        已完成
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* 主体：订单信息 + 在线表格 （合并标题节省一行空间） */}
        <div className="mb-0">
          <div className="flex items-center gap-1.5 mb-1.5">
            <ClipboardList size={15} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">订单信息</h3>
            <span className="text-gray-300">·</span>
            <Table2 size={14} className="text-gray-400" />
            <h3 className="text-xs font-semibold text-gray-700">在线表格</h3>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-gray-100">
            <div className="p-3 pb-1 space-y-2">
              {/* 成本价行：成本价(不含税) + 含税价 + 单个利润(不含税/含税) + 利润总额(不含税/含税) */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-gray-50 to-transparent rounded-lg flex-wrap">
                {/* 成本价输入组 */}
                <div className="flex items-center gap-1.5">
                  <DollarSign className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">成本价</span>
                  <span className="text-[11px] text-gray-400">不含税</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={costPrice !== null ? costPrice.toFixed(2) : ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? null : Number(e.target.value)
                      setCostPrice(val)
                      setPriceWithTax(val !== null ? Number((val * 1.1).toFixed(2)) : null)
                    }}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-0.5 text-sm font-bold text-gray-600 bg-gray-50/40 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">含税</span>
                  <span className="text-[11px] text-gray-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={priceWithTax !== null ? priceWithTax.toFixed(2) : ''}
                    onChange={(e) => setPriceWithTax(e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-0.5 text-sm font-bold text-gray-600 bg-gray-50/40 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400"
                  />
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 单个利润组 = 单个卖价 - 成本价 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-400">单个利润</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-24 px-1.5 py-0.5 text-sm font-bold text-red-600 bg-red-50/40 border border-red-200 rounded text-right">
                    {profitPerNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-green-500">含税</span>
                  <span className="text-[11px] text-green-500">¥</span>
                  <div className="w-24 px-1.5 py-0.5 text-sm font-bold text-green-700 bg-green-50/40 border border-green-200 rounded text-right">
                    {profitPerWithTax.toFixed(2)}
                  </div>
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 利润总额组 = (单个卖价 - 成本价) × 数量 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-500">利润总额</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-28 px-1.5 py-0.5 text-sm font-bold text-red-700 bg-red-100/50 border border-red-300 rounded text-right">
                    {profitTotalNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-green-600">含税</span>
                  <span className="text-[11px] text-green-600">¥</span>
                  <div className="w-28 px-1.5 py-0.5 text-sm font-bold text-green-800 bg-green-100/50 border border-green-300 rounded text-right">
                    {profitTotalWithTax.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 单个卖价行：单个卖价(不含税) + 单个卖价(含税) + 销售总额(不含税/含税) */}
              <div className="flex items-center gap-4 px-3 py-1.5 bg-gradient-to-r from-blue-50 to-transparent rounded-lg flex-wrap">
                <div className="flex items-center gap-1.5">
                  <TrendingUp className="text-gray-400" size={15} />
                  <span className="text-xs text-gray-500">单个卖价</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-red-400">不含税</span>
                  <span className="text-xs text-red-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellPrices.noTax !== null ? sellPrices.noTax.toFixed(2) : ''}
                    onChange={(e) => setSellPrices(prev => ({ ...prev, noTax: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-0.5 text-sm font-bold text-red-600 bg-red-50/40 border border-red-200 rounded focus:outline-none focus:ring-1 focus:ring-red-400 focus:border-red-400"
                  />
                </div>
                <div className="flex items-center gap-1">
                  <TrendingUp className="text-blue-400" size={14} />
                  <span className="text-[11px] text-blue-400">含税</span>
                  <span className="text-xs text-blue-400">¥</span>
                  <input
                    type="number"
                    step="0.01"
                    value={sellPrices.withTax !== null ? sellPrices.withTax.toFixed(2) : ''}
                    onChange={(e) => setSellPrices(prev => ({ ...prev, withTax: e.target.value === '' ? null : Number(e.target.value) }))}
                    placeholder="0.00"
                    className="w-24 px-1.5 py-0.5 text-sm font-bold text-blue-600 bg-blue-50/40 border border-blue-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
                  />
                </div>
                <div className="w-px h-5 bg-gray-200" />
                {/* 销售总额组 = 数量 × 单个卖价 */}
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-gray-500">销售总额</span>
                  <span className="text-[10px] text-red-400">不含税</span>
                  <span className="text-[11px] text-red-400">¥</span>
                  <div className="w-28 px-1.5 py-0.5 text-sm font-bold text-red-700 bg-red-100/50 border border-red-300 rounded text-right">
                    {sellTotalNoTax.toFixed(2)}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-blue-500">含税</span>
                  <span className="text-[11px] text-blue-500">¥</span>
                  <div className="w-28 px-1.5 py-0.5 text-sm font-bold text-blue-700 bg-blue-100/50 border border-blue-300 rounded text-right">
                    {sellTotalWithTax.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* 表单字段 - 密集网格。LG:6列 MD:4列 SM:2列
              同行规则：客户+地址 / 大货日期+天数 / 手提材质+规格 / 打样费+箱规+备注 */}
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-3 gap-y-1.5">
                {/* 行1：客户名称 + 收货地址 同行 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">客户名称</label>
                  <CustomerSelect
                    value={orderInfo.customerName}
                    onChange={(v) => updateOrderField('customerName', v)}
                    address={orderInfo.shippingAddress}
                    onAddressChange={(v) => updateOrderField('shippingAddress', v)}
                    placeholder="请选择或输入客户名称"
                  />
                </div>
                <div className="col-span-2 md:col-span-2 lg:col-span-4">
                  <label className="block text-xs text-gray-400 mb-0.5">收货地址</label>
                  <textarea
                    value={orderInfo.shippingAddress}
                    onChange={(e) => updateOrderField('shippingAddress', e.target.value)}
                    placeholder="请输入收货地址"
                    rows={1}
                    className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                {/* 行2：大货日期/天数 + 款式 + 数量 + 产品规格 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-400 mb-0.5">大货日期/天数</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="date"
                      value={orderInfo.productionTimeStart}
                      onChange={(e) => {
                        const newStart = e.target.value
                        updateOrderField('productionTimeStart', newStart)
                        // 联动：大货天数有值时，自动计算结束日期 = 开始日期 + 大货天数
                        const days = Number(orderInfo.massDays)
                        if (newStart && days) {
                          updateOrderField('productionTimeEnd', addDaysToDate(newStart, days))
                        }
                      }}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                    />
                    <span className="text-xs text-gray-500 shrink-0">到</span>
                    <input
                      type="date"
                      value={orderInfo.productionTimeEnd}
                      onChange={(e) => updateOrderField('productionTimeEnd', e.target.value)}
                      className="w-full px-2 py-1 text-sm border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent cursor-pointer"
                    />
                    <input type="text" value={orderInfo.massDays} onChange={(e) => {
                        const newDays = e.target.value
                        updateOrderField('massDays', newDays)
                        // 联动：开始日期有值时，自动计算结束日期 = 开始日期 + 大货天数
                        const days = Number(newDays)
                        if (orderInfo.productionTimeStart && days) {
                          updateOrderField('productionTimeEnd', addDaysToDate(orderInfo.productionTimeStart, days))
                        }
                      }}
                      placeholder="天数"
                      className="w-16 px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors shrink-0" />
                  </div>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">款式</label>
                  <select
                    value={orderInfo.productStyle}
                    onChange={(e) => updateOrderField('productStyle', e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors"
                  >
                    {PRODUCT_STYLE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">数量(个)</label>
                  <input type="text" value={orderInfo.quantity} onChange={(e) => updateOrderField('quantity', e.target.value)}
                    placeholder="0"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">产品规格(CM)</label>
                  <input type="text" value={orderInfo.productSpec} onChange={(e) => updateOrderField('productSpec', e.target.value)}
                    placeholder="产品规格"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>

                {/* 行3：面料材质 + 工艺 + 手提 + 打样费/天（合并文本框） */}
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">面料材质</label>
                  <input type="text" value={orderInfo.fabricMaterial} onChange={(e) => updateOrderField('fabricMaterial', e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">工艺</label>
                  <input type="text" value={orderInfo.process} onChange={(e) => updateOrderField('process', e.target.value)}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                {/* 手提材质与手提规格合并为单字段，格式：手提材质：手提规格 */}
                <div className="col-span-2 md:col-span-2 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">手提</label>
                  <input
                    type="text"
                    value={[orderInfo.handleMaterial, orderInfo.handleSpec].filter(Boolean).join('：')}
                    onChange={(e) => {
                      const v = e.target.value
                      const idx = v.indexOf('：')
                      if (idx >= 0) {
                        updateOrderField('handleMaterial', v.slice(0, idx))
                        updateOrderField('handleSpec', v.slice(idx + 1))
                      } else {
                        updateOrderField('handleMaterial', v)
                        updateOrderField('handleSpec', '')
                      }
                    }}
                    placeholder="材质：规格"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                {/* 打样费与打样天数合并为文本输入框，格式：费用/天数 */}
                <div className="col-span-1 md:col-span-1 lg:col-span-1">
                  <label className="block text-xs text-gray-400 mb-0.5">打样费/天</label>
                  <input
                    type="text"
                    value={[orderInfo.sampleFee, orderInfo.sampleDays].filter(Boolean).join('/')}
                    onChange={(e) => {
                      const v = e.target.value
                      const idx = v.indexOf('/')
                      if (idx >= 0) {
                        updateOrderField('sampleFee', v.slice(0, idx))
                        updateOrderField('sampleDays', v.slice(idx + 1))
                      } else {
                        updateOrderField('sampleFee', v)
                        updateOrderField('sampleDays', '')
                      }
                    }}
                    placeholder="费用/天数"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>

                {/* 行4：箱规 + 备注 */}
                <div className="col-span-2 md:col-span-1 lg:col-span-2">
                  <label className="block text-xs text-gray-400 mb-0.5">箱规</label>
                  <input type="text" value={orderInfo.boxSpec} onChange={(e) => updateOrderField('boxSpec', e.target.value)}
                    placeholder="箱规"
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors" />
                </div>
                <div className="col-span-2 md:col-span-2 lg:col-span-3">
                  <label className="block text-xs text-gray-400 mb-0.5">备注</label>
                  <textarea
                    value={orderInfo.remark}
                    onChange={(e) => updateOrderField('remark', e.target.value)}
                    placeholder="请输入备注信息"
                    rows={1}
                    className="w-full px-2 py-1 text-sm font-medium text-blue-600 bg-blue-50/40 border border-blue-200 rounded hover:border-blue-400 focus:border-blue-500 focus:bg-blue-100/60 focus:outline-none transition-colors resize-none"
                  />
                </div>
              </div>

                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1.5">
                    <ImageIcon size={14} className="text-gray-400" />
                    <span className="text-xs font-medium text-gray-700">产品图片</span>
                  </div>
                  <label className="cursor-pointer flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-600 bg-blue-50 rounded hover:bg-blue-100 transition-colors">
                    <Upload size={12} />
                    上传图片
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                </div>
                {productImages.length === 0 ? (
                  <label
                    className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg py-3 transition-colors cursor-pointer ${
                      isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center mb-1 ${isDragging ? 'bg-blue-200' : 'bg-gray-100'}`}>
                      <Upload size={15} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                    </div>
                    <p className={`text-[11px] mb-0.5 ${isDragging ? 'text-blue-600' : 'text-gray-600'}`}>
                      {isDragging ? '释放鼠标上传图片' : '点击或拖拽上传产品图片'}
                    </p>
                    <p className="text-[11px] text-gray-400">支持多选 · JPG / PNG / GIF / WebP</p>
                    <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                  </label>
                ) : (
                  <div 
                    className="w-full px-2"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <div className={`grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2 rounded-lg transition-colors ${
                      isDragging ? 'bg-blue-100/30 p-1' : ''
                    }`}>
                      {productImages.map((img, index) => (
                        <div key={index} className="relative aspect-square">
                          <div 
                            className="w-full h-full cursor-zoom-in"
                            onClick={() => { setPreviewImageSrc(img); setIsPreviewOpen(true); }}
                          >
                            <img 
                              src={img} 
                              alt={`产品图片 ${index + 1}`} 
                              className="w-full h-full object-cover rounded-lg border border-gray-200" 
                            />
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleImageRemove(index); }}
                            className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm z-10"
                          >
                            <X size={12} />
                          </button>
                          <span className="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1 py-0.5 rounded">
                            {index + 1}
                          </span>
                        </div>
                      ))}
                      <label className={`aspect-square flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer ${
                        isDragging ? 'border-blue-500 bg-blue-100/50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50/50'
                      }`}>
                        <Upload size={16} className={isDragging ? 'text-blue-600' : 'text-gray-400'} />
                        <span className={`text-xs ${isDragging ? 'text-blue-600' : 'text-gray-500'}`}>添加</span>
                        <input type="file" accept="image/*" multiple onChange={handleImageUpload} className="hidden" />
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>
        </div>

        {/* 在线表格 — 全宽，不受订单信息的 max-w-7xl 限制 */}
      </div>
      <div className="flex-1 min-h-0 px-4 pt-1 pb-4 max-w-7xl mx-auto w-full flex flex-col">
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex-1 min-h-0">
          <div ref={sheetContainerRef} className="h-full w-full" style={{ minHeight: 400 }} />
        </div>
      </div>

      {isPreviewOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">
          <button
            onClick={() => setIsPreviewOpen(false)}
            className="absolute top-4 right-4 w-8 h-8 bg-white/20 text-white rounded-full flex items-center justify-center hover:bg-white/30 transition-colors"
          >
            <X size={20} />
          </button>
          <div 
            className="max-w-full max-h-[90vh] cursor-zoom-out"
            onClick={() => setIsPreviewOpen(false)}
          >
            <img 
              src={previewImageSrc} 
              alt="预览" 
              className="max-w-full max-h-[90vh] object-contain" 
            />
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-6 flex flex-col items-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mb-3"></div>
            <p className="text-gray-600">保存中...</p>
          </div>
        </div>
      )}

      {showSaveSuccess && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-green-500 text-white rounded-lg shadow-lg">
          <CheckCircle size={20} />
          <span className="font-medium">保存成功</span>
        </div>
      )}

      {saveError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg shadow-lg">
          <X size={20} />
          <span className="font-medium">{saveError}</span>
        </div>
      )}

      {exportError && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-red-500 text-white rounded-lg shadow-lg">
          <X size={20} />
          <span className="font-medium">{exportError}</span>
        </div>
      )}
    </div>
  )
}
