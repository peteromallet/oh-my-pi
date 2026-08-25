# Settled-plan wave W1 synthesis — plan digest 7f5f74b6
| # | Src | Finding | Disposition |
|---|---|---|---|
| K1 | CriticKiss P0 | Collapse 4 scenes -> 2 (detect-pick; wire+verify) reusing renderSetupOutro | ACCEPT (~200 lines saved) |
| K2 | CriticKiss P1 | Enter-only happy path is a B2 design constraint; B4 strictly visual | ACCEPT (matches user's sequencing: sense-check first, beauty after) |
| K3 | CriticKiss P2 | Inline models.yml gen into wire scene (single caller, sign-in.ts precedent) | ACCEPT |
| K4 | CriticKiss P3 | Fold scan.ts into scene controller | REJECT-PARTIAL: scan stays a pure-data module (no TUI imports) so bun tests exercise ranking/status without TUI deps; foreign-CLI checks become private helpers within it |
| U1 | CriticUX HIGH | Empty-state when nothing detected: custom inline message bypassing SelectList | ACCEPT -> B2 spec |
| U2 | CriticUX HIGH | Verify spinner via SETUP_TICK_MS frame glyphs | ACCEPT -> B2 spec |
| U3 | CriticUX MED | Ensure wizard-overlay splash phase fires (scenes list wiring) | ACCEPT -> B2 acceptance |
| U4 | CriticUX MED | Copy tone: imperative title + next-step subtitle per providers/model/theme scenes | ACCEPT -> B2 spec + B4 review lens |
| U5 | CriticUX LOW | Scene-specific footer hints (verify scene: no hint, Esc cancels) | ACCEPT -> B2 spec |

Materiality: architecture simplification (K1/K3), UX constraints moved into B2 acceptance (K2,
U1-U5). Plan materially revised -> v2 + confirmation wave W2 required.
