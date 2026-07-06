const BLOCKED_TERMS = [
  "관리자",
  "운영자",
  "어드민",
  "행운주머니",
  "admin",
  "administrator",
  "system",
  "시발",
  "씨발",
  "ㅅㅂ",
  "병신",
  "ㅂㅅ",
  "개새끼",
  "새끼",
  "좆",
  "존나",
  "지랄",
  "꺼져",
  "fuck",
  "fucker",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "pussy",
  "cunt",
];

const LEET_MAP = new Map([
  ["0", "o"],
  ["1", "i"],
  ["3", "e"],
  ["4", "a"],
  ["5", "s"],
  ["7", "t"],
  ["8", "b"],
  ["@", "a"],
  ["$", "s"],
]);

export function normalizeForBadWordCheck(value) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("ko-KR");
  const mapped = [...normalized]
    .map((character) => LEET_MAP.get(character) || character)
    .join("");
  return mapped.replace(/[^a-z가-힣ㄱ-ㅎㅏ-ㅣ]/gu, "");
}

const NORMALIZED_BLOCKED_TERMS = BLOCKED_TERMS.map(normalizeForBadWordCheck);

export function containsBadWord(nickname) {
  const normalized = normalizeForBadWordCheck(nickname);
  return Boolean(
    normalized &&
      NORMALIZED_BLOCKED_TERMS.some((blocked) => blocked && normalized.includes(blocked)),
  );
}
