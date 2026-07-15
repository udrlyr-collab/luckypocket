export const MARKET_DOMINION = "MARKET DOMINION" as const;
export * from "./strategy.js";
export * from "./etf.js";
export * from "./market-stability.js";

export type Money = bigint;
export type Quantity = bigint;

export type OrderSide = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop";
export type OrderStatus = "pending" | "open" | "partially_filled" | "filled" | "cancelled" | "rejected";

export interface LimitOrder {
  id: string;
  symbol: string;
  userId: string;
  side: OrderSide;
  type: "limit";
  price: Money;
  quantity: Quantity;
  filledQuantity: Quantity;
  status: OrderStatus;
  sequence: bigint;
  createdAt: Date;
}

export interface Match {
  makerOrderId: string;
  takerOrderId: string;
  buyOrderId: string;
  sellOrderId: string;
  price: Money;
  quantity: Quantity;
}

export interface SpotSettlement {
  tradeValue: bigint;
  buyerFee: bigint;
  sellerFee: bigint;
  sellerTax: bigint;
  buyerDebit: bigint;
  sellerCredit: bigint;
  buyerReserveRelease: bigint;
  sellerAllocatedCost: bigint;
  sellerRealizedPnl: bigint;
}

export function calculateSpotSettlement(input: {
  executionPrice: bigint;
  buyLimitPrice: bigint;
  fillQuantity: bigint;
  sellerQuantityBefore: bigint;
  sellerCostBasisBefore: bigint;
  buyerFeeBps?: bigint;
  sellerFeeBps?: bigint;
  positivePnlTaxBps?: bigint;
}): SpotSettlement {
  const { executionPrice, buyLimitPrice, fillQuantity, sellerQuantityBefore, sellerCostBasisBefore } = input;
  const buyerFeeBps = input.buyerFeeBps ?? 0n, sellerFeeBps = input.sellerFeeBps ?? 0n, positivePnlTaxBps = input.positivePnlTaxBps ?? 0n;
  if (executionPrice <= 0n || buyLimitPrice <= 0n || fillQuantity <= 0n) throw new Error("SETTLEMENT_PRICE_OR_QUANTITY_INVALID");
  if (executionPrice > buyLimitPrice) throw new Error("EXECUTION_EXCEEDS_BUY_LIMIT");
  if (sellerQuantityBefore < fillQuantity || sellerCostBasisBefore < 0n) throw new Error("SELLER_POSITION_INVALID");
  if ([buyerFeeBps, sellerFeeBps, positivePnlTaxBps].some((rate) => rate < 0n || rate > 10_000n)) throw new Error("SETTLEMENT_RATE_INVALID");
  const tradeValue = executionPrice * fillQuantity;
  const sellerAllocatedCost = sellerCostBasisBefore * fillQuantity / sellerQuantityBefore;
  const buyerFee = tradeValue * buyerFeeBps / 10_000n;
  const sellerFee = tradeValue * sellerFeeBps / 10_000n;
  const sellerProfitBeforeTax = tradeValue - sellerFee - sellerAllocatedCost;
  const sellerTax = sellerProfitBeforeTax > 0n ? sellerProfitBeforeTax * positivePnlTaxBps / 10_000n : 0n;
  const sellerCredit = tradeValue - sellerFee - sellerTax;
  return {
    tradeValue,
    buyerFee,
    sellerFee,
    sellerTax,
    buyerDebit: tradeValue + buyerFee,
    sellerCredit,
    buyerReserveRelease: buyLimitPrice * fillQuantity * (10_000n + buyerFeeBps) / 10_000n,
    sellerAllocatedCost,
    sellerRealizedPnl: sellerCredit - sellerAllocatedCost,
  };
}

export interface BidLevel {
  price: bigint;
  quantity: bigint;
}

export interface LiquidationEstimate {
  requestedQuantity: bigint;
  filledQuantity: bigint;
  unfilledQuantity: bigint;
  grossProceeds: bigint;
  estimatedFee: bigint;
  estimatedTax: bigint;
  netProceeds: bigint;
  estimatedRealizedPnl: bigint;
  averagePrice: bigint | null;
  lastPrice: bigint | null;
  slippageBps: bigint | null;
}

