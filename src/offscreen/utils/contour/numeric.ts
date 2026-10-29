/** Rust f32 arithmetic boundaries used by the portable contour solver. */
export const f32 = Math.fround;
/** Rust f32::EPSILON, not Number.EPSILON and not a pixel tolerance. */
export const F32_EPSILON = 1.1920928955078125e-7;
/** Add two values with Rust f32 rounding. @returns Rounded sum. */
export const add = (a: number, b: number): number => f32(f32(a) + f32(b));
/** Subtract values with Rust f32 rounding. @returns Rounded difference. */
export const sub = (a: number, b: number): number => f32(f32(a) - f32(b));
/** Multiply values with Rust f32 rounding. @returns Rounded product. */
export const mul = (a: number, b: number): number => f32(f32(a) * f32(b));
/** Divide values with Rust f32 rounding. @returns Rounded quotient. */
export const div = (a: number, b: number): number => f32(f32(a) / f32(b));
/** Sum inputs sequentially as Rust Iterator::sum::<f32>(). @returns Rounded sum. */
export function sum(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total = add(total, value);
  return total;
}
