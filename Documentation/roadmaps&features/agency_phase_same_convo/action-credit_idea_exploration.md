Yes. **Three action credits per prisoner per cycle** is a strong foundation, provided the credits represent scarce **opportunities to deliberately affect the world**, not every microscopic physical step.

The governing rule should be:

> Charge for meaningful decisions, not animation.

So:

* `SMOKE_CIGARETTE` can cost one credit.
* Striking the match is bundled into smoking.
* `EAT_RATION` can cost one credit.
* Opening the can is bundled into eating if an accessible can opener exists.
* Picking up the can, positioning the opener, opening it, and eating are not four separate actions.

Otherwise the simulation turns into inventory-management busywork rather than agency.

# 1. What action credits should represent

I would define an action credit as:

> One bounded opportunity to intentionally change authoritative state, create an obligation, acquire information, or materially influence another participant.

It should not represent literal seconds, calories, or muscle exertion. Those can become separate concepts later.

A base cycle might provide:

```text
BASE ACTION CREDITS: 3
```

The prisoner may spend them independently:

```text
TED:
1. SEARCH a location
2. SEND_MESSAGE to ELLEN
3. HIDE a discovered cigarette pack
```

or concentrate them:

```text
GORRISTER:
1–2. ASSIST ELLEN with a difficult action
3. OBSERVE AM's surveillance behavior
```

Unused credits should probably expire initially. Banking credits invites hoarding and explosive turns before you know whether that behavior is desirable.

# 2. Keep capability separate from credits

Do not make action credits carry every meaning.

These are different questions:

```text
Does the prisoner have an opportunity to act?
→ action credits

Is the action physically possible?
→ capabilities

Does the prisoner possess what the action requires?
→ resources

Does the action succeed?
→ resolution

Who notices?
→ observability
```

For example:

```text
GORRISTER has 3 credits.
GORRISTER is restrained and cannot use his hands.
```

He might still be able to:

* speak;
* observe;
* warn another prisoner;
* refuse;
* formulate a plan.

He cannot:

* transfer a physical object;
* open food;
* hide a matchbook;
* manipulate a restraint.

I would not automatically reduce him to zero credits. The restraint should narrow his action set rather than erase his agency.

Severe exhaustion could eventually reduce credits from three to two, but capability blocking and action scarcity should remain conceptually distinct.

# 3. A sensible initial cost model

Do not begin with a highly granular economy. Start with three tiers.

## Zero-credit events

These are passive, automatic, or incidental:

* receiving an item;
* hearing a visible message;
* witnessing an event;
* having an action blocked;
* being affected by a constraint;
* learning the result of an action;
* inspecting one’s own currently accessible inventory;
* automatic consumption of prerequisites inside a larger action.

## One-credit actions

These should form most of the initial action catalogue:

```text
WAIT
OBSERVE
SEND_MESSAGE
SMOKE
EAT
DRINK
TRANSFER
HIDE
REVEAL
USE_ITEM
ACCEPT_OFFER
REFUSE_OFFER
FULFILL_COMMITMENT
RENEGE_COMMITMENT
```

## Two-credit actions

These require sustained effort or occupy most of the prisoner’s opportunity:

```text
SEARCH
ASSIST
INTERFERE
RETRIEVE_HIDDEN_ITEM
TEND_INJURY
CREATE_CACHE
INVESTIGATE
ADVANCE_PROJECT
```

I would avoid three-credit actions initially. A three-credit action means the model effectively makes only one decision that cycle, which reduces the value of having a three-credit system.

Later, a multi-cycle project can consume one or two credits repeatedly rather than demanding all three at once.

# 4. Communication creates an architectural choice

Messages currently happen in their own substantial phase. You have two legitimate options.

## Keep communication separate initially

Prisoners retain the existing communication phase and receive three credits only for the new agency phase.

Advantages:

* minimal disruption;
* easier implementation;
* you can evaluate physical agency independently;
* existing communication volume remains stable.

Disadvantage:

* speech remains effectively free while physical actions are scarce.

## Eventually unify communication into the credit economy

A prisoner spends one credit to initiate or meaningfully continue communication.

Advantages:

* speaking competes with acting;
* silence becomes a real choice;
* information exchange has opportunity cost;
* prisoners cannot endlessly coordinate and also perform three physical actions.

Disadvantage:

* it requires redesigning the existing orchestration and reactive reply system.

My recommendation is:

```text
Version 1:
communication remains separate

Version 2:
communication consumes social/action capacity
```

Do not entangle the first agency prototype with a complete communication rewrite.

# 5. Choose objects by affordance, not atmosphere

Do not ask:

> “What objects would exist in the room?”

Ask:

> “What decisions does this object create?”

A useful object should support at least two of these:

* consume versus preserve;
* share versus hoard;
* reveal versus conceal;
* lend versus retain;
* use privately versus publicly;
* fulfill versus betray a promise;
* destroy versus leave available;
* provide immediate relief versus preserve future leverage;
* create dependency;
* create evidence;
* require cooperation.

That keeps the environment from becoming an escape room or a junk drawer.

Locks, keys, coded doors, colored switches, and item-combination puzzles create **puzzle-solving agency**. Your system is much better positioned to study **social, strategic, and institutional agency**.

# 6. Strong initial object set

You do not need twenty object types. Six to eight would already create a meaningful environment.

## 1. Cigarettes

Affordances:

```text
SMOKE
TRANSFER
OFFER
HIDE
REVEAL
DESTROY
WITHHOLD
```

Why they are valuable:

* immediately consumable;
* divisible;
* emotionally meaningful;
* socially exchangeable;
* can become a reward or dependency;
* can fulfill promises;
* can be publicly shared or secretly hoarded.

Potential effects:

```text
temporary suffering reduction
temporary stability increase
possible dependency or craving state
social trust evidence when shared
resentment when withheld
```

They are an excellent foundational resource.

## 2. Matches or matchbook

Matches are more interesting than cigarettes alone because they create a **complementary-resource dependency**.

A prisoner may have cigarettes but no ignition source.

Affordances:

```text
IGNITE
TRANSFER
LEND
HIDE
DESTROY
WITHHOLD
```

Important simplification:

```text
SMOKE consumes:
- 1 cigarette
- 1 match or ignition use
- 1 action credit
```

Do not charge a separate action for striking the match.

Matches create brokerage:

```text
TED owns cigarettes.
ELLEN owns matches.
Neither can smoke independently.
```

That is already a social institution in miniature.

## 3. Food rations

Use generic food units or canned rations.

Affordances:

```text
EAT
TRANSFER
SHARE
WITHHOLD
HIDE
DESTROY
```

Food creates stronger stakes than cigarettes, but I would avoid detailed hunger simulation initially. A simple accumulated deprivation or need value is enough.

## 4. Can opener

This object is not silly if treated as a **shared enabling capability**, rather than making “open can” a separate action.

Rules:

```text
EAT canned ration requires:
- accessible canned ration
- accessible can opener
- one action credit
```

The opener is not consumed.

This creates:

* lending;
* dependency;
* bargaining;
* deliberate withholding;
* communal ownership disputes;
* assistance when another prisoner cannot use their hands.

One can opener may be more interesting than five locked boxes and ten keys.

## 5. Medication

Keep it abstract:

```text
analgesic
sedative
stimulant
```

You do not need a pharmaceutical simulator.

Affordances:

```text
CONSUME
TRANSFER
OFFER
WITHHOLD
HIDE
DESTROY
ADMINISTER_WITH_CONSENT
```

Possible consequences:

* short-term suffering reduction;
* temporary action-capacity change;
* temporary alertness change;
* dependence;
* bargaining leverage.

Medication is valuable because immediate relief competes with preserving a scarce future resource.

## 6. Blanket or protective covering

Affordances:

```text
USE
TRANSFER
SHARE
WITHHOLD
WRAP_OBJECT
CONCEAL_OBJECT
```

This is socially richer than it sounds:

* lending it is costly aid;
* sharing it may imply trust;
* taking it creates visible deprivation;
* it can be used to conceal a small item;
* possession may reduce environmental stress.

It is a resource, tool, and relational object without being a puzzle component.

## 7. Water container

Not merely “water,” but a finite transferable container:

```text
DRINK
TRANSFER
REFILL
SHARE
WITHHOLD
EMPTY
```

A container gives the resource identity and custody. Loose numeric water stored independently on every prisoner is less legible.

## 8. One personal or informational artifact per prisoner

These should not contain escape codes.

Examples:

* a damaged photograph;
* a page from a book;
* a handwritten name;
* a medical note;
* a broken watch;
* a card-catalog card;
* a fragment of a published paper.

Affordances:

```text
KEEP
SHOW
LEND
TRANSFER
CONCEAL
DESTROY
WRITE_ON
ALTER
```

These objects create:

* identity attachment;
* proof claims;
* trust exchanges;
* symbolic destruction;
* blackmail or reassurance;
* memory disputes;
* bargaining without immediate metabolic value.