export function estimateSpotLiquidation(input: {
  quantity: bigint;
  costBasis: bigint;
  currentPrice: bigint;
  bids: readonly BidLevel[];
  sellFeeBps: bigint;
  positivePnlTaxBps: bigint;
}): LiquidationEstimate {
  const { quantity, costBasis, currentPrice, sellFeeBps, positivePnlTaxBps } = input;
  if (quantity < 0n || costBasis < 0n || currentPrice <= 0n) throw new Error("LIQUIDATION_POSITION_INVALID");
  if (sellFeeBps < 0n || sellFeeBps > 10_000n || positivePnlTaxBps < 0n || positivePnlTaxBps > 10_000n) throw new Error("LIQUIDATION_RATE_INVALID");
  let remaining = quantity;
  let grossProceeds = 0n;
  let lastPrice: bigint | null = null;
  for (const bid of input.bids) {
    if (remaining === 0n) break;
    if (bid.price <= 0n || bid.quantity <= 0n) continue;
    const fill = bid.quantity < remaining ? bid.quantity : remaining;
    grossProceeds += bid.price * fill;
    remaining -= fill;
    lastPrice = bid.price;
  }
  const filledQuantity = quantity - remaining;
  const allocatedCost = quantity === 0n ? 0n : costBasis * filledQuantity / quantity;
  const estimatedFee = grossProceeds * sellFeeBps / 10_000n;
  const pnlBeforeTax = grossProceeds - estimatedFee - allocatedCost;
  const estimatedTax = pnlBeforeTax > 0n ? pnlBeforeTax * positivePnlTaxBps / 10_000n : 0n;
  const averagePrice = filledQuantity > 0n ? grossProceeds / filledQuantity : null;
  return {
    requestedQuantity: quantity,
    filledQuantity,
    unfilledQuantity: remaining,
    grossProceeds,
    estimatedFee,
    estimatedTax,
    netProceeds: grossProceeds - estimatedFee - estimatedTax,
    estimatedRealizedPnl: pnlBeforeTax - estimatedTax,
    averagePrice,
    lastPrice,
    slippageBps: averagePrice === null ? null : (averagePrice - currentPrice) * 10_000n / currentPrice,
  };
}

export type PositionSide = "long" | "short";

export const DEFAULT_LEVERAGE_LEVELS = [1, 2, 3, 5, 10, 20] as const;

export interface LeveragedPositionEstimate {
  pnl: bigint;
  positionValue: bigint;
  maintenanceRequirement: bigint;
  estimatedCloseFee: bigint;
  accruedBorrowFee: bigint;
  netSettlementValue: bigint;
  shouldLiquidate: boolean;
}

export function calculateLiquidationPrice(input: {
  side: PositionSide;
  entryPrice: bigint;
  leverage: number;
  maintenanceMarginBps: bigint;
}): bigint {
  if (input.entryPrice <= 0n || !Number.isInteger(input.leverage) || input.leverage < 1) throw new Error("LEVERAGE_INPUT_INVALID");
  if (input.maintenanceMarginBps < 0n || input.maintenanceMarginBps >= 10_000n) throw new Error("MAINTENANCE_MARGIN_INVALID");
  const leverage = BigInt(input.leverage);
  const adverseMoveBps = (10_000n - input.maintenanceMarginBps) / leverage;
  return input.side === "long"
    ? maxBigInt(1n, input.entryPrice * (10_000n - adverseMoveBps) / 10_000n)
    : input.entryPrice * (10_000n + adverseMoveBps) / 10_000n;
}

export function estimateLeveragedPosition(input: {
  side: PositionSide;
  quantity: bigint;
  margin: bigint;
  entryPrice: bigint;
  currentPrice: bigint;
  maintenanceMarginBps: bigint;
  closeFeeBps: bigint;
  accruedBorrowFee?: bigint;
}): LeveragedPositionEstimate {
  if (input.quantity <= 0n || input.margin <= 0n || input.entryPrice <= 0n || input.currentPrice <= 0n) throw new Error("POSITION_INPUT_INVALID");
  const pnl = input.side === "long"
    ? input.quantity * (input.currentPrice - input.entryPrice)
    : input.quantity * (input.entryPrice - input.currentPrice);
  const positionValue = input.quantity * input.currentPrice;
  const maintenanceRequirement = positionValue * input.maintenanceMarginBps / 10_000n;
  const estimatedCloseFee = positionValue * input.closeFeeBps / 10_000n;
  const accruedBorrowFee = input.side === "short" ? input.accruedBorrowFee ?? 0n : 0n;
  const netSettlementValue = maxBigInt(0n, input.margin + pnl - estimatedCloseFee - accruedBorrowFee);
  return {
    pnl,
    positionValue,
    maintenanceRequirement,
    estimatedCloseFee,
    accruedBorrowFee,
    netSettlementValue,
    shouldLiquidate: input.margin + pnl <= maintenanceRequirement + estimatedCloseFee + accruedBorrowFee,
  };
}

