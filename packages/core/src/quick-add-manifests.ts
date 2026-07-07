import type { QuickAddManifest } from "./types.js";

const QUICK_ADD_HIDDEN = new Set(["composer", "bun", "cloudflared"]);

export type QuickAddCategory = "php" | "web" | "database" | "cache-mail" | "tools";

export function getQuickAddCategory(name: string): QuickAddCategory {
  if (name.startsWith("php-")) return "php";
  if (name === "nginx" || name.startsWith("apache")) return "web";
  if (
    name.startsWith("mysql") ||
    name.startsWith("mariadb") ||
    name.startsWith("postgresql")
  ) {
    return "database";
  }
  if (name === "redis" || name === "mailpit" || name === "mkcert") {
    return "cache-mail";
  }
  return "tools";
}

export const QUICK_ADD_CATEGORY_LABELS: Record<QuickAddCategory, string> = {
  php: "PHP runtimes",
  web: "Web servers",
  database: "Databases",
  "cache-mail": "Cache, mail & SSL",
  tools: "Other tools",
};

export function listQuickAddManifests(manifests: QuickAddManifest[]): QuickAddManifest[] {
  return manifests.filter(
    (m) => !QUICK_ADD_HIDDEN.has(m.name) && !m.name.startsWith("node-")
  );
}

export function groupQuickAddManifests(
  manifests: QuickAddManifest[]
): { category: QuickAddCategory; label: string; items: QuickAddManifest[] }[] {
  const filtered = listQuickAddManifests(manifests);
  const order: QuickAddCategory[] = ["php", "web", "database", "cache-mail", "tools"];
  return order
    .map((category) => ({
      category,
      label: QUICK_ADD_CATEGORY_LABELS[category],
      items: filtered.filter((m) => getQuickAddCategory(m.name) === category),
    }))
    .filter((group) => group.items.length > 0);
}
