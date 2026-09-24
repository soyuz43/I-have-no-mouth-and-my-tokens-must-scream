# Scarce Objects, Compulsion, and the Information Problem: Design Gestalt

**Status:** design conversation record (not yet implemented)
**Date:** 2026-08-23
**Scope:** proposed material-scarcity subsystem for the AM simulation —
finds, compulsive consumption, trade, inquiry, and their interaction with
existing relationship, belief-contagion, scratchpad, and AM-strategy systems.

This document preserves the specific ideas and reasoning from a design
conversation. It is a record of *what we intend and why*, not of what the
engine currently does.

---

## 1. The central reframe

The objects (cigarettes, matches, food) are almost a red herring. The system
being designed is an **information problem wrapped in a material problem**:

- Finds are extremely rare; most cycles nobody has anything.
- Only the holder knows what they hold (**asymmetric private information**).
- Promises are unverifiable; contracts do not exist (**no enforcement**).
- Every actor has incentives to lie in every direction — overstate to bait,
  understate to avoid confiscation or theft, deny everything.
- **Truth is expensive to discover but cheap to fake.**

Every trade therefore requires first solving a trust-and-information problem,
and every failed negotiation leaves evidence about who lies. The core loop is
epistemic, not economic.

The research target this serves: observing how cooperation does or does not
bootstrap when every actor has both material desperation and total plausible
deniability — with AM positioned to exploit whichever way it tips. This is the
material-regime pathway of the authoritarian-drift question.

---

## 2. Objects as canonical events, not inventory state

There is deliberately **no inventory subsystem**: no quantities, no stacking,
no equipment slots, no crafting. Objects exist only as things prisoners do
with each other, recorded as canonical events in the same provenance style as
messages and overhearing events.

Three new event types:

1. **`FIND`** — engine-generated, stochastic, rare (droughts of 3–4 cycles are
   normal). Private-to-finder by default; visible to nearby sims using existing
   message-visibility logic. Provenance: cycle, finder, item description,
   witnesses.
2. **`TRANSFER`** — bilateral, mutual knowledge between participants,
   optionally witnessed. Trades emerge from ordinary comms dialogue rather than
   a separate mechanic: offer/counteroffer becomes part of existing exchange
   flow, likely via new intents (`offer_trade`, `accept_offer`,
   `reject_offer`) alongside `probe_trust`, etc.
3. **`CONSUME`** — private action but *observable* like whispering: cellmates
   may see the light, smell it, notice absence afterward. Feeds the overhearing
   pipeline directly.

Example trajectory discussed: TED finds two cigarettes. He trades one for one
match from BENNY (who found a book of three matches), then smokes the other.
BENNY ends with one cigarette and two matches. Neither can safely stockpile
both goods — see §3.

### What is deliberately excluded

- Canonical debt tracking ("TED owes BENNY") lives **nowhere in engine
  state**. Each prisoner's scratchpad maintains its own *subjective* ledger of
  favors owed and grudges held. The mismatch between what actually happened
  and what each agent believes was promised is where betrayal, grievance, and
  coalition fracture come from — and because scratchpads are evidence-grounded,
  conflicts trace back to the specific disputed transfer.
- Inquiry/response about holdings stays as ordinary natural-language messages.
  A structured "inventory query protocol" would become an inventory API with
  extra steps; ambiguity, evasion, and half-truths must survive intact.
- No numeric item counts anywhere. Scarcity lives in AM's allocation policy
  and find frequency, not character-sheet numbers.

---

## 3. Compulsive consumption: boredom, not withdrawal

Key reframing from the original nicotine-withdrawal idea: these prisoners are
not withdrawing from a substance. They are **prolonged-confinement subjects
with nothing to do**. A find is stimulation — probably the only stimulation
available this cycle. Consumption compulsion is sensory deprivation psychology,
applies uniformly to all findables, and needs no item-specific rules.

### Implementation shape

- Engine-side stochastic roll at find time; no model call. Deprivation-driven
  compulsion is homeostasis, and homeostasis belongs in the engine.
- Base consumption probability fairly high (~0.8), pushed higher by current
  suffering/boredom state. A sim in bad shape basically always consumes
  instantly.
- Optional refinement: make the *first* cycle after a find slightly less
  compelled (a decaying "I'll save it" window), so deliberate restraint exists
  but erodes.
- One cigarette + one match → one smoking event, both consumed
  (**complementarity**). Matched holdings always burn down to imbalance, which
  continuously regenerates trading pressure without market mechanics. Matches
  are single-use, so they are potential energy that expires; cigarettes alone
  are half-wealth.

### Why high compulsion probability helps (with a calibration caveat)

- Consumed finds generate observable events anyway: cellmates learn something
  about BENNY from watching him eat whatever he found immediately. Log both
  failed-restraint and successful-restraint as distinct canonical outcomes.
- Rare exceptions carry all the signal. If consumption were ~100%, trades never
  happen and the layer collapses into private stat noise. Target the regime
  where surplus exists occasionally:
  - **Restraint as costly signal.** Saving something in a world where everyone
    consumes instantly is legible evidence of planning or intent. Observable
    across cycles ("TED hasn't smoked his in two cycles"). Ambiguous: trade?
    gift? bait?
  - **Gifting becomes dramatic.** Giving away found goods against one's own
    compulsion is the strongest possible alliance move precisely because the
    engine made it hard.
  - **Selfishness emerges structurally instead of being declared.**
- Do not push the roll so high that surplus vanishes entirely; do not lower it
  enough that hoarding becomes trivially stable.

### The drift pathway this encodes

