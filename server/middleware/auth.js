import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";

export function signToken(userId, isAdmin = false) {
  return jwt.sign({ sub: String(userId), isAdmin }, config.jwtSecret, {
    expiresIn: "7d",
    issuer: "lucky-pocket",
  });
}

export function requireAuth(req, res, next) {
  const value = req.get("authorization") || "";
  const token = value.startsWith("Bearer ") ? value.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "로그인이 필요해요." });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      issuer: "lucky-pocket",
    });
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(Number(payload.sub));
    if (!user) {
      return res.status(401).json({ message: "유효하지 않은 로그인 정보예요." });
    }

    // 접근 금지 정지 검사 (관리자가 아닌 경우에만)
    if (user.username !== "admin" && user.suspended_access_until) {
      const now = new Date();
      const suspendUntil = new Date(user.suspended_access_until);
      if (suspendUntil > now) {
        return res.status(403).json({
          code: "USER_SUSPENDED_ACCESS",
          message: `접근이 제한된 계정입니다. (제한 만료: ${suspendUntil.toLocaleString("ko-KR")})`,
          until: user.suspended_access_until,
          reason: user.suspended_access_reason || "사유 미지정"
        });
      }
    }

    if (payload.isAdmin) {
      user.isAdmin = true;
    }
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "로그인이 만료되었어요. 다시 로그인해 주세요." });
  }
}

export function checkUserActionSuspended(req, res, next) {
  const user = req.user;
  if (user && user.username !== "admin" && user.suspended_action_until) {
    const now = new Date();
    const suspendUntil = new Date(user.suspended_action_until);
    if (suspendUntil > now) {
      return res.status(403).json({
        code: "USER_SUSPENDED_ACTION",
        message: `재산 정지 상태입니다. 주식 매수 및 게임 플레이가 제한됩니다. (제한 만료: ${suspendUntil.toLocaleString("ko-KR")})`,
        until: user.suspended_action_until,
        reason: user.suspended_action_reason || "사유 미지정"
      });
    }
  }
  return next();
}
