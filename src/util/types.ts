/** Resolves to true only when the two types are mutually assignable. */
export type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Compile-time assertion that its type argument resolves to true. */
export type Expect<T extends true> = T;
