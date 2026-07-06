import fs from "node:fs";

export function extractClientAssetVersion(indexHtml) {
  const match = String(indexHtml || "").match(
    /<script[^>]+src=["'](\/assets\/index-[^"']+\.js)["'][^>]*>/i,
  );
  return match?.[1] || null;
}

export function readClientAssetVersion(indexPath) {
  try {
    return extractClientAssetVersion(fs.readFileSync(indexPath, "utf8"));
  } catch {
    return null;
  }
}
