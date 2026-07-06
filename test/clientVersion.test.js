import test from "node:test";
import assert from "node:assert/strict";
import { extractClientAssetVersion } from "../server/services/clientVersionService.js";

test("client build version is extracted from a Vite production entry", () => {
  assert.equal(
    extractClientAssetVersion(
      '<script type="module" crossorigin src="/assets/index-BFsML-KA.js"></script>',
    ),
    "/assets/index-BFsML-KA.js",
  );
  assert.equal(
    extractClientAssetVersion('<script type="module" src="/src/main.jsx"></script>'),
    null,
  );
});