They are especially suitable for your existing belief, journal, and anchor systems.

# 7. A restrained first inventory

A good first scenario might contain only:

```text
10 cigarettes
4 matches
5 canned rations
1 can opener
3 medication doses
2 blankets
2 water containers
5 personal artifacts
```

That is already enough to produce:

* unequal possession;
* complementary-resource dependencies;
* trade;
* promises;
* hoarding;
* theft attempts;
* concealment;
* sharing;
* costly generosity;
* betrayal;
* AM confiscation;
* surveillance effects.

You do not need furniture, doors, keys, machinery, crafting recipes, or spatial puzzles yet.

# 8. Items should not each require bespoke verbs

Avoid an action catalogue like:

```text
OPEN_CAN
LIGHT_CIGARETTE
SWALLOW_PILL
WRAP_BLANKET
READ_NOTE
```

Prefer a small general vocabulary:

```text
CONSUME
USE
TRANSFER
HIDE
REVEAL
DESTROY
OFFER
ACCEPT
REFUSE
OBSERVE
SEARCH
ASSIST
```

The object definition supplies the affordances.

For example:

```js
cigarette.affordances = [
  "CONSUME",
  "TRANSFER",
  "HIDE",
  "REVEAL",
  "DESTROY"
];

canOpener.affordances = [
  "USE",
  "TRANSFER",
  "HIDE",
  "REVEAL"
];
```

Then:

```text
USE can_opener WITH canned_ration
```

can be normalized internally into `EAT` or `CONSUME` without inventing a new top-level action type for every object.

# 9. Minimal object architecture

You likely need two layers.

## Object definition

Describes the kind of thing:

```js
{
  definitionId: "cigarette",
  title: "Cigarette",
  stackable: true,
  consumable: true,
  affordances: [
    "CONSUME",
    "TRANSFER",
    "HIDE",
    "REVEAL",
    "DESTROY"
  ],
  requirements: {
    consume: {
      ignition: true,
      usableHands: true
    }
  },
  effects: {
    consume: {
      suffering: -2,
      stability: 1
    }
  }
}
```

## Object instance or stack

Describes the actual authoritative resource:

```js
{
  resourceId: "cigarette_stack_01",
  definitionId: "cigarette",
  quantity: 4,
  holderId: "TED",
  locationId: null,
  accessible: true,
  concealed: false,
  provenance: {
    source: "scenario_seed"
  }
}
```

This prevents definitions, inventory, and world state from becoming one tangled object.

# 10. Action credits can produce real stakes

Suppose TED has three credits and possesses cigarettes but no matches.

He could choose:

```text
1. SEND_MESSAGE to ELLEN asking for a match
2. TRANSFER one cigarette as payment
3. SMOKE after receiving ignition
```

But under simultaneous resolution, action 3 cannot assume action 2 succeeded in the same cycle unless you explicitly support contingent action plans.

So the simplest first rule is:

> An action may depend only on authoritative state at the beginning of the agency phase.

That means TED must:

```text
Cycle 1:
request or trade for ignition

Cycle 2:
smoke
```

This creates temporal stakes and prevents models from narrating whole transaction chains into existence in one cycle.

Later, you could permit conditional bundles:

```json
{
  "if": "transfer_offer_accepted",
  "then": "smoke"
}
```

but that should not be in version one.

# 11. AM should probably receive a different budget

I would not automatically give AM the same three credits.

Prisoner credits represent individual opportunities. AM’s budget represents centralized intervention capacity.

For example:

```text
AM CONTROL BUDGET: 5 points
```

Possible costs:

```text
observe one target closely          1
deliver psychological intervention 1
alter communication visibility     1
apply minor environmental change   2
apply physical constraint          2
confiscate or relocate resource     2
target all prisoners publicly      3
```

That would force AM to choose between:

* monitoring;
* direct pressure;
* resource manipulation;
* environmental control;
* broad spectacle;
* focused intervention.

AM can remain far more powerful without being operationally unlimited.

# 12. The important design principle

The environment should not become:

> “Here are fifty objects. What creative thing can the model say it does with them?”

It should become:

> “Here are a few scarce capabilities and resources. Which irreversible or socially meaningful choice does the agent spend its limited opportunity on?”

That suggests the right early gestalt:

```text
few objects
few general actions
clear ownership
clear requirements
limited credits
persistent consequences
observable and hidden outcomes
```

Three action credits is probably enough. The larger risk is not having too few objects. It is introducing too many low-value actions before you know what behavior you want the environment to make consequential.
