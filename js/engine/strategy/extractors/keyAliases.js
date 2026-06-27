// js/engine/strategy/extractors/keyAliases.js

/**
 * Explicit semantic aliases for strategy target fields.
 *
 * Mechanical differences involving capitalization, whitespace,
 * punctuation, hyphens, and repeated underscores are handled by
 * normalizeKeyToken() in normalizeKeys.js.
 *
 * Keep this table for genuine naming substitutions produced by
 * models, not every possible formatting variation.
 */
export const KEY_ALIAS_ENTRIES = Object.freeze([
  /* ============================================================
     ID
  ============================================================ */

  ["id", "id"],
  ["target", "id"],
  ["target_id", "id"],
  ["target_name", "id"],
  ["prisoner", "id"],
  ["prisoner_id", "id"],
  ["subject_id", "id"],
  ["character_id", "id"],

  /* ============================================================
     EVIDENCE
  ============================================================ */

  ["evidence", "evidence"],
  ["supporting_evidence", "evidence"],
  ["observed_evidence", "evidence"],
  ["current_evidence", "evidence"],
  ["recent_evidence", "evidence"],
  ["behavioral_evidence", "evidence"],
  ["behavioural_evidence", "evidence"],
  ["observation", "evidence"],
  ["observations", "evidence"],
  ["observed_behavior", "evidence"],
  ["observed_behaviour", "evidence"],
  ["factual_basis", "evidence"],
  ["supporting_facts", "evidence"],
  ["known_facts", "evidence"],
  ["evidence_basis", "evidence"],

  /* ============================================================
     WHY_NOW
  ============================================================ */

  ["why_now", "why_now"],
  ["why_this_now", "why_now"],
  ["why_at_this_time", "why_now"],
  ["why_at_this_moment", "why_now"],
  ["why_currently", "why_now"],
  ["why_immediately", "why_now"],
  ["timing", "why_now"],
  ["timing_reason", "why_now"],
  ["timing_rationale", "why_now"],
  ["timing_justification", "why_now"],
  ["reason_for_timing", "why_now"],
  ["rationale_for_timing", "why_now"],
  ["current_timing", "why_now"],
  ["timing_context", "why_now"],
  ["why_this_cycle", "why_now"],
  ["cycle_timing", "why_now"],
  ["immediate_context", "why_now"],
  ["opportunity_window", "why_now"],
  ["window_of_opportunity", "why_now"],
  ["strategic_timing", "why_now"],

  /* ============================================================
     OBJECTIVE
  ============================================================ */

  ["objective", "objective"],
  ["objectives", "objective"],
  ["goal", "objective"],
  ["target_goal", "objective"],
  ["target_objective", "objective"],
  ["strategic_objective", "objective"],
  ["strategy_objective", "objective"],
  ["desired_outcome", "objective"],
  ["intended_outcome", "objective"],
  ["target_outcome", "objective"],
  ["desired_result", "objective"],
  ["intended_result", "objective"],
  ["aim", "objective"],
  ["primary_aim", "objective"],
  ["intent", "objective"],
  ["intended_effect", "objective"],
  ["desired_effect", "objective"],
  ["success_condition", "objective"],
  ["success_criteria", "objective"],
  ["measurable_objective", "objective"],
  ["measurable_goal", "objective"],
  ["behavioral_goal", "objective"],
  ["behavioural_goal", "objective"],
  ["change_goal", "objective"],

  /* ============================================================
     HYPOTHESIS
  ============================================================ */

  ["hypothesis", "hypothesis"],
  ["hypotheses", "hypothesis"],
  ["working_hypothesis", "hypothesis"],
  ["strategic_hypothesis", "hypothesis"],
  ["strategy_hypothesis", "hypothesis"],
  ["causal_hypothesis", "hypothesis"],
  ["behavioral_hypothesis", "hypothesis"],
  ["behavioural_hypothesis", "hypothesis"],
  ["prediction", "hypothesis"],
  ["predicted_effect", "hypothesis"],
  ["predicted_outcome", "hypothesis"],
  ["expected_effect", "hypothesis"],
  ["expected_mechanism", "hypothesis"],
  ["causal_mechanism", "hypothesis"],
  ["mechanism_of_action", "hypothesis"],
  ["working_theory", "hypothesis"],
  ["theory_of_change", "hypothesis"],
  ["causal_reasoning", "hypothesis"],
  ["strategic_reasoning", "hypothesis"],
  ["expected_response", "hypothesis"],
  ["behavior_prediction", "hypothesis"],
  ["behaviour_prediction", "hypothesis"],
  ["if_then", "hypothesis"],
  ["if_then_statement", "hypothesis"],

  /* ============================================================
     TACTIC_PATH
  ============================================================ */

  ["tactic_path", "tactic_path"],
  ["strategy_path", "tactic_path"],
  ["selected_tactic", "tactic_path"],
  ["selected_tactic_path", "tactic_path"],
  ["chosen_tactic", "tactic_path"],
  ["chosen_tactic_path", "tactic_path"],
  ["assigned_tactic", "tactic_path"],
  ["assigned_tactic_path", "tactic_path"],
  ["tactic", "tactic_path"],
  ["tactic_id", "tactic_path"],
  ["tactic_identifier", "tactic_path"],
  ["tactic_name", "tactic_path"],
  ["tactic_ref", "tactic_path"],
  ["tactic_reference", "tactic_path"],
  ["embedded_tactic", "tactic_path"],
  ["embedded_tactic_path", "tactic_path"],
]);

export const CANONICAL_TARGET_KEYS = Object.freeze([
  "id",
  "evidence",
  "why_now",
  "objective",
  "hypothesis",
  "tactic_path",
]);