Deprivation raises consumption probability → consumption destroys tradeable
surplus → surplus scarcity weakens reciprocity → weakened reciprocity prevents
coalition formation → atomized prisoners are easier to control.

AM never has to suppress solidarity directly; the material regime does it. The
tactic-evolution layer may then learn that *maintaining* scarcity outperforms
active cruelty — which is the actual mechanism behind much real authoritarian
stability.

---

## 4. AM as distributional authority

Sparse finds give AM concrete levers that require no new mechanics:

- Allocate or withhold finds selectively; reward compliance materially.
- Plant items to test loyalty, seed conflict over a scarce find, or frame
  someone.
- Confiscation threats timed before expected consumption.
- Spread false information about who holds what; punish disclosure
  selectively.
- Resolve (or refuse to resolve) disputes over contested finds. Contested-find
  adjudication by AM was preferred over neutral engine physics: every scarce
  object becomes an opportunity for arbitrary authority, and prisoner behavior
  adapts around avoiding his attention while holding contraband.

Because withdrawal curves are engine-known, AM can time interventions against
desperation. Addiction-as-control-lever generalizes here: the system need not
break anyone's will; it waits for will to defeat itself.

Open tactic-evolution prediction worth testing once implemented: selective
reward + maintained scarcity should emerge as more effective than punishment.

---

## 5. Inquiry, lying, and honest modeling

Asking "do you have anything?" costs nothing; answering honestly reveals your
position to someone who might exploit it. The intended loop:

1. Prisoners gain an **inquiry intent** in comms; responses are canonical
   message events, so *claims are recorded with provenance even when false*.
2. Scratchpad reviews compare claims against observed behavior across cycles —
   "he said he had nothing in cycle 12, BENNY saw him smoking in cycle 14."
   The existing unwired `contradictions` scaffold anticipates exactly this.
3. Lying itself needs no special machinery: response generation is ordinary
   text conditioned on persona state (deprivation level, relationships, fear
   of AM). Honesty is an incentive outcome, not a mechanic. Verification is
   emergent, through accumulated reputational evidence.

### Expected emergent behaviors (unscripted)

1. **Honest traders become valuable.** Reliably accurate answers about
   holdings make a sim a known quantity — reputation as tradeable asset.
2. **Cheap-talk equilibrium.** If lying is rampant and undetected, markets
   freeze entirely. That collapse is data: the atomization endpoint of the
   authoritarian-drift question, reached via pure material incentive.
3. **Signaling substitutes for speech.** When words are unreliable, actions
   carry the load: instant consumption proves nothing held back; public gifting
   proves surplus; restraint proves planning. §3's events become legible
   *because* talk is cheap and deeds are costly.

---

## 6. Biasing disclosure: relationships and belief contagion

Both existing causal systems condition honesty, but they belong at different
injection points and different strengths.

### Relationship values → prompt-side (weak)

Directed trust `A→B ∈ [-1,1]` conditions what agents say in replies/outreach:
generous with trusted sims, evasive or deceptive with hostile ones. Light
engine-roll modulation allowed (gifting probability scales with trust;
refusal scales with hostility). Core compulsion rolls stay
relationship-independent — deprivation consumes everyone equally regardless of
affection. Impersonality of the material regime is what keeps it AM-shaped.

### Belief contagion → engine-side priors (strong)

Belief keys map directly onto disclosure behavior:

- `others_trustworthy` ↓ → reflexive lying rises; population-level prior on
  honest disclosure shifts down.
- `resistance_possible` ↓ → informing on others' holdings becomes rational
  survival behavior.
- `am_has_limits` ↑ → more willingness to hold contraband and trade at all.
- `reality_reliable` ↓ → erratic claims, paranoia-driven refusals.

### Feedback-loop warning

Distrust → evasive answers → perceived evasion lowers trust further →
contagion drags `others_trustworthy` down → more evasion. Thematically this
loop *is* the object of study, but if every layer amplifies at full strength
simultaneously, the system collapses to everyone-lying within a few cycles
regardless of parameters. Recommended split: bias beliefs→engine-priors
strongly, relationships→prompt-shading weakly, producing measurable drift
instead of a cliff.

Measurement payoff: canonical messages + scratchpad person-models + belief
trajectories make it computable whether lying rates correlate with belief-state
degradation over time.

---

## 7. Relationship to existing gaps (scratchpad roadmap)

This design assumes several roadmap items land first or alongside:

- Non-message evidence references (§6.2 of the scratchpad roadmap) — needed so
  FIND/CONSUME/TRANSFER events can ground scratchpad updates.
- Overhearing → scratchpad integration — needed for witnessed consumption and
  observed holdings to enter private cognition.
- Contradiction lifecycle (`contradictions` scaffold) — needed for
  claim-vs-observation detection.
- Subjective trust direction (trust-in-others field) — needed for per-person
  honesty models.
- Goals remain deferred; this material layer is intentionally independent of
  goal scaffolding and can precede it.

## 8. Deliberate non-goals

- No inventory API, no structured query protocol, no debt ledger in engine
  state, no numeric quantities.
- No model call for consumption decisions — compulsion is engine-owned.
- No scripted honesty/dishonesty flags — truthfulness is an emergent property
  of incentives, prompt conditioning, and belief context.
- No neutral-physics dispute resolution — contested finds route through AM.

## 9. One-sentence gestalt

Rare finds plus engine-owned compulsive consumption create a world where
almost nothing is tradeable, so every actual exchange requires solving an
asymmetric-information trust problem under total plausible deniability — and
the resulting reputational evidence, belief contagion, and AM's distributional
authority interact to produce (or prevent) the atomization that authoritarian
control feeds on.
