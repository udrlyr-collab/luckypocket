import { describe, expect, test } from "vitest";
import { accruedBorrowFee, calculateLiquidationPrice, calculateSpotSettlement, dynamicBorrowFeeBps, estimateLeveragedPosition, estimateSpotLiquidation, LimitOrderBook, type LimitOrder, type OrderSide } from "../src/index.js";

function order(id: string, userId: string, side: OrderSide, price: bigint, quantity: bigint, sequence: bigint): LimitOrder {
  return {
    id,
    userId,
    side,
    price,
    quantity,
    sequence,
    symbol: "MDX",
    type: "limit",
    filledQuantity: 0n,
    status: "pending",
    createdAt: new Date(Number(sequence)),
  };
}

describe("LimitOrderBook", () => {
  test("matches best price before earlier worse price", () => {
    const book = new LimitOrderBook("MDX");
    book.submit(order("s1", "u1", "sell", 110n, 5n, 1n));
    book.submit(order("s2", "u2", "sell", 100n, 5n, 2n));

    const result = book.submit(order("b1", "u3", "buy", 110n, 6n, 3n));

    expect(result.matches.map((trade) => [trade.makerOrderId, trade.price, trade.quantity])).toEqual([
      ["s2", 100n, 5n],
      ["s1", 110n, 1n],
    ]);
  });

  test("matches time priority at equal price and keeps partial remainder", () => {
    const book = new LimitOrderBook("MDX");
    book.submit(order("s1", "u1", "sell", 100n, 4n, 1n));
    book.submit(order("s2", "u2", "sell", 100n, 4n, 2n));

    const result = book.submit(order("b1", "u3", "buy", 100n, 6n, 3n));

    expect(result.matches.map((trade) => trade.makerOrderId)).toEqual(["s1", "s2"]);
    expect(book.asks[0]?.id).toBe("s2");
    expect(book.asks[0]?.filledQuantity).toBe(2n);
    expect(book.asks[0]?.status).toBe("partially_filled");
  });

  test("uses resting order price and rejects self trade", () => {
    const book = new LimitOrderBook("MDX");
    book.submit(order("s1", "same-user", "sell", 90n, 2n, 1n));

    const result = book.submit(order("b1", "same-user", "buy", 100n, 2n, 2n));

    expect(result.matches).toEqual([]);
    expect(result.order.status).toBe("rejected");
    expect(book.asks).toHaveLength(1);
  });

  test("cancels only owner open order", () => {
    const book = new LimitOrderBook("MDX");
    book.submit(order("b1", "u1", "buy", 100n, 2n, 1n));

    expect(() => book.cancel("b1", "u2")).toThrow("ORDER_OWNER_MISMATCH");
    expect(book.cancel("b1", "u1").status).toBe("cancelled");
    expect(book.bids).toHaveLength(0);
  });
});

describe("calculateSpotSettlement", () => {
  test("allocates proportional cost basis and releases buy limit reservation", () => {
    expect(calculateSpotSettlement({
      executionPrice: 90n,
      buyLimitPrice: 100n,
      fillQuantity: 4n,
      sellerQuantityBefore: 10n,
      sellerCostBasisBefore: 800n,
    })).toEqual({
      tradeValue: 360n,
      buyerFee: 0n,
      sellerFee: 0n,
      sellerTax: 0n,
      buyerDebit: 360n,
      sellerCredit: 360n,
      buyerReserveRelease: 400n,
      sellerAllocatedCost: 320n,
      sellerRealizedPnl: 40n,
    });
  });

  test("rejects execution above buyer limit", () => {
    expect(() => calculateSpotSettlement({
      executionPrice: 101n,
      buyLimitPrice: 100n,
      fillQuantity: 1n,
      sellerQuantityBefore: 1n,
      sellerCostBasisBefore: 50n,
    })).toThrow("EXECUTION_EXCEEDS_BUY_LIMIT");
  });

  test("charges both fees and only taxes positive seller profit", () => {
    expect(calculateSpotSettlement({ executionPrice: 100n, buyLimitPrice: 100n, fillQuantity: 10n, sellerQuantityBefore: 10n, sellerCostBasisBefore: 500n, buyerFeeBps: 100n, sellerFeeBps: 100n, positivePnlTaxBps: 1_000n })).toMatchObject({ tradeValue: 1_000n, buyerFee: 10n, sellerFee: 10n, sellerTax: 49n, buyerDebit: 1_010n, sellerCredit: 941n, buyerReserveRelease: 1_010n, sellerRealizedPnl: 441n });
  });
});

