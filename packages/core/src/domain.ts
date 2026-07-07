/** TLD that modern browsers resolve to 127.0.0.1 without a hosts file entry. */
export const ZERO_ADMIN_TLD = "localhost";

export function normalizeTld(tld: string): string {
  const trimmed = tld.trim().toLowerCase().replace(/^\./, "");
  if (!trimmed) return ZERO_ADMIN_TLD;
  if (!/^[a-z0-9-]+$/.test(trimmed)) {
    throw new Error("TLD may only contain letters, numbers, and hyphens");
  }
  return trimmed;
}

export function tldRequiresHostsFile(tld: string): boolean {
  return normalizeTld(tld) !== ZERO_ADMIN_TLD;
}

export function formatSiteDomain(siteName: string, tld: string): string {
  return `${siteName}.${normalizeTld(tld)}`;
}
