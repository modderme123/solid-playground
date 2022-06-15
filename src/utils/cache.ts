let cache: { [key: string]: any } = {};
export function once<T>(key: string, valueGenerator: () => T): T {
  if (cache[key]) {
    return cache[key];
  }
  cache[key] = valueGenerator();
  return cache[key];
}
