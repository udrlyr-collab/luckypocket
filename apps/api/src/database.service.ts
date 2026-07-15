import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createDatabase } from "@market-dominion/database";

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db;
  readonly pool;

  constructor() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is required");
    const connection = createDatabase(databaseUrl);
    this.db = connection.db;
    this.pool = connection.pool;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
