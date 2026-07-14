## Architecture and inference discipline

When performing reconnaissance, review, architecture design, or experimental-design work, do not collapse source evidence and proposed design into one conclusion.

### Classify conclusions

Distinguish explicitly between:

- **Source fact** — directly established by current code, tests, configuration, or runtime structure.
- **Mechanical implication** — necessarily follows from established source facts.
- **Design recommendation** — one possible engineering choice with tradeoffs.
- **User-intent decision** — cannot be resolved from source and requires the user's intended semantics or research goal.

Do not present a design recommendation as though the repository already requires it.

### Trace execution before relocating ownership

Before moving or centralizing a mechanism, identify:

1. where it currently executes;
2. what inputs are available at that exact stage;
3. which ordering, accumulation, clamping, or state semantics depend on that location;
4. whether the proposed destination has enough information to preserve those semantics.

Centralized configuration does not imply centralized execution. A shared policy may configure mechanisms that must continue executing in separate source-specific modules.

### Prefer the smallest live improvement

Do not introduce an unused schema, loader, service, configuration file, abstraction, or extension point merely because it fits a future architecture.

Prefer the smallest change that:

- is consumed by live code immediately;
- removes an existing ambiguity;
- preserves current behavior by default;
- is independently testable;
- leaves later generalization possible.

Avoid replacing one dead abstraction surface with another.

### Check proposed designs for internal contradictions

Before recommending an architecture, test it for incompatible claims, including:

- immutable configuration plus mutable test setters;
- `mode: "none"` plus a separate enabled/disabled flag;
- nested configuration plus shallow merge semantics;
- a factory-selected design without deciding how the factory result reaches callers;
- a module described as a leaf while it imports from a module that imports or re-exports it;
- a public behavior-preserving refactor that changes return shape, object keys, serialization, or ordering.

Resolve contradictions explicitly rather than leaving them to implementation.

### Use precise strength of claim

Do not overstate what source inspection or one test establishes.

Examples:

- fixed traversal order establishes determinism under that order, not arbitrary-order independence;
- a live read with no repository writes is an undeclared override channel, not necessarily dead code;
- importing a production helper creates an integration check, not an independent oracle;
- a second mutation derived from an earlier effect establishes a causal-overlap pathway, not necessarily identical double application on every run;
- a high transmission-coefficient floor guarantees minimum transmission, not general safety or stability;
- a browser or Node feature is not supported until syntax, runtime version, loading path, and environment compatibility are verified.

When uncertain, state the narrower claim and identify what evidence would justify the stronger one.

### Preserve executed semantics during configuration work

Treat current production behavior as a reproducible historical baseline even when its original intent is uncertain.

Do not silently correct, consolidate, or reinterpret behavior while exposing it through configuration. Separate:

1. making existing behavior explicit;
2. enabling alternate behavior;
3. deciding whether existing behavior is scientifically desirable.

Each should be a distinct change unless the task explicitly requires otherwise.

### Validate environment-specific assumptions

Do not infer compatibility from general platform knowledge alone.

For file formats, module loading, test execution, browser behavior, Node behavior, MIME handling, shell behavior, or dependency support:

- inspect the repository's actual runtime and tooling;
- verify the proposed mechanism in both relevant environments;
- distinguish eventual format choice from runtime policy architecture.

### Architecture-report self-check

Before finalizing a design report, ask:

1. Which conclusions are direct source facts?
2. Which conclusions are recommendations?
3. Did I move execution merely because I centralized configuration?
4. Did I create any contradictory configuration states?
5. Did I claim independence while sharing implementation?
6. Did I claim behavioral preservation while changing observable shape or order?
7. Did I add an abstraction that live runtime would not yet consume?
8. Did I decide a question that actually requires user intent?
9. Is the first proposed PR the smallest behavior-preserving precursor?
10. What evidence would falsify my recommended design?