export function dynamicBorrowFeeBps(input: {
  borrowableQuantity: bigint;
  borrowedQuantity: bigint;
  baseFeeBps: bigint;
  maxFeeBps: bigint;
}): bigint {
  if (input.borrowableQuantity <= 0n || input.borrowedQuantity < 0n || input.borrowedQuantity > input.borrowableQuantity) throw new Error("BORROW_POOL_INVALID");
  if (input.baseFeeBps < 0n || input.maxFeeBps < input.baseFeeBps || input.maxFeeBps > 10_000n) throw new Error("BORROW_FEE_RANGE_INVALID");
  const utilizationBps = input.borrowedQuantity * 10_000n / input.borrowableQuantity;
  return input.baseFeeBps + (input.maxFeeBps - input.baseFeeBps) * utilizationBps * utilizationBps / 100_000_000n;
}

export function accruedBorrowFee(input: {
  positionSize: bigint;
  annualFeeBps: bigint;
  elapsedMilliseconds: bigint;
}): bigint {
  if (input.positionSize < 0n || input.annualFeeBps < 0n || input.elapsedMilliseconds < 0n) throw new Error("BORROW_ACCRUAL_INVALID");
  const millisecondsPerYear = 365n * 24n * 60n * 60n * 1_000n;
  return input.positionSize * input.annualFeeBps * input.elapsedMilliseconds / (10_000n * millisecondsPerYear);
}

function maxBigInt(left: bigint, right: bigint): bigint {
  return left > right ? left : right;
}

function remaining(order: LimitOrder): bigint {
  return order.quantity - order.filledQuantity;
}

function updateStatus(order: LimitOrder): void {
  if (order.filledQuantity === 0n) order.status = "open";
  else if (order.filledQuantity < order.quantity) order.status = "partially_filled";
  else order.status = "filled";
}

export class LimitOrderBook {
  readonly symbol: string;
  #bids: LimitOrder[] = [];
  #asks: LimitOrder[] = [];

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  get bids(): readonly LimitOrder[] {
    return this.#bids;
  }

  get asks(): readonly LimitOrder[] {
    return this.#asks;
  }

  submit(input: LimitOrder): { order: LimitOrder; matches: Match[] } {
    if (input.symbol !== this.symbol) throw new Error("ORDER_SYMBOL_MISMATCH");
    if (input.price <= 0n) throw new Error("ORDER_PRICE_INVALID");
    if (input.quantity <= 0n || input.filledQuantity !== 0n) throw new Error("ORDER_QUANTITY_INVALID");
    if (this.#bids.some((order) => order.id === input.id) || this.#asks.some((order) => order.id === input.id)) {
      throw new Error("ORDER_ID_DUPLICATE");
    }

    const incoming: LimitOrder = { ...input, status: "open" };
    const opposite = incoming.side === "buy" ? this.#asks : this.#bids;
    const matches: Match[] = [];

    while (remaining(incoming) > 0n && opposite.length > 0) {
      const maker = opposite[0];
      if (!maker) break;
      const crosses = incoming.side === "buy"
        ? incoming.price >= maker.price
        : incoming.price <= maker.price;
      if (!crosses) break;

      if (maker.userId === incoming.userId) {
        incoming.status = "rejected";
        return { order: incoming, matches };
      }

      const quantity = remaining(incoming) < remaining(maker) ? remaining(incoming) : remaining(maker);
      incoming.filledQuantity += quantity;
      maker.filledQuantity += quantity;
      updateStatus(incoming);
      updateStatus(maker);
      matches.push({
        makerOrderId: maker.id,
        takerOrderId: incoming.id,
        buyOrderId: incoming.side === "buy" ? incoming.id : maker.id,
        sellOrderId: incoming.side === "sell" ? incoming.id : maker.id,
        price: maker.price,
        quantity,
      });
      if (maker.status === "filled") opposite.shift();
    }

    updateStatus(incoming);
    if (remaining(incoming) > 0n) {
      const own = incoming.side === "buy" ? this.#bids : this.#asks;
      own.push(incoming);
      own.sort(incoming.side === "buy" ? compareBids : compareAsks);
    }
    return { order: incoming, matches };
  }

  cancel(orderId: string, userId: string): LimitOrder {
    const side = this.#bids.some((order) => order.id === orderId) ? this.#bids : this.#asks;
    const index = side.findIndex((order) => order.id === orderId);
    if (index < 0) throw new Error("ORDER_NOT_OPEN");
    const order = side[index];
    if (!order) throw new Error("ORDER_NOT_OPEN");
    if (order.userId !== userId) throw new Error("ORDER_OWNER_MISMATCH");
    side.splice(index, 1);
    order.status = "cancelled";
    return order;
  }
}

function compareBids(left: LimitOrder, right: LimitOrder): number {
  if (left.price !== right.price) return left.price > right.price ? -1 : 1;
  return left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0;
}

function compareAsks(left: LimitOrder, right: LimitOrder): number {
  if (left.price !== right.price) return left.price < right.price ? -1 : 1;
  return left.sequence < right.sequence ? -1 : left.sequence > right.sequence ? 1 : 0;
}
