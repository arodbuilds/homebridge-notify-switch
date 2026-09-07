/**
 * Prototype-pollution guard shared by startup validation, the settings UI's Restore from backup and
 * its draft recovery (SPEC section 12, item 12). A JSON document can carry own properties named
 * `__proto__`, `constructor` or `prototype`; anything that later spreads or merges such an object
 * could reach the prototype chain. The plugin never accepts them at any nesting level.
 */

export const FORBIDDEN_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/**
 * The path of the first forbidden key found anywhere in `value` (for example `providers[0].__proto__`),
 * or undefined when there is none. Arrays are walked with their indices.
 */
export function findForbiddenKey(value: unknown, path = ''): string | undefined {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findForbiddenKey(value[i], `${path}[${i}]`);
      if (found !== undefined) {
        return found;
      }
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  for (const key of Object.keys(value)) {
    const keyPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_KEYS.includes(key)) {
      return keyPath;
    }
    const found = findForbiddenKey((value as Record<string, unknown>)[key], keyPath);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}
