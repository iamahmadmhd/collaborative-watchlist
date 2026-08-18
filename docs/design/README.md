# Visual design reference

The board lives in a Claude Design project, read via the `DesignSync` tool (method
dispatch, not a separate MCP connection to add):
<https://claude.ai/design/p/ea2f1992-bc6d-4836-b476-2c17256de9c1?file=Repertory+UI+Board.dc.html>

Project id: `ea2f1992-bc6d-4836-b476-2c17256de9c1` (the UUID in the URL above).

**`DesignSync`'s `list_projects` will NOT show this project.** It filters to
`PROJECT_TYPE_DESIGN_SYSTEM` projects only (the type used for component-library
sync). This board is a regular `PROJECT_TYPE_PROJECT`. Skip straight to
`get_project` / `list_files` / `get_file` with the project id above — those work
on any project you can read, regardless of type.

Read with:

- `method: "get_project"`, `projectId: "ea2f1992-bc6d-4836-b476-2c17256de9c1"` — confirms access.
- `method: "list_files"`, same `projectId` — lists every screen file.
- `method: "get_file"`, same `projectId`, `path: "<file>"` — fetches one file (256 KiB cap).

Focus on these files (the whole project is readable):

- `Auth.dc.html` — the sign-up/verify screens.
- `Repertory UI Board.dc.html` — the overview: all nine screens side by side
  (light+dark, desktop+mobile), and the actual token values in its wrapping
  `<div style="...">` (see note below — the variable _names_ here differ from
  System Design §3.2's).

Also read:

- `support.js` — NOT a token source. It's the generated template-rendering
  runtime (`x-dc`/`sc-if`/`sc-for`) these `.dc.html` files depend on to render as
  a preview. Read it only if a `.dc.html` file's templating syntax is unclear.

## Known conflicts with the written docs — do not silently resolve either way

1. **Token variable names differ.** The board defines `--raised`, `--muted`,
   `--ok`, `--danger`, `--m1`..`--m5` — System Design §3.2 documents
   `--surface-raised`, `--text-muted`, and no `--ok`/`--danger`/`--m*` at all.
   The underlying **colour values match exactly** (verified against §3.2's hex
   table). `--m1`..`--m5` is a **fixed 5-colour palette** in the board, not
   §3.4's hash-generated-per-user OKLCH formula — reconcile before treating
   either as final.
2. **The board is stamped "SYSTEM DESIGN v1.0"** in its own header, while
   `docs/SRS.md` / `docs/SYSTEM-DESIGN.md` are v1.1 (ADR-009 removed guest
   discovery in v1.1). The Discovery screen's caption in the board still reads
   "Guest-accessible trending grid" — a v1.0 leftover. Treat the board as
   potentially stale against v1.1 until reconciled, not as silently authoritative.
3. **Auth flow mismatch.** The board's `Auth.dc.html` shows email + handle
   entered together at signup, verified by a 6-digit code — no password
   anywhere, no separate reset flow. `docs/SRS.md` FR-AUTH-1 ("registration
   with an email address and password") and FR-AUTH-6 ("password reset via
   email") describe a password-based flow, and handle claiming is documented
   (System Design §4.2) as a _post-verification_ step via the `claim-handle`
   function, which requires an authenticated caller. These are not reconcilable
   by restyling — flag to the user rather than picking a side.

Design System §3 (tokens, typography, the attribution-stripe mechanism) and the
ADRs in System Design §8 remain authoritative if anything here conflicts with
them — flag the conflict rather than resolving it silently either direction.
