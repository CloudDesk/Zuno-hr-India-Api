export function normalizeSkillKey(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeAliases(aliases: string[] = []): string[] {
  const aliasMap = new Map<string, string>();

  for (const alias of aliases) {
    if (typeof alias !== 'string') {
      continue;
    }

    const trimmed = alias.trim();
    if (!trimmed) {
      continue;
    }

    const normalized = normalizeSkillKey(trimmed) || trimmed.toLowerCase();
    if (!aliasMap.has(normalized)) {
      aliasMap.set(normalized, trimmed);
    }
  }

  return Array.from(aliasMap.values());
}

export function trimString(value?: string): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
