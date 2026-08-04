/** Scope-setting methods required before a standard builder can terminate. */
export type ScopeBuilderStep = "for" | "over";

/**
 * Impossible marker properties that name any scope-setting methods a builder
 * has not called yet. They make incomplete terminal calls fail with a useful
 * TypeScript diagnostic.
 */
export type MissingScopeBuilderSteps<
  Completed extends ScopeBuilderStep,
  Required extends ScopeBuilderStep = ScopeBuilderStep,
> = {
  readonly [K in Exclude<Required, Completed> as `Call .${K}() before a terminal method`]: never;
};

/** A builder constrained to have completed all of its required scope steps. */
export type ScopedBuilder<
  B,
  Completed extends ScopeBuilderStep,
  Required extends ScopeBuilderStep = ScopeBuilderStep,
> = B & MissingScopeBuilderSteps<Completed, Required>;
