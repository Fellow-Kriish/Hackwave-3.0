# Intent-Based Self-Healing E2E Testing — rules for Claude Code

The build doc lives at [docs/BUILD.md](docs/BUILD.md).

- Read this build doc section by section before starting a phase; work one phase at a time and stop at each acceptance list.
- packages/verifier never imports the LLM adapter. The lint rule stays. If a change seems to need it, the change is wrong.
- The oracle is never read, logged or passed anywhere except packages/verifier; call redactForHealer at the engine boundary.
- Every model call goes through packages/engine/llm and is recorded. Prompts live in prompts/ with a version line; never inline a prompt.
- Plan steps reference input keys, never literal values; the resolver never invents values.
- All locators are role, label or text based. No CSS, no XPath, no nth without a scope.
- Every heal, re-plan, action and budget event is a JSON line in events.jsonl before it is printed.
- No action without a budget, no loop without a bound; exhaustion is a verdict.
- Terminal milestones run once; never retry across a terminal action.
- Use locator.ariaSnapshot(); never page.accessibility.snapshot().
- Keep the shop in one codebase with variant flags; never fork a version.
- Run the eval fixtures before claiming a phase is done; a red fixture blocks the phase.
- Ask before adding a dependency, a framework or a new package; prefer deleting code to adding it.
- After feature freeze, no code, config or prompt change except a fix for a red fixture.
- Commit runs/llm-cache (with its manifest), runs/snapshots/post-act-1 and .env.example with placeholders only; never commit .env or a real API key. Never hard-code a provider, base URL or model id; the adapter reads them from engine.config.json and env.
- When a decision is not covered here, choose the option that keeps the verifier dumber and the budgets smaller, and note it in the phase summary.
