/**
 * The console's typed entry point to the interaction contract.
 *
 * The implementation lives in `plugin/interaction-contract.mjs` because the
 * service ships only `plugin/`, `server/` and `dist/` — a contract under `src/`
 * would be unavailable to the installed runtime, and a second copy in
 * `server/` would be a second definition. This facade gives the TypeScript
 * side the exact same runtime values and the message types.
 */
export * from "../../plugin/interaction-contract.mjs";
