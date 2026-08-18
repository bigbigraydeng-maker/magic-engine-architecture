# Magic Engine 2.0 — Reuse & Platformization Principle

> Date: 2026-08-19  
> Product Owner decision: **Frozen roadmap principle**  
> Applies to: **all Magic Engine development windows, Work Packages, Claude Code/Codex sessions, architecture reviews, and future vertical editions**  
> Base repository fact gate at creation: `main = 6b6bab1222350b689cf45aa62b36f2a3e4b75eb5`

## 1. North-star product direction

Everything we build in Magic Engine should move toward **reuse and platformization**.

Magic Engine is not intended to become a collection of one-off customer systems. Real customers and Customer Zero cases are used to discover, validate, and harden reusable platform capabilities.

After Magic Engine has accumulated sufficient industry understanding, operating data, customer evidence, and proven workflows, we expect to launch deeper vertical editions such as:

- **ME Real Estate**
- **ME Travel**
- future industry editions where justified by evidence

These editions should be **vertical products on one shared Magic Engine platform**, not separate codebases that reimplement the same foundations.

## 2. What should remain shared

The default assumption is that the following belong to the shared platform unless there is strong evidence otherwise:

- **Capabilities** — exact reusable work such as measurement, page optimization, content transformation, verification, attribution, identity resolution, messaging primitives, etc.
- **Adapters / Connectors** — provider integration boundaries such as GitHub, WordPress, Meta, Google, WhatsApp, email, telephony, analytics and other external systems.
- **Kernel / governance infrastructure** — authorization, action identity, policy, idempotency, cost controls, audit and execution lineage.
- **Measurement contracts** — observation identity, raw evidence, comparability and metric truth.
- **Growth contracts / common reasoning shapes** — Evidence → Finding → Prescription → ActionCandidate → VerificationDefinition.
- **Verification / Attribution / Flywheel infrastructure** — how outcomes are measured and related back to actions.
- **Reusable learning mechanisms and generalized memory** — where promotion across clients/industries is safe and semantically valid.

A first customer must never be allowed to silently define shared platform semantics.

## 3. What should vary by industry

Industry-specific knowledge should be separated from shared runtime whenever possible.

Examples include:

- entity interpretation rules
- industry terminology
- signal meaning
- benchmark ranges
- preferred channels and timing
- workflow conventions
- risk and compliance constraints
- scoring weights
- recommended intervention patterns
- industry-specific data sources

These belong in an explicit **Industry Playbook / Profile / Policy / configuration boundary**, not hard-coded inside shared Capability, Adapter, Kernel, or generic Module logic.

Example:

- Roman Hu real-estate semantics such as `Roman Hu`, `Auckland`, `real estate`, `Ray White` are **real-estate/client interpretation policy**, not universal GEO logic.
- Magic Engine company/entity semantics are a different profile.
- The reusable GEO pipeline should consume the appropriate profile rather than embedding the first client's semantics.

## 4. Three scopes of memory / learning

Memory must be reusable without leaking customer-private facts or confusing one industry's semantics with another's.

### Client-private memory

Facts and lessons that belong only to one tenant/client remain isolated.

Examples:

- customer-specific performance
- private conversations
- unpublished commercial facts
- contact preferences
- client-specific operating decisions

These must **never** become cross-client shared memory by default.

### Industry memory

Patterns supported by enough compatible evidence may be promoted into an industry-level knowledge layer.

Examples:

- repeated tourism follow-up patterns
- recurring real-estate GEO query structures
- industry-specific benchmark ranges
- proven channel/timing conventions

Promotion requires sufficient evidence, provenance, tenant-safe aggregation and semantic compatibility.

### Global platform memory

Only genuinely cross-industry lessons should become global Magic Engine learning.

Examples:

- a generic provider failure mode
- a reusable validation rule
- a measurement comparability rule
- a safe execution pattern
- a universally useful optimization mechanism

The rule is:

> **Learn locally first; generalize only after evidence proves the lesson travels.**

## 5. Mandatory reuse test before build

Before creating a new component, every development window must answer:

1. **Does this capability already exist in current `main`?**
2. **Is the apparent missing capability actually an existing capability that is not wired to this customer/use case?**
3. **Is the proposed logic truly universal, or is it first-customer / first-industry semantics hiding inside a generic-looking interface?**
4. **Could ME Real Estate and ME Travel use the same underlying component unchanged?**
5. **If not, can the varying part be moved into Playbook / Profile / Policy / configuration instead of forking runtime code?**

If those questions are not answered, implementation must stop.

## 6. Mandatory development gates

All Current State / reuse decisions follow these gates:

### Gate 1 — Repository Fact Gate

Every Current State Audit must begin with:

`remote fetched at: <timestamp> · exact main SHA: <sha>`

No SHA = audit invalid.

### Gate 2 — Domain Semantics Gate

Before reusing an existing Module / Capability, verify that its **internal semantics** are actually reusable.

A parameterized `clientId` does not make a component generic if internal rules are hard-coded for one client or industry.

### Gate 3 — Product Gate

Confirm the customer/problem being solved and the intended product outcome.

### Gate 4 — Architecture / Reuse Gate

Confirm what is shared platform, what is industry-specific, what is client-specific, and what existing asset is being reused.

### Gate 5 — GO BUILD

No implementation until the Product Owner / Build Control explicitly authorizes the build slice.

## 7. Anti-patterns — prohibited by roadmap direction

Do not:

- create a new Agent because an existing Module is not wired yet
- create a new Capability before checking current `main`
- copy a first customer's hard-coded business semantics into a second customer
- fork a reusable Module into `*-travel`, `*-real-estate`, etc. when policy/configuration would suffice
- put industry rules into Kernel
- put provider-specific logic into Domain Modules
- duplicate Connectors or provider write paths
- treat client-private memory as global learning
- generalize one successful customer outcome into a universal rule without enough evidence
- call something "shared" until its hidden first-client assumptions have been checked

## 8. Vertical-edition roadmap

The long-term model is:

```text
                    Magic Engine Shared Platform

  Kernel · Measurement · Capabilities · Adapters · Attribution
            Shared contracts · reusable learning mechanisms
                           |
             +-------------+-------------+
             |                           |
      ME Real Estate                  ME Travel
   Real Estate Playbook            Travel Playbook
 Entity/market policies          Travel buying signals
 Vertical benchmarks            Travel workflows/timing
 Vertical UI/config             Vertical UI/config
             |                           |
      individual clients            individual clients
```

A vertical edition may provide a deeper industry experience, terminology, defaults, Playbooks, benchmarks, workflows and UI, but it should consume the same shared platform wherever technically and semantically valid.

## 9. Practical acceptance rule

For every meaningful new piece of work, the delivery report should include a short **Reuse Statement**:

- What existing platform asset was reused?
- What new reusable asset was added, if any?
- What remains industry-specific?
- What remains client-specific?
- What was deliberately **not** generalized yet because evidence is insufficient?

The preferred outcome is not "more architecture". The preferred outcome is:

> **fewer shared primitives, used by more real customer loops, with industry knowledge cleanly separated from the platform core.**

This principle is a roadmap-level constraint. Any future implementation that conflicts with it must stop and return to Product Owner / Build Control for an explicit exception decision.