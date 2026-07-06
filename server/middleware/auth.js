import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { db } from "../db.js";

export function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
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
    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "로그인이 만료되었어요. 다시 로그인해 주세요." });
  }
}
