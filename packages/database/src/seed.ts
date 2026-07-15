import { asc, eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { createDatabase } from "./index.js";
import { borrowPools, companies, holdings, marketMakerLedger, marketMakers, sectors, stocks, systemAccounts, systemSettings, users } from "./schema.js";

const sectorSeeds = [
  ["ai", "AI"], ["semiconductor", "반도체"], ["security", "보안"], ["finance", "금융"],
  ["game", "게임"], ["media", "미디어"], ["bio", "바이오"], ["aerospace", "우주항공"],
  ["energy", "에너지"], ["green", "친환경"], ["mining", "광업"], ["construction", "건설"],
  ["shipping", "해운"], ["aviation", "항공"], ["food", "식품"], ["service", "서비스"],
  ["retail", "유통"], ["software", "소프트웨어"], ["robotics", "로봇"], ["entertainment", "엔터테인먼트"],
] as const;

const companyWords = ["알파", "프라임", "넥서스", "오로라", "퀀텀", "버텍스"] as const;

async function seed(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const { db, pool } = createDatabase(databaseUrl);
  try {
    await ensureAdmin(db);
    const existingStock = await db.select({ id: stocks.id }).from(stocks).limit(1);
    if (existingStock.length > 0) {
      process.stdout.write("Seed skipped: stocks already exist.\n");
      return;
    }

    const [clearinghouse] = await db.insert(users).values({
      email: "derivatives-clearinghouse@system.invalid",
      username: "derivatives_clearinghouse",
      nickname: "파생상품 청산소",
      passwordHash: "!SYSTEM_ACCOUNT_NO_LOGIN!",
      cash: 1_000_000_000_000_000n,
      isSystem: true,
    }).returning({ id: users.id });
    if (!clearinghouse) throw new Error("Clearinghouse seed failed");
    await db.insert(systemAccounts).values({
      key: "derivatives_clearinghouse",
      userId: clearinghouse.id,
      description: "유한 자본 레버리지·공매도 청산 주문 계정",
    });
    const [treasury] = await db.insert(users).values({
      email: "exchange-treasury@system.invalid",
      username: "exchange_treasury",
      nickname: "거래소 금고",
      passwordHash: "!SYSTEM_ACCOUNT_NO_LOGIN!",
      cash: 0n,
      isSystem: true,
    }).returning({ id: users.id });
    if (!treasury) throw new Error("Exchange treasury seed failed");
    await db.insert(systemAccounts).values({ key: "exchange_treasury", userId: treasury.id, description: "현물 수수료·양도차익세 수납 계정" });
    await db.insert(systemSettings).values({ key: "spot_fee_bps", value: { value: 10 } }).onConflictDoNothing();

    await db.insert(sectors).values(sectorSeeds.map(([slug, name]) => ({ slug, name }))).onConflictDoNothing();
    const persistedSectors = await db.select().from(sectors).orderBy(asc(sectors.slug));
    if (persistedSectors.length < sectorSeeds.length) throw new Error("Required sectors are missing");

    let sequence = 0;
    for (const sector of persistedSectors) {
      for (const word of companyWords) {
        sequence += 1;
        const symbol = `MD${sequence.toString().padStart(3, "0")}`;
        const price = BigInt(1_000 + sequence * 137);
        const totalShares = BigInt(10_000_000 + sequence * 50_000);
        const [company] = await db.insert(companies).values({
          sectorId: sector.id,
          name: `${sector.name} ${word}`,
          description: `${sector.name} 산업의 가상 기업`,
          status: "listed",
          cash: 50_000_000_000n + BigInt(sequence) * 1_000_000_000n,
          debt: 10_000_000_000n,
          revenue: 80_000_000_000n + BigInt(sequence) * 2_000_000_000n,
          operatingProfit: 12_000_000_000n,
          netProfit: 8_000_000_000n,
          bookValue: 100_000_000_000n,
        }).returning({ id: companies.id });
        if (!company) throw new Error(`Company seed failed: ${symbol}`);
        const [stock] = await db.insert(stocks).values({
          companyId: company.id,
          symbol,
          totalShares,
          freeFloatShares: totalShares * 7n / 10n,
          treasuryShares: totalShares / 20n,
          currentPrice: price,
          previousClose: price,
          referencePrice: price,
          tickSize: price < 5_000n ? 5n : 10n,
        }).returning({ id: stocks.id });
        if (!stock) throw new Error(`Stock seed failed: ${symbol}`);

        const inventory = totalShares / 50n;
        const maxInventory = totalShares / 10n;
        const makerCash = price * inventory * 10n;
        const [makerUser] = await db.insert(users).values({
          email: `mm-${symbol.toLowerCase()}@system.invalid`,
          username: `mm_${symbol.toLowerCase()}`,
          nickname: `${symbol} 시장조성자`,
          passwordHash: "!SYSTEM_ACCOUNT_NO_LOGIN!",
          cash: makerCash,
          isSystem: true,
        }).returning({ id: users.id });
        if (!makerUser) throw new Error(`Market-maker user seed failed: ${symbol}`);
        await db.insert(holdings).values({
          userId: makerUser.id,
          stockId: stock.id,
          quantity: inventory,
          costBasis: price * inventory,
        });
        await db.insert(borrowPools).values({
          stockId: stock.id,
          borrowableQuantity: totalShares * 7n / 50n,
          baseBorrowFeeBps: 100 + sequence % 200,
          maxBorrowFeeBps: 5_000,
        });
        const [maker] = await db.insert(marketMakers).values({
          userId: makerUser.id,
          stockId: stock.id,
          cashBalance: makerCash,
          inventory,
          targetInventory: inventory,
          maxInventory,
          baseSpreadBps: 80 + sequence % 120,
          orderDepth: 5,
          refreshIntervalMs: 10_000 + (sequence % 5) * 1_000,
          riskAversionBps: 100 + sequence % 200,
        }).returning({ id: marketMakers.id });
        if (!maker) throw new Error(`Market-maker seed failed: ${symbol}`);
        await db.insert(marketMakerLedger).values({
          marketMakerId: maker.id,
          eventType: "initial_funding",
          cashDelta: makerCash,
          inventoryDelta: inventory,
          cashAfter: makerCash,
          inventoryAfter: inventory,
          referenceId: symbol,
        });
      }
    }
    process.stdout.write(`Seed complete: ${persistedSectors.length} sectors, ${sequence} stocks.\n`);
  } finally {
    await pool.end();
  }
}

async function ensureAdmin(db: ReturnType<typeof createDatabase>["db"]): Promise<void> {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const username = process.env.ADMIN_USERNAME?.trim().toLowerCase() ?? "market_admin";
  const nickname = process.env.ADMIN_NICKNAME?.trim() ?? "관리자";
  if (!email || !password) {
    if (process.env.NODE_ENV === "production") throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD are required in production");
    return;
  }
  if (password.length < 16 || password.length > 128) throw new Error("ADMIN_PASSWORD must be 16-128 characters");
  const passwordHash = await bcrypt.hash(password, 12);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    await db.update(users).set({ passwordHash, role: "admin", isActive: true, isSystem: false, updatedAt: new Date() }).where(eq(users.id, existing.id));
  } else {
    await db.insert(users).values({ email, username, nickname, passwordHash, role: "admin", cash: 100_000_000n });
  }
}

await seed();
