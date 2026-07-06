import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanNickname,
  nicknameKey,
  validateNickname,
} from "../server/services/nicknameService.js";

test("nickname normalization prevents case and whitespace bypasses", () => {
  assert.equal(cleanNickname("  Lucky   User  "), "Lucky User");
  assert.equal(nicknameKey("Lucky User"), nicknameKey(" luckyuser "));
});

test("nickname validation enforces length and blocked words", () => {
  assert.equal(validateNickname("가").error, "닉네임은 2~12자로 입력해주세요.");
  assert.equal(validateNickname("관리자님").error, "사용할 수 없는 단어가 포함되어 있어요.");
  assert.equal(validateNickname("f.u.c.k").error, "사용할 수 없는 단어가 포함되어 있어요.");
  assert.equal(validateNickname("씨 발").error, "사용할 수 없는 단어가 포함되어 있어요.");
  assert.equal(validateNickname("행운친구").nickname, "행운친구");
});
