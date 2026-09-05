/**
 * `allNamed` — parallel await with NAMES instead of positions.
 *
 * `Promise.all([…])` returns results **by position**, so a destructuring
 * pattern that does not match the array order silently swaps values around.
 * TypeScript cannot catch it when the receiving component is typed loosely,
 * and the failure mode is not a compile error but a wrong-looking page (or a
 * runtime `x.map is not a function` inside an error boundary).
 *
 * This helper keeps the parallelism but keys every result by name, so the
 * value can only ever be read through the name it was produced under:
 *
 *   const { cities, propertyTypes } = await allNamed({
 *     cities: listCities(),
 *     propertyTypes: listPropertyTypes(),
 *   });
 *
 * Every promise is created eagerly (before `await`), so the queries still run
 * concurrently — this is not a sequential await.
 */

export type NamedPromises = Record<string, Promise<unknown>>;

export type Settled<T extends NamedPromises> = { [K in keyof T]: Awaited<T[K]> };

export async function allNamed<T extends NamedPromises>(queries: T): Promise<Settled<T>> {
  const keys = Object.keys(queries) as (keyof T & string)[];
  const values = await Promise.all(keys.map((key) => queries[key]));
  const out = {} as Settled<T>;
  for (let i = 0; i < keys.length; i++) {
    (out as Record<string, unknown>)[keys[i]!] = values[i];
  }
  return out;
}
