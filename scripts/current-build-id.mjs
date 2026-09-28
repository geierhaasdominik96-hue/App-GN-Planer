import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const inputs = [
  "apps/api/src",
  "apps/api/migrations",
  "apps/api/package.json",
  "apps/api/tsconfig.json",
  "apps/web/src",
  "apps/web/public",
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/tsconfig.app.json",
  "apps/web/tsconfig.json",
  "apps/web/tsconfig.node.json",
  "apps/web/vite.config.ts",
  "packages/contracts/src",
  "packages/contracts/package.json",
  "packages/contracts/tsconfig.json",
  "docker-compose.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json"
];

async function collectFiles(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  let details;

  try {
    details = await stat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  if (details.isFile()) return [relativePath];
  if (!details.isDirectory()) return [];

  const entries = await readdir(absolutePath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => collectFiles(path.join(relativePath, entry.name)))
  );
  return nestedFiles.flat();
}

const files = (await Promise.all(inputs.map(collectFiles)))
  .flat()
  .sort((left, right) => left.localeCompare(right));
const hash = createHash("sha256");

for (const relativePath of files) {
  hash.update(relativePath.replaceAll("\\", "/"));
  hash.update("\0");
  hash.update(await readFile(path.join(projectRoot, relativePath)));
  hash.update("\0");
}

// 20 Hex-Zeichen reichen als lokaler Änderungsmarker und bleiben gut lesbar.
process.stdout.write(hash.digest("hex").slice(0, 20));
