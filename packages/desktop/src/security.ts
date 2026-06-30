import path from "node:path";

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function validateExternalUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid URL");
  }

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`Blocked URL protocol: ${parsed.protocol}`);
  }

  return parsed.toString();
}

export function resolveRootSubpath(root: string, subpath: string): string {
  const normalizedRoot = path.resolve(root);
  const full = path.isAbsolute(subpath)
    ? path.resolve(subpath)
    : path.resolve(normalizedRoot, subpath);

  const relative = path.relative(normalizedRoot, full);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Path must be inside the DevTent environment folder");
  }

  return full;
}
