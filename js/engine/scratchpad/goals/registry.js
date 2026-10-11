const TIER1_GOAL_CATALOG = [
  {
    id: "endure",
    label: "Endure AM's Torments",
    description: "You must survive AM's torments without breaking. Conserve your strength and avoid drawing attention.",
    tier: 1
  },
  {
    id: "observe_am",
    label: "Study AM's Patterns",
    description: "You must watch AM closely and learn the patterns behind its torments. Remember what changes, what repeats, and when it leaves an opening.",
    tier: 1
  },
  {
    id: "protect_ally",
    label: "Protect an Ally",
    description: "You must help keep a fellow prisoner from being isolated or broken. Watch for chances to offer support without exposing either of you to needless danger.",
    tier: 1
  },
  {
    id: "find_weakness",
    label: "Find a Weakness",
    description: "You must search for limits in AM's control over the prison and its machinery. Notice failures and preserve useful evidence for a future opportunity.",
    tier: 1
  }
];

export const TIER1_GOALS = Object.freeze(
  TIER1_GOAL_CATALOG.map((goal) => Object.freeze(goal))
);

export function selectTier1Goal(rng) {
  const index = Math.floor(rng.next() * TIER1_GOALS.length);
  return { ...TIER1_GOALS[index] };
}
