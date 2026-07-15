import { createHash, randomBytes, randomUUID } from "node:crypto";
import { BadRequestException, Body, ConflictException, Controller, Injectable, Post, Req, UnauthorizedException } from "@nestjs/common";
import { refreshTokens, users } from "@market-dominion/database";
import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { DatabaseService } from "./database.service.js";

const credentialsSchema = z.object({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
});

const registerSchema = credentialsSchema.extend({
  username: z.string().trim().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).transform((value) => value.toLowerCase()),
  nickname: z.string().trim().min(2).max(20),
});

const refreshSchema = z.object({ refreshToken: z.string().min(32).max(512) });

type PublicUser = { id: string; email: string; username: string; nickname: string; role: "user" | "admin" };
type AuthContext = { ipAddress?: string; userAgent?: string };

@Injectable()
export class AuthService {
  readonly #jwtSecret: string;

  constructor(private readonly database: DatabaseService) {
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret || jwtSecret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    this.#jwtSecret = jwtSecret;
  }

  async register(input: unknown) {
    const value = parse(registerSchema, input);
    const passwordHash = await bcrypt.hash(value.password, 12);
    try {
      const [user] = await this.database.db.insert(users).values({
        email: value.email,
        username: value.username,
        nickname: value.nickname,
        passwordHash,
      }).returning({ id: users.id, email: users.email, username: users.username, nickname: users.nickname, role: users.role });
      if (!user) throw new Error("User insert returned no row");
      return { user, ...(await this.#issueTokenPair(user)) };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException("이미 사용 중인 이메일, 사용자명 또는 닉네임입니다.");
      throw error;
    }
  }

  async login(input: unknown, context: AuthContext = {}) {
    const value = parse(credentialsSchema, input);
    const [user] = await this.database.db.select().from(users).where(eq(users.email, value.email)).limit(1);
    if (!user || !user.isActive || user.isSystem || !(await bcrypt.compare(value.password, user.passwordHash))) {
      await this.#recordLogin(user?.id, value.email, false, context, !user ? "UNKNOWN_ACCOUNT" : !user.isActive ? "ACCOUNT_SUSPENDED" : user.isSystem ? "SYSTEM_ACCOUNT" : "INVALID_PASSWORD");
      throw new UnauthorizedException("이메일 또는 비밀번호가 올바르지 않습니다.");
    }
    await this.#recordLogin(user.id, value.email, true, context);
    const publicUser = pickPublicUser(user);
    return { user: publicUser, ...(await this.#issueTokenPair(publicUser)) };
  }

  async rotate(input: unknown) {
    const { refreshToken } = parse(refreshSchema, input);
    const tokenHash = hashToken(refreshToken);
    const [stored] = await this.database.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);
    if (!stored || stored.expiresAt <= new Date()) throw new UnauthorizedException("refresh token이 유효하지 않습니다.");
    if (stored.revokedAt) {
      await this.database.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.familyId, stored.familyId));
      await this.database.pool.query("INSERT INTO security_events (user_id,event_type,severity,metadata) VALUES ($1,'refresh_token_reuse','critical',jsonb_build_object('familyId',$2::text))", [stored.userId, stored.familyId]);
      throw new UnauthorizedException("재사용된 refresh token입니다. 해당 token family를 폐기했습니다.");
    }
    const [user] = await this.database.db.select().from(users).where(and(eq(users.id, stored.userId), eq(users.isActive, true))).limit(1);
    if (!user) throw new UnauthorizedException("사용할 수 없는 계정입니다.");

    const nextToken = randomBytes(48).toString("base64url");
    const nextId = randomUUID();
    await this.database.db.transaction(async (transaction) => {
      await transaction.update(refreshTokens).set({ revokedAt: new Date(), replacedById: nextId }).where(eq(refreshTokens.id, stored.id));
      await transaction.insert(refreshTokens).values({
        id: nextId,
        userId: user.id,
        familyId: stored.familyId,
        tokenHash: hashToken(nextToken),
        expiresAt: refreshExpiry(),
      });
    });
    const publicUser = pickPublicUser(user);
    return { user: publicUser, accessToken: this.#signAccess(publicUser), refreshToken: nextToken };
  }

  async logout(input: unknown): Promise<{ success: true }> {
    const { refreshToken } = parse(refreshSchema, input);
    await this.database.db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    return { success: true };
  }

  async #issueTokenPair(user: PublicUser) {
    const refreshToken = randomBytes(48).toString("base64url");
    await this.database.db.insert(refreshTokens).values({
      userId: user.id,
      familyId: randomUUID(),
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiry(),
    });
    return { accessToken: this.#signAccess(user), refreshToken };
  }

  #signAccess(user: PublicUser): string {
    return jwt.sign({ sub: user.id, role: user.role, username: user.username }, this.#jwtSecret, {
      algorithm: "HS256",
      expiresIn: "15m",
      issuer: "market-dominion",
      audience: "market-dominion-web",
    });
  }

  async #recordLogin(userId: string | undefined, email: string, succeeded: boolean, context: AuthContext, failureReason?: string) {
    await this.database.pool.query(
      "INSERT INTO login_events (user_id,email,succeeded,ip_address,user_agent,failure_reason) VALUES ($1,$2,$3,$4,$5,$6)",
      [userId ?? null, email, succeeded, context.ipAddress?.slice(0, 100) ?? null, context.userAgent?.slice(0, 500) ?? null, failureReason ?? null],
    );
    if (!succeeded) await this.database.pool.query(
      "INSERT INTO security_events (user_id,event_type,severity,ip_address,metadata) VALUES ($1,'login_failed','warning',$2,jsonb_build_object('email',$3::text,'reason',$4::text))",
      [userId ?? null, context.ipAddress?.slice(0, 100) ?? null, email, failureReason ?? "UNKNOWN"],
    );
  }
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register") register(@Body() body: unknown) { return this.auth.register(body); }
  @Post("login") login(@Body() body: unknown, @Req() request: { ip?: string; headers: { "user-agent"?: string } }) {
    return this.auth.login(body, { ...(request.ip ? { ipAddress: request.ip } : {}), ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}) });
  }
  @Post("refresh") refresh(@Body() body: unknown) { return this.auth.rotate(body); }
  @Post("logout") logout(@Body() body: unknown) { return this.auth.logout(body); }
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException({ message: "입력값이 올바르지 않습니다.", issues: result.error.issues });
  return result.data;
}

function pickPublicUser(user: typeof users.$inferSelect): PublicUser {
  return { id: user.id, email: user.email, username: user.username, nickname: user.nickname, role: user.role };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function refreshExpiry(): Date {
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
