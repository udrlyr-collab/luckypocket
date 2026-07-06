import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, publicUser } from "../db.js";
import { signToken } from "../middleware/auth.js";
import { recordAssetEvent } from "../services/assetEventService.js";
import {
  findUserByNickname,
  validateNickname,
} from "../services/nicknameService.js";

export const authRouter = Router();

function validateRegistration(body) {
  const nicknameResult = validateNickname(body.nickname);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const passwordConfirm = String(body.passwordConfirm || "");

  if (nicknameResult.error) return nicknameResult;
  if (!/^[A-Za-z0-9_]{4,20}$/.test(username)) {
    return { error: "아이디는 영문, 숫자, 밑줄을 사용해 4~20자로 입력해 주세요." };
  }
  if (password.length < 6 || password.length > 72) {
    return { error: "비밀번호는 6~72자로 입력해 주세요." };
  }
  if (password !== passwordConfirm) {
    return { error: "비밀번호 확인이 일치하지 않아요." };
  }
  return { nickname: nicknameResult.nickname, username, password };
}

authRouter.post("/register", async (req, res, next) => {
  try {
    const input = validateRegistration(req.body);
    if (input.error) return res.status(400).json({ message: input.error });

    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(input.username);
    if (existing) {
      return res.status(409).json({ message: "이미 사용 중인 아이디예요." });
    }
    if (findUserByNickname(db, input.nickname)) {
      return res.status(409).json({ message: "이미 사용 중인 닉네임이에요." });
    }

    const passwordHash = await bcrypt.hash(input.password, 12);
    let user;
    try {
      user = db.transaction(() => {
        const result = db
          .prepare(
            "INSERT INTO users (username, nickname, password_hash) VALUES (?, ?, ?)",
          )
          .run(input.username, input.nickname, passwordHash);
        const created = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);
        recordAssetEvent({
          userId: created.id,
          eventType: "signup_grant",
          amount: created.initial_balance,
          balanceBefore: 0,
          balanceAfter: created.balance,
          sourceType: "user",
          sourceId: created.id,
          detail: { label: "가입 시작 자산" },
        });
        return created;
      })();
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        const isNickname = String(error.message).includes("nickname");
        return res.status(409).json({
          message: isNickname
            ? "이미 사용 중인 닉네임이에요."
            : "이미 사용 중인 아이디예요.",
        });
      }
      throw error;
    }

    return res.status(201).json({ token: signToken(user.id), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    const matches = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!matches) {
      return res.status(401).json({ message: "아이디 또는 비밀번호가 올바르지 않아요." });
    }
    return res.json({ token: signToken(user.id), user: publicUser(user) });
  } catch (error) {
    return next(error);
  }
});
