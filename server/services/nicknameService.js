import { containsBadWord } from "../utils/nicknameFilter.js";

export function cleanNickname(value) {
  return String(value || "").trim().replace(/\s+/gu, " ");
}

export function nicknameKey(value) {
  return cleanNickname(value).replace(/\s+/gu, "").toLocaleLowerCase("ko-KR");
}

export function validateNickname(value) {
  const nickname = cleanNickname(value);
  const length = [...nickname].length;
  if (length < 2 || length > 12) {
    return { error: "닉네임은 2~12자로 입력해주세요." };
  }
  const key = nicknameKey(nickname);
  if (containsBadWord(nickname)) {
    return { error: "사용할 수 없는 단어가 포함되어 있어요." };
  }
  return { nickname, key };
}

export function findUserByNickname(database, value) {
  const key = nicknameKey(value);
  if (!key) return null;
  return database
    .prepare(
      `SELECT * FROM users
       WHERE LOWER(
         REPLACE(
           REPLACE(
             REPLACE(
               REPLACE(TRIM(nickname), ' ', ''),
               char(9), ''
             ),
             char(10), ''
           ),
           char(13), ''
         )
       ) = ?`,
    )
    .get(key);
}
