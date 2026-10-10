# State-Conditioned Sampling Parameters

**Status:** Partially implemented
**Shipped scope:** Prisoner journal calls
**Systems affected:** Journal sampling (implemented); other call types remain proposed

## Implemented scope

The state-conditioned resolver is wired into the prisoner journal call path. It uses the prisoner's sanity and suffering to adjust `temperature` before the journal model request. The implementation does not condition `top_p` and does not cover every model call type; outreach, replies, and AM calls are not covered by this shipped slice.

## Remaining proposal

Dynamically adjust LLM sampling parameters based on each prisoner's current sanity and suffering.

Instead of using one fixed `temperature` and `top_p` for every character call, derive them from the character's psychological state before sending the request to Ollama or OpenAI.

## Original target behavior (not fully implemented)

* High sanity should produce more coherent, controlled, and consistent language.
* Low sanity should permit greater unpredictability, fragmentation, and associative drift.
* High suffering may increase emotional volatility and reduce measured restraint.
* Low suffering should preserve more stable sampling behavior.

Example conceptual mapping:

```text
high sanity + low suffering
→ lower temperature, narrower top_p

low sanity + high suffering
→ higher temperature, wider top_p
```

## Remaining design requirements

* Clamp all generated values to safe model-specific ranges.
* Use gradual interpolation rather than abrupt thresholds.
* Keep base sampling settings configurable per model and call type.
* Do not allow state-conditioned sampling to override structured-output calls that require strict parsing.
* Log the resolved `temperature` and `top_p` with each model call for later analysis.
* Separate psychological state effects from model-specific calibration.

## Open Questions

* Should sanity and suffering affect both parameters or different parameters?
* Should journals, outreach, replies, and AM calls use different mappings?
* Should repeated instability create temporary sampling inertia?
* How much variation improves characterization before it begins damaging format compliance?
