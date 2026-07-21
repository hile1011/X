// 帆布袋报价计算引擎
// 基于「帆布袋价格试算表」的公式规则实现

export interface FrontBackRowInput {
  label: string
  widthBleed: number
  heightBleed: number
  width: number
  height: number
  bottom: number
  fabricWidth: number
  gramWeight: number
  processingFee: number
  frontBackPrintCost: number
  fabricPrice: number
  extraCraftCost: number
  packagingFee: number
  lossRate: number
}

export interface BagQuoteInput {
  quantity: number        // 数量(个)
  width: number           // 宽(CM)
  height: number          // 高(CM)
  bottom: number          // 底(CM)

  frontBackRows: FrontBackRowInput[]

  // 印刷手提参数
  handleWidth: number     // 手提成品宽(CM)
  handleHeight: number    // 手提高(CM)
  handleCutWidth: number  // 手提切片宽
  handleWidthBleed: number // 手提宽出血
  handleHeightBleed: number // 手提高出血

  // 印刷手提成本参数
  handleProcessingFee: number   // 手提加工费(元/个)
  handlePrintCost: number       // 手提印刷双面(元/个)
  handleFabricPrice: number     // 手提布料价格(元/米)
  handleFabricCost: number      // 手提布料成本(元)
  handleExtraCraftCost: number  // 手提额外工艺成本
  handlePackagingFee: number    // 手提包装费

  profitRate: number          // 利润率
  taxRate: number             // 含税系数(1.1=10%税)
}

export interface SpecCalcRow {
  label: string
  quantity: number | null
  width: number | null
  height: number | null
  bottom: number | null
  widthBleed: number | null
  heightBleed: number | null
  cutWidth: number | null       // 切片宽
  cutHeight: number | null      // 切片高
  fabricWidth: number | null    // 布料门幅
  gramWeight: number | null     // 克重
  fabricWaste: number | null    // 门幅剩余废料
  fabricMeters: number | null   // 布料米数(M)
  maxPanels: number | null      // 门幅最大面数(个)
  totalWeight: number | null    // 总重量
  unitGramWeight: number | null   // 单个克重
}

export interface CostCalcRow {
  label: string
  processingFee: number | null       // 加工费(元/个)
  printDoubleSide: number | null     // 印刷双面(元/个)
  fabricPrice: number | null         // 布料价格
  fabricCost: number | null          // 布料成本(元)
  extraCraftCost: number | null      // 额外工艺成本
  packagingFee: number | null        // 包装费
  freightUnit: number | null         // 运费单价(元)
  lossRate: number | null            // 损耗系数
  unitTotalPrice: number | null      // 单个布袋总价(元)
}

export interface BagQuoteResult {
  input: BagQuoteInput
  specTable: SpecCalcRow[]
  costTable: CostCalcRow[]
  summary: {
    unitCost: number           // 单个总成本
    refPriceNoTax: number      // 参考卖价(不含税)
    refPriceWithTax: number    // 参考卖价(含税)
    totalProfit: number        // 利润
    unitProfit: number         // 单个利润
    totalUnitGramWeight: number //总单个克重
  
  }
}

function ceiling(n: number, significance: number = 1): number {
  return Math.ceil(n / significance) * significance
}

function mod(a: number, b: number): number {
  return a - Math.floor(a / b) * b
}

