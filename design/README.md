# ReliefOps visual direction

## References researched and captured

These public-page screenshots are research references, not product assets or copied layouts.

- [Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh) — hierarchy, restrained sidebars, consistent interface layers. Screenshot: [linear.png](references/linear.png).
- [Vercel's dashboard navigation](https://vercel.com/changelog/dashboard-navigation-redesign-rollout) — neutral surfaces, workflow navigation, clear content boundaries. Screenshot: [vercel.png](references/vercel.png).
- [Ramp procurement](https://ramp.com/procurement) — purchasing information hierarchy and financial readability. Screenshot: [ramp.png](references/ramp.png).

## Implementation

- White-based light theme and near-black dark theme, using semantic CSS variables rather than color inversion.
- Self-hosted Geist variable font and Lucide icons; no external font request.
- Indigo is reserved for identity, selection, and the primary planning action.
- Persistent theme preference, with the operating-system preference used initially.
- Consistent themed forms, dialogs, tables, auth, saved workspaces, and mobile views.
- Product calculations, authentication, storage, and funding rules are unchanged by this redesign.

## Generated brand asset

The logo was generated with the built-in image generation tool, then copied into the project at `frontend/public/brand/reliefops-mark.png`. It is used in the wordmark, sign-in flow illustration, and favicon. The original generated file was preserved.

Final generation prompt:

> Use case: logo-brand. Create a premium original standalone brand symbol for ReliefOps, a sophisticated SaaS for accountable relief procurement. Asset: square transparent PNG logo mark, NO WORDS or lettering. Design a distinctive compact symbol combining an abstract forward-moving route with an open protective rounded diamond / linked supply modules. Four crisp interlocking geometric segments around a small negative-space diamond, subtle directional energy, balanced strong silhouette, legible at 24px. Flat vector-like precision, single vivid periwinkle-indigo color #7569F6 with slight two-tone violet differentiation only if needed. No gradients, no shadows, no mockup, no background, no leaf, no hands, no heart, no generic medical cross, no photorealism, no existing brand logo. Centered mark occupies about 75 percent of canvas. Polished enterprise SaaS identity equally clear on white and near-black.

The sign-in illustration is an original diagram built in HTML/CSS/SVG to explain the planning inputs, not a fabricated product screenshot. Reference screenshots are not shipped as UI content.
