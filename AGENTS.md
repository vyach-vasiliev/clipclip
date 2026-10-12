# ClipClip development

Work in this repository's current checkout unless the user requests another one.
The renderer uses Vue, Pinia and Tailwind CSS v4 through the Vite plugin.
Use native semantic controls and Tailwind utilities; share design tokens in
src/style.css. Keep custom CSS for browser-specific or shared visual details.
Do not reintroduce Vuetify or another component styling framework.

Clipboard collection and writes belong in the Electron main process. The renderer
uses the typed, channel-specific API from shared/clipboard.ts. Do not restore a
generic IPC bridge or log clipboard contents.

Use npm and commit package-lock.json. Before committing implementation changes,
run npm run typecheck, npm test and npm run build:app. For native or preload
changes, also run npm run test:electron. Run npm audit after dependency changes.
Use synthetic data and an isolated profile for Electron tests.

Use Conventional Commits: type(scope): imperative summary. Keep subjects under
72 characters; scopes are optional. Prefer fix for behavior corrections, perf
for measurable performance changes, build for dependency/configuration updates,
ci for workflow changes, and docs for documentation or agent instructions.
Security changes need a short body explaining the boundary being enforced.
Group related, verified changes. Inspect the staged diff and preserve unrelated
user changes. Local commit authorization does not authorize a push.