export function calculateBagQuote(input: BagQuoteInput): BagQuoteResult {
  const {
    quantity, width, height, bottom,
    frontBackRows,
    handleWidth, handleHeight, handleCutWidth, handleWidthBleed, handleHeightBleed,
    handleProcessingFee, handlePrintCost, handleFabricPrice, handleFabricCost, handleExtraCraftCost, handlePackagingFee,
    profitRate, taxRate,
  } = input

  // === 规格计算 - 成品行 ===
  const productRow: SpecCalcRow = {
    label: '成品',
    quantity, width, height, bottom,
    widthBleed: null, heightBleed: null,
    cutWidth: null, cutHeight: null,
    fabricWidth: null, gramWeight: null,
    fabricWaste: null, fabricMeters: null,
    maxPanels: null, totalWeight: null,
    unitGramWeight: null,
  }

  // === 规格计算 - 正反面行（支持多行）===
  const frontBackSpecRows: SpecCalcRow[] = []
  const frontBackCostRows: CostCalcRow[] = []
  let totalFrontBackUnitTotal = 0
  let totalFrontBackUnitGramWeight = 0

  for (const rowInput of frontBackRows) {
    const {
      label, widthBleed, heightBleed,
      width: rowWidth, height: rowHeight, bottom: rowBottom,
      fabricWidth, gramWeight,
      processingFee, frontBackPrintCost, fabricPrice, extraCraftCost, packagingFee, lossRate,
    } = rowInput

    const cutWidth = widthBleed + rowWidth
    const cutHeight = rowHeight * 2 + heightBleed + rowBottom
    const maxPanels = fabricWidth / Math.min(cutWidth, cutHeight)
    const fabricWaste = mod(fabricWidth, Math.min(cutWidth, cutHeight))
    const fabricMeters = ceiling(quantity / Math.floor(maxPanels), 1) * Math.max(cutWidth, cutHeight) / 100
    const totalWeight = fabricMeters * gramWeight * 1.5 / 1000
    const unitGramWeight = quantity > 0 ? totalWeight / quantity * 1000 : 0

    frontBackSpecRows.push({
      label,
      quantity, width: rowWidth, height: rowHeight, bottom: rowBottom,
      widthBleed, heightBleed,
      cutWidth,
      cutHeight,
      fabricWidth, gramWeight,
      fabricWaste,
      fabricMeters,
      maxPanels,
      totalWeight,
      unitGramWeight,
    })

    // === 成本计算 ===
    const effectivePrintCost = frontBackPrintCost || cutWidth * cutHeight * 1.1 / 10000
    const fabricCost = fabricPrice * fabricMeters / quantity + ceiling(fabricMeters / 100, 1) * 15 / quantity + 0.04
    const freight = totalWeight * 0.8
    const unitTotal = (processingFee + effectivePrintCost + extraCraftCost + fabricCost + freight / quantity) * lossRate + packagingFee

    frontBackCostRows.push({
      label,
      processingFee,
      printDoubleSide: frontBackPrintCost,
      fabricPrice,
      fabricCost,
      extraCraftCost,
      packagingFee,
      freightUnit: freight,
      lossRate,
      unitTotalPrice: unitTotal,
    })

    totalFrontBackUnitTotal += unitTotal
    totalFrontBackUnitGramWeight += unitGramWeight
  }

  // === 规格计算 - 印刷手提行 ===
  const firstRow = frontBackRows[0] ?? { fabricWidth: 154, gramWeight: 280, lossRate: 1.03 }
  const handleCutHeight = handleHeight
  const handleMaxPanels = firstRow.fabricWidth / Math.min(handleCutWidth, handleCutHeight)
  const handleFabricWaste = mod(firstRow.fabricWidth, Math.min(handleCutWidth, handleCutHeight))
  const handleFabricMeters = handleCutHeight / 100 * 2 * quantity / Math.floor(firstRow.fabricWidth / handleCutWidth)
  const handleTotalWeight = handleFabricMeters * firstRow.gramWeight * 1.5 / 1000
  const handleUnitGramWeight = quantity > 0 ? handleTotalWeight / quantity * 1000 : 0

  const handleSpecRow: SpecCalcRow = {
    label: '印刷手提',
    quantity, width: handleWidth, height: handleHeight, bottom: 0,
    widthBleed: handleWidthBleed, heightBleed: handleHeightBleed,
    cutWidth: handleCutWidth,
    cutHeight: handleCutHeight,
    fabricWidth: firstRow.fabricWidth, gramWeight: firstRow.gramWeight,
    fabricWaste: handleFabricWaste,
    fabricMeters: handleFabricMeters,
    maxPanels: handleMaxPanels,
    totalWeight: handleTotalWeight,
    unitGramWeight: handleUnitGramWeight,
  }

  // === 成本计算 - 印刷手提行 ===
  const handleFreight = handleTotalWeight * 0.8
  const handleUnitTotal = (handleProcessingFee + handlePrintCost + handleFabricCost + handleExtraCraftCost + handleFreight / quantity) * (firstRow.lossRate || 1.03) + handlePackagingFee

  const handleCostRow: CostCalcRow = {
    label: '印刷手提',
    processingFee: handleProcessingFee || null,
    printDoubleSide: handlePrintCost,
    fabricPrice: handleFabricPrice,
    fabricCost: handleFabricCost,
    extraCraftCost: handleExtraCraftCost || null,
    packagingFee: handlePackagingFee || null,
    freightUnit: handleFreight,
    lossRate: firstRow.lossRate || 1.03,
    unitTotalPrice: handleUnitTotal,
  }

  // === 汇总 ===
  const unitCost = totalFrontBackUnitTotal + handleUnitTotal
  const refPriceNoTax = unitCost * (1 + profitRate)
  const refPriceWithTax = refPriceNoTax * taxRate
  const unitProfit = refPriceNoTax - unitCost
  const totalProfit = unitProfit * quantity
  const totalUnitGramWeight = totalFrontBackUnitGramWeight + handleUnitGramWeight

  // === 汇总行 ===
  const totalQuantity = quantity
  const totalUnitGramWeightValue = totalFrontBackUnitGramWeight + handleUnitGramWeight
  const totalUnitTotalPrice = unitCost

  const summarySpecRow: SpecCalcRow = {
    label: '汇总',
    quantity: totalQuantity,
    width: null, height: null, bottom: null,
    widthBleed: null, heightBleed: null,
    cutWidth: null, cutHeight: null,
    fabricWidth: null, gramWeight: null,
    fabricWaste: null, fabricMeters: null,
    maxPanels: null, totalWeight: null,
    unitGramWeight: totalUnitGramWeightValue,
  }

  const summaryCostRow: CostCalcRow = {
    label: '汇总',
    processingFee: null,
    printDoubleSide: null,
    fabricPrice: null,
    fabricCost: null,
    extraCraftCost: null,
    packagingFee: null,
    freightUnit: null,
    lossRate: null,
    unitTotalPrice: totalUnitTotalPrice,
  }

  return {
    input,
    specTable: [productRow, ...frontBackSpecRows, handleSpecRow, summarySpecRow],
    costTable: [...frontBackCostRows, handleCostRow, summaryCostRow],
    summary: {
      unitCost,
      refPriceNoTax,
      refPriceWithTax,
      totalProfit,
      unitProfit,
      totalUnitGramWeight,
    },
  }
}

// 默认参数（来自示例 Excel）
export const defaultBagQuoteInput: BagQuoteInput = {
  quantity: 7200,
  width: 38,
  height: 40,
  bottom: 0,
  frontBackRows: [{
    label: '正反面',
    widthBleed: 3,
    heightBleed: 10,
    width: 38,
    height: 40,
    bottom: 0,
    fabricWidth: 154,
    gramWeight: 280,
    processingFee: 0.51,
    frontBackPrintCost: 0,
    fabricPrice: 4.4,
    extraCraftCost: 0.05,
    packagingFee: 0.1,
    lossRate: 1.03,
  }],
  handleWidth: 2.5,
  handleHeight: 70,
  handleCutWidth: 6,
  handleWidthBleed: 3,
  handleHeightBleed: 10,
  handleProcessingFee: 0,
  handlePrintCost: 0,
  handleFabricPrice: 4.4,
  handleFabricCost: 0.05,
  handleExtraCraftCost: 0,
  handlePackagingFee: 0,
  profitRate: 0.45,
  taxRate: 1.1,
}