describe("estimateSpotLiquidation", () => {
  test("walks bid depth and applies fee and positive-PnL tax", () => {
    expect(estimateSpotLiquidation({
      quantity: 10n,
      costBasis: 800n,
      currentPrice: 100n,
      bids: [{ price: 99n, quantity: 4n }, { price: 95n, quantity: 3n }],
      sellFeeBps: 10n,
      positivePnlTaxBps: 500n,
    })).toEqual({
      requestedQuantity: 10n,
      filledQuantity: 7n,
      unfilledQuantity: 3n,
      grossProceeds: 681n,
      estimatedFee: 0n,
      estimatedTax: 6n,
      netProceeds: 675n,
      estimatedRealizedPnl: 115n,
      averagePrice: 97n,
      lastPrice: 95n,
      slippageBps: -300n,
    });
  });

  test("does not tax a loss or invent value for missing liquidity", () => {
    const estimate = estimateSpotLiquidation({ quantity: 5n, costBasis: 500n, currentPrice: 100n, bids: [], sellFeeBps: 10n, positivePnlTaxBps: 500n });
    expect(estimate.netProceeds).toBe(0n);
    expect(estimate.estimatedTax).toBe(0n);
    expect(estimate.unfilledQuantity).toBe(5n);
    expect(estimate.averagePrice).toBeNull();
  });
});

describe("leveraged positions", () => {
  test("long and short PnL preserve direction without Math.abs", () => {
    const common = { quantity: 10n, margin: 200n, entryPrice: 100n, currentPrice: 90n, maintenanceMarginBps: 500n, closeFeeBps: 10n };
    expect(estimateLeveragedPosition({ ...common, side: "long" }).pnl).toBe(-100n);
    expect(estimateLeveragedPosition({ ...common, side: "short" }).pnl).toBe(100n);
  });

  test("calculates side-specific liquidation prices", () => {
    expect(calculateLiquidationPrice({ side: "long", entryPrice: 1000n, leverage: 5, maintenanceMarginBps: 500n })).toBe(810n);
    expect(calculateLiquidationPrice({ side: "short", entryPrice: 1000n, leverage: 5, maintenanceMarginBps: 500n })).toBe(1190n);
  });

  test("borrow fee reduces only short net settlement", () => {
    const common = { quantity: 10n, margin: 200n, entryPrice: 100n, currentPrice: 100n, maintenanceMarginBps: 500n, closeFeeBps: 0n, accruedBorrowFee: 20n };
    expect(estimateLeveragedPosition({ ...common, side: "long" }).netSettlementValue).toBe(200n);
    expect(estimateLeveragedPosition({ ...common, side: "short" }).netSettlementValue).toBe(180n);
  });

  test("borrow fee rises quadratically with utilization and accrues by time", () => {
    expect(dynamicBorrowFeeBps({ borrowableQuantity: 100n, borrowedQuantity: 50n, baseFeeBps: 100n, maxFeeBps: 5_000n })).toBe(1_325n);
    expect(dynamicBorrowFeeBps({ borrowableQuantity: 100n, borrowedQuantity: 100n, baseFeeBps: 100n, maxFeeBps: 5_000n })).toBe(5_000n);
    expect(accruedBorrowFee({ positionSize: 10_000n, annualFeeBps: 1_000n, elapsedMilliseconds: 365n * 24n * 60n * 60n * 1_000n })).toBe(1_000n);
  });
});
