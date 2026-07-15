import { CanActivate, createParamDecorator, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import jwt from "jsonwebtoken";

export type AccessPrincipal = { userId: string; username: string; role: "user" | "admin" };

type AuthenticatedRequest = { headers: { authorization?: string }; principal?: AccessPrincipal };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const [scheme, token] = request.headers.authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) throw new UnauthorizedException("access token이 필요합니다.");
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    try {
      const payload = jwt.verify(token, secret, {
        algorithms: ["HS256"],
        issuer: "market-dominion",
        audience: "market-dominion-web",
      });
      if (typeof payload === "string" || typeof payload.sub !== "string" || typeof payload.username !== "string") {
        throw new Error("invalid claims");
      }
      if (payload.role !== "user" && payload.role !== "admin") throw new Error("invalid role");
      request.principal = { userId: payload.sub, username: payload.username, role: payload.role };
      return true;
    } catch {
      throw new UnauthorizedException("access token이 유효하지 않습니다.");
    }
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
    if (principal?.role !== "admin") throw new ForbiddenException("관리자 권한이 필요합니다.");
    return true;
  }
}

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): AccessPrincipal => {
  const principal = context.switchToHttp().getRequest<AuthenticatedRequest>().principal;
  if (!principal) throw new UnauthorizedException("인증 정보가 없습니다.");
  return principal;
});
