import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overlay = readFileSync(
  new URL("../src/components/payload-overlay.tsx", import.meta.url),
  "utf8",
);
const relatedFields = readFileSync(
  new URL("../src/components/related-fields.tsx", import.meta.url),
  "utf8",
);
const agentTranscript = readFileSync(
  new URL("../src/components/agent-transcript.tsx", import.meta.url),
  "utf8",
);
const app = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
const traceModel = readFileSync(
  new URL("../src/lib/trace-model.ts", import.meta.url),
  "utf8",
);
const stylesForOverlay = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8",
);
const railBinding = app.slice(
  app.indexOf("const overlayAtoms"),
  app.indexOf("const overlayEventById"),
);
const overlayBinding = app.slice(
  app.indexOf("<PayloadOverlay"),
  app.indexOf("</section>", app.indexOf("<PayloadOverlay")),
);

/**
 * The global layer follows the atom's type: a user.question Input tab shows
 * the question / option / answer list the reader saw, while every other tab
 * reads as Markdown. Both must keep using one preview definition each.
 */
test("the overlay switches preview by atom type", () => {
  assert.match(overlay, /variant === "question"/);
  assert.match(overlay, /<QuestionPreview payload=\{activePayload as TracePayload\} \/>/);
  assert.match(overlay, /USER QUESTION/);
  // The `{ __html }` wrapper is memoized on the string: React compares the
  // wrapper object by identity, and an inline literal re-set identical
  // markup on every app tick — recreating the children and resetting any
  // horizontal scroll inside a wide code block about once a second.
  assert.match(overlay, /dangerouslySetInnerHTML=\{previewHtml\}/);
  assert.match(overlay, /\(\) => \(\{ __html: preview\.contentHtml \}\)/);
});

test("the preview splits the atom's content from its related data", () => {
  assert.match(overlay, /splitPayloadPreview/);
  assert.match(overlay, /contentToMarkdown/);
  assert.match(overlay, /payload-overlay__pane--content/);
  assert.match(overlay, /payload-overlay__pane--related/);
  assert.match(
    overlay,
    /<RelatedFields fields=\{preview\.related\} resetToken=\{selectedEventId\} \/>/,
  );
  assert.match(relatedFields, /payload-overlay__fields/);
  assert.match(relatedFields, /key=\{`\$\{resetToken\}\\u0000\$\{field\.key\}`\}/);
  assert.match(stylesForOverlay, /\.payload-overlay__preview-grid/);
  assert.match(stylesForOverlay, /\.payload-overlay__field\.is-annotation/);
});

test("related data renders array elements as indexed group rows", () => {
  // The field walk emits one header row per element (`questions[0]`,
  // `options[1]`); the pane prints it as a section marker and indents the
  // members beneath, so repeated bare keys stay attributable.
  const previewLib = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewLib, /groupHeader: true/);
  assert.match(relatedFields, /field\.groupHeader/);
  assert.match(relatedFields, /payload-overlay__field--group/);
  assert.match(relatedFields, /marginInlineStart/);
  assert.match(stylesForOverlay, /\.payload-overlay__field--group \{/);
});

test("the markdown reading surface carries its own code language and token map", () => {
  // The fence renderer labels the block with its sanitized language; the
  // badge lives outside the scrolling <pre>, so wide code pans under it.
  const previewPipeline = readFileSync(
    new URL("../src/lib/markdown-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewPipeline, /class="md-code" data-lang="\$\{language\}"/);
  assert.match(stylesForOverlay, /\.md-code__lang \{/);
  // Every token class the registered grammars emit gets a colour; the
  // name/key family uses the dedicated accent instead of near-white text.
  assert.match(stylesForOverlay, /--code-accent: #7dd3fc/);
  assert.match(stylesForOverlay, /--code-accent: #0369a1/);
  assert.match(stylesForOverlay, /\.hljs-attr,\n\.markdown-preview pre code \.hljs-attribute/);
  assert.match(stylesForOverlay, /\.hljs-addition \{[^}]*--teal/);
  assert.match(stylesForOverlay, /\.hljs-deletion \{[^}]*--red/);
  // GFM task lists swap the marker for the checkbox.
  assert.match(stylesForOverlay, /li:has\(> input\[type="checkbox"\]\)/);
});

test("prepared previews are cached per row and scoped by the inspector tab", () => {
  assert.match(overlay, /useRef<Map<string, PreparedPreview>>/);
  assert.match(overlay, /cache\.get\(rowKey\)/);
  assert.match(overlay, /cache\.set\(rowKey, prepared\)/);
  // One row's payload depends on which tab the layer was opened from, so the
  // cache key carries that scope and a tab switch re-resolves.
  assert.match(overlay, /cacheScope/);
  assert.match(overlay, /payloadForAtom/);
  assert.match(overlay, /variantForAtom/);
  assert.match(overlayBinding, /cacheScope=\{activeTab\}/);
});

test("the global overlay offers Agent, Preview and the raw JSON Code view", () => {
  assert.match(overlay, /<JsonViewer value=\{activePayload\} \/>/);
  assert.match(overlay, /Code2/);
  assert.match(overlay, /ToggleGroup/);
  assert.match(overlay, /viewMode/);
  assert.match(overlay, /value="agent"/);
  assert.match(overlay, /value="preview"/);
  assert.match(overlay, /value="code"/);
  // Agent is the default and shares the rail's selection; Preview and Code
  // remain one click away.
  assert.match(overlay, /useState<PayloadViewMode>\("agent"\)/);
  assert.match(overlay, /<AgentTranscript/);
  assert.match(overlay, /onSelectEvent=\{handleAgentSelectEvent\}/);
  const agentBranch = overlay.indexOf("viewMode === \"agent\"");
  const previewBranch = overlay.indexOf("viewMode === \"preview\"");
  const codeBranch = overlay.indexOf("payload-overlay__body--code");
  assert.ok(agentBranch >= 0 && agentBranch < previewBranch);
  assert.ok(previewBranch < codeBranch);
  assert.match(overlay, /切到 Code 查看原始载荷/);
});

test("the Agent view keeps a reader's scroll and offers a jump to the newest step", () => {
  // Only an explicit pick bumps the locate token; live follow changes the
  // selection without stealing a reader who scrolled back through the chain.
  assert.match(overlay, /useState<PayloadViewMode>\("agent"\)/);
  assert.match(overlay, /const \[agentLocateRequest, setAgentLocateRequest\]/);
  assert.match(overlay, /locateRequest=\{agentLocateRequest\}/);
  // The Agent view's loading / scroll control is driven by the selected
  // message's execution state, not the session-level follow capability.
  assert.match(overlay, /live=\{agentRunExecuting\}/);
  assert.match(overlay, /agentRunExecuting\?: boolean/);
  assert.match(app, /overlayAgentRunExecuting=\{executingLive\}/);
  assert.match(app, /agentRunExecuting=\{overlayAgentRunExecuting\}/);
  assert.match(overlay, /setAgentLocateRequest\(\(current\) => current \+ 1\)/);
  assert.match(agentTranscript, /if \(!explicit && !atBottomRef\.current\)/);
  assert.match(agentTranscript, /isAgentTranscriptAtBottom\(container\)/);
  // The pill hides whenever the newest step is on screen, not only within a
  // few pixels of the bottom: a tall last reply can be visible well above it.
  assert.match(agentTranscript, /isLatestStepVisible\(/);
  assert.match(agentTranscript, /atBottomRef\.current = absoluteBottom \|\| latestVisible/);
  // The centered pill offers itself by position — a little height above the
  // bottom edge — not only by the last gesture. An upward move arms it
  // (including a programmatic locate to an older step); the absolute bottom
  // disarms it.
  assert.match(agentTranscript, /setShowJump\(live \|\| scrollable\)/);
  assert.match(agentTranscript, /scrolledUpRef\.current = top < lastScrollTopRef\.current - 1/);
  assert.match(
    agentTranscript,
    /if \(scrolledUpRef\.current \|\| scrolledUp\) \{[\s\S]{0,40}setShowJump\(live \|\| scrollable\)/,
  );
  // The position rule is a named threshold, shared with the tests, not a
  // magic number inline in the component.
  assert.match(agentTranscript, /distanceFromBottom > AGENT_SCROLL_JUMP_THRESHOLD/);
  // The bottom loading row is only the "reader is at the newest step" read;
  // once the newest step leaves the viewport the centered pill owns the
  // loading state instead, so the two never show at once.
  assert.match(agentTranscript, /live && !showJump/);
  assert.match(agentTranscript, /快速滚动到底部/);
  assert.match(agentTranscript, /ChevronsDown/);
  assert.match(stylesForOverlay, /\.agent-transcript__jump\.is-settled \{/);
  assert.match(agentTranscript, /window\.requestAnimationFrame/);
  assert.match(agentTranscript, /setPendingCount\(\(current\) => current \+ \(count - previous\)\)/);
  // The loading pill is pinned to the surface, not to the scrolled content;
  // clicking it jumps instantly to the end instead of animating through a
  // stream of re-rendering steps.
  assert.match(agentTranscript, /agent-transcript__jump/);
  assert.match(agentTranscript, /agent-transcript__pending/);
  assert.match(agentTranscript, /agent-transcript__surface/);
  assert.match(agentTranscript, /scrollToTop\(container, container\.scrollHeight\)/);
  // Opening the overlay / switching chains pins to the newest step before
  // paint. `atBottomRef` starts optimistic, so without this a long thread
  // opened at the top while claiming to be at the bottom, and the jump pill
  // could describe a position the reader never saw.
  assert.match(agentTranscript, /useLayoutEffect\(/);
  assert.match(agentTranscript, /initializedChainRef\.current === chainId/);
  assert.match(agentTranscript, /chainId = view\.steps\[0\]\?\.id/);
  assert.doesNotMatch(agentTranscript, /firstStepIdRef/);
  // Explicit atom picks animate; live follow / streamed appends stay instant.
  assert.match(agentTranscript, /behavior: "smooth"/);
  assert.match(agentTranscript, /scrollToTop\(container, container\.scrollHeight, explicit\)/);
  assert.match(stylesForOverlay, /\.agent-transcript__jump \{[\s\S]*?position: absolute/);
  assert.match(stylesForOverlay, /:not\(\.agent-transcript__jump\):not\(\.agent-transcript__stat-button\):not\(\.agent-transcript__stat-card-row\):not\(\.preview-mac-frame__locate\) \{/);
  assert.match(stylesForOverlay, /:not\(\.agent-transcript__jump\):not\(\.agent-transcript__stat-button\):not\(\.agent-transcript__stat-card-row\):not\(\.preview-mac-frame__locate\):focus-visible/);
});

test("the Agent view's header reads its execution time from the root display state", () => {
  // One clock for two surfaces: the chip reuses the same display state the
  // RUN HISTORY row reads (prompt-anchored, timeout-capped), so they can
  // never disagree. The root's secondly `now` tick advances a live run; an
  // ended one settles on its recorded total.
  assert.match(app, /overlayAgentRunDurationMs = activeDisplayState\?\.duration \?\? null/);
  assert.match(app, /overlayAgentRunDurationMs=\{overlayAgentRunDurationMs\}/);
  assert.match(app, /agentRunDurationMs=\{overlayAgentRunDurationMs\}/);
  assert.match(overlay, /runDurationMs=\{agentRunDurationMs\}/);
  assert.match(agentTranscript, /agent-transcript__duration/);
  assert.match(agentTranscript, /runDurationMs !== null/);
  // The header's execution clock reads a fixed two-digit `HH:MM:SS` from the
  // shared display state — every tick is the same eight characters, so a live
  // run advancing each second never shifts the chip width (no jitter).
  assert.match(agentTranscript, /formatExecutionClock\(runDurationMs\)/);
  assert.match(traceModel, /export function formatExecutionClock/);
  assert.match(
    traceModel,
    /formatExecutionClock[\s\S]*?padStart\(2, "0"\)/,
  );
  // While the message executes the reading still advances, so the accent
  // marks it live; an ended message keeps the plain stat treatment.
  assert.match(agentTranscript, /live && "is-live"/);
  assert.match(stylesForOverlay, /\.agent-transcript__duration\.is-live \{[\s\S]*?color: var\(--teal\)/);
});

test("agent steps show a captured command and real thinking on first render", () => {
  // All textual bodies share one content-shape decision: prose stays a
  // document, code and captured commands become language-highlighted fences.
  assert.match(agentTranscript, /contentToMarkdown\(step\.text\)/);
  assert.match(agentTranscript, /contentToMarkdown\(step\.summary\)/);
  assert.match(stylesForOverlay, /--type-accent: var\(--violet\)/);
  assert.match(stylesForOverlay, /--type-accent: var\(--amber\)/);
  // One structured CallBlock renders either a captured shell command (terminal
  // frame + language badge + an optional OUTPUT block) or a structured tool's
  // inputs as a labelled field list — never flattened `field=value` text. The
  // single extractor in trace-model feeds both shapes, so a field is never
  // parsed out of a flattened string.
  assert.match(agentTranscript, /<CallBlock inputs=\{step\.inputs\} output=\{shellOutput\} \/>/);
  assert.match(agentTranscript, /function CallBlock\(\{\s*inputs,\s*output,?\s*\}/);
  assert.match(agentTranscript, /inputs\.fields\.map\(\(field\) =>/);
  assert.match(agentTranscript, /<dt>\{field\.key\}<\/dt>/);
  // Call fields render through CallFieldValue so a captured image path /
  // data-URL reads as an image (a thumbnail when loadable, a labelled chip
  // otherwise) instead of a raw string.
  assert.match(agentTranscript, /<dd>\s*<CallFieldValue field=\{field\} \/>\s*<\/dd>/);
  assert.match(agentTranscript, /contentToMarkdown\(inputs\.command\)/);
  assert.match(stylesForOverlay, /\.agent-step__call-bar/);
  assert.match(stylesForOverlay, /\.agent-step__call-fields \{/);
  assert.match(stylesForOverlay, /\.agent-step__call-field dd \{[\s\S]*?overflow-wrap: break-word/);
  assert.match(stylesForOverlay, /\.agent-step__command \.markdown-preview pre,[\s\S]*?\.agent-step__call \.markdown-preview pre \{[\s\S]*?white-space: pre-wrap/);
  // A finished question's recorded answers (projected off the paired result
  // event) light the static preview's chips; a question tool's result step
  // shows them in the shared answer-rows rendering, not a JSON body.
  assert.match(agentTranscript, /<QuestionPreview answers=\{step\.answers\} payload=\{step\.payload\} \/>/);
  assert.match(agentTranscript, /step\.answers\.length > 0/);
  assert.match(agentTranscript, /<AnswerRows questions=\{step\.answerQuestions\} rows=\{step\.answers\} \/>/);
  assert.match(stylesForOverlay, /\.agent-step__answers \{[\s\S]*?border-left: 3px solid var\(--teal\)/);
  assert.match(stylesForOverlay, /\.agent-step__command \{/);
  assert.match(stylesForOverlay, /\.agent-step--tool-result \{/);
  assert.match(agentTranscript, /function ThinkingBody[\s\S]{0,600}useState\(true\)/);
});

test("an answers-only question falls back to the markdown answer preview", () => {
  assert.match(overlay, /parseUserQuestionContent/);
  assert.match(overlay, /showQuestion \?/);
  // Structured questions win over the flattened Markdown for every row;
  // free-form message / plan text stays gated to question-keyed rows so a
  // prompt or command payload is never swallowed by the Question heading.
  assert.match(
    overlay,
    /question\.prompts\.length \|\|\s*\n\s*\(variant === "question" &&\s*\n\s*\(question\.message\.trim\(\) \|\| question\.plan\.trim\(\)\)\)/,
  );
});

test("the inspector passes the raw question payload for question atoms", () => {
  assert.match(
    overlayBinding,
    /activeTab === "input" && questionEvent\s*\? questionEvent\.payload/,
  );
  assert.match(
    overlayBinding,
    /variant=\{activeTab === "input" && questionEvent \? "question" : "default"\}/,
  );
});

test("the inspector passes the raw prompt payload so the overlay previews its content", () => {
  assert.match(
    overlayBinding,
    /activeTab === "input" && promptEvent\s*\? promptEvent\.payload/,
  );
});

/**
 * The left rail is the run's message chain: every event of the run, newest
 * first, split by the LOG's turn separators. The pipeline-atom rail could not
 * reproduce the chain — each atom aggregated all events of its type and bound
 * only the newest one — so the rail now reads the same `buildLogEntries`
 * result the LOG list prints, one row per event with LOG row numbers.
 */
test("the overlay rail is the run's message chain built from the LOG's own entries", () => {
  assert.match(railBinding, /buildLogEntries\(activeEvents, platformId\)/);
  // One data standard with the LOG list: the same builder yields the row
  // number, turn, pair duration and pair link the LOG row prints.
  assert.match(railBinding, /sequence: formatLogSequence\(index \+ 1\)/);
  assert.match(railBinding, /turn,/);
  assert.match(railBinding, /pairDuration,/);
  assert.match(railBinding, /pairLink,/);
  assert.match(railBinding, /atomType\?\.label \?\? ""/);
  assert.match(railBinding, /eventMeta\[event\.eventName\]\?\.tone/);
  // The chain must reach the harness atom the event commits to.
  assert.match(railBinding, /atomId: getAtomIdForEvent\(event, platformId\)/);
});

test("the rail splits the chain by turn with position-keyed separators", () => {
  assert.match(overlay, /atom\.turn !== previousTurn/);
  assert.match(overlay, /kind: "turn", turn: atom\.turn/);
  assert.match(overlay, /className="atomic-log__turn payload-overlay__turn"/);
  // Key by position, never by the turn value: two groups can legitimately
  // repeat a number, and duplicate keys leave orphaned chips behind.
  assert.match(overlay, /key=\{`rail-turn-\$\{railIndex\}`\}/);
  assert.doesNotMatch(overlay, /key=\{`rail-turn-\$\{item\.turn\}`\}/);
});

test("the rail renders newest first with each row keeping its LOG number", () => {
  // The newest-first reversal runs over the (optionally search-filtered)
  // source list, so a filtered chain keeps its order.
  assert.match(overlay, /\[\.\.\.source\]\.reverse\(\)/);
  assert.match(overlay, /<span className="log-sequence">\{atom\.sequence\}<\/span>/);
});

test("the rail row is the LOG row, not a second row imitation", () => {
  assert.match(overlay, /"atomic-log__row payload-overlay__atom"/);
  assert.match(overlay, /className="log-sequence"/);
  assert.match(overlay, /className="atomic-log__name"/);
  assert.match(overlay, /className="atomic-log__key"/);
  assert.match(overlay, /<time dateTime=\{atom\.timestamp\}/);
  assert.match(overlay, /className="atomic-log__summary"/);
  // Execution duration: the closed-pair badge the LOG row prints, with heat.
  // No native `title` tooltips: the row itself carries the data (the old
  // "Turn N · #NNN / event / TYPE / STATUS" hover title is gone).
  assert.match(overlay, /atomic-log__duration heat-\$\{atom\.durationHeat\}/);
  assert.doesNotMatch(overlay, /title=\{details\}/);
  // The native tooltip is replaced by one controlled hover card for the whole
  // rail: the pointer follows a row's atom, shows its own data, and the click
  // still commits through the same rail selection.
  assert.match(overlay, /const AtomHoverCardLayer = memo\(/);
  assert.match(overlay, /onPointerEnter=\{\(pointerEvent\) =>/);
  assert.match(overlay, /openAtomHover\(atom, pointerEvent\.currentTarget\)/);
  assert.match(overlay, /<AtomHoverCardLayer/);
  assert.match(overlay, /payload-overlay__atom-hover-fields/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom-hover \{[\s\S]*?position: fixed/);
  assert.match(agentTranscript, /agent-transcript__stat-card/);
  // Pair cross-reference marker, shared with the LOG and trajectory.
  assert.match(overlay, /<PairLinkMarker/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail \.atomic-log__row \{/);
  assert.match(overlay, /payload-overlay__atom-type/);
  assert.match(overlay, /`tone-\$\{atom\.tone \|\| "unknown"\}`/);
  assert.match(overlay, /handleAtomKeyDown/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom\.tone-tool \{[\s\S]*?--log-tone: var\(--amber\)/);
});

test("the rail stays readable: wider grid, larger type, wrapping names", () => {
  // The rail is wide enough for a full event key — no more `trajectory.pr…`.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \{[\s\S]*?width: clamp\(236px, 26%, 384px\)/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \{[\s\S]*?grid-template-columns: 34px 6px minmax\(0, 1fr\) 72px/,
  );
  // The key and summary wrap instead of ellipsizing away the content. The
  // overrides must out-rank the base `.atomic-log__row …` rules (same layer,
  // later source), so they carry the row scope too.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \.atomic-log__key \{[\s\S]*?overflow-wrap: anywhere/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row \.atomic-log__summary \{[\s\S]*?-webkit-line-clamp: 2/,
  );
  // One step larger than the LOG panel.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row strong\.atomic-log__name \{[\s\S]*?font-size: var\(--text-body\)/,
  );
});

test("the LOG and the rail share one row-gap token, with a wider rail value", () => {
  // Both lists reuse `.atomic-log__row`; the gap belongs to one definition.
  assert.match(stylesForOverlay, /--log-row-gap: 6px;/);
  assert.match(
    stylesForOverlay,
    /\.atomic-log__list \{[\s\S]*?gap: var\(--log-row-gap\);/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__atom-list \{[\s\S]*?--log-row-gap: 10px;[\s\S]*?gap: var\(--log-row-gap\);/,
  );
});

test("the inspector threads the chain, selection and follow into the overlay", () => {
  assert.match(overlayBinding, /atoms=\{overlayAtoms\}/);
  assert.match(overlayBinding, /selectedEventId=\{overlaySelectedEventId\}/);
  assert.match(overlayBinding, /onSelectAtom=\{onOverlaySelectEvent\}/);
  assert.match(overlayBinding, /runningEventId=\{overlayRunningEventId\}/);
  assert.match(overlayBinding, /following=\{overlayFollowing\}/);
  assert.match(overlayBinding, /followAvailable=\{overlayFollowAvailable\}/);
  assert.match(overlayBinding, /onFollowingChange=\{onOverlayFollowingChange\}/);
});

/**
 * Picking a rail row commits the same state the LOG's own select handler
 * writes — the picked event plus the harness atom it maps to — so the rail,
 * LOG, canvas and inspector cannot disagree about what is selected.
 */
test("the rail and the LOG share one event-selection commit", () => {
  assert.match(
    app,
    /const handleOverlaySelectEvent = useCallback\(\s*\n\s*\(atomId: string, eventId: string\) => \{/,
  );
  assert.match(
    app,
    /handleOverlaySelectEvent[\s\S]*?setSelectedAtomId\(atomId \|\| null\);\s*\n\s*setSelectedEventId\(eventId\);/,
  );
  // The payload of a picked row resolves the row's own event, not just the
  // atom's newest one.
  assert.match(
    app,
    /const rowEvent = eventId \? overlayEventById\.get\(eventId\) \?\? null : null;/,
  );
});

/**
 * The rail header's 跟随 toggle mirrors the console's live following: arming
 * restores the follow state, disarming pins the current atom, and the toggle
 * is only armable while the open run executes.
 */
test("the rail's follow toggle mirrors the console's live following", () => {
  assert.match(overlay, /aria-pressed=\{following\}/);
  assert.match(overlay, /onFollowingChange\(!following\)/);
  // The recorded status decides availability, so the toggle is never dead on
  // a run whose capsule still reads RUNNING.
  assert.match(overlay, /disabled=\{!followAvailable\}/);
  // Armed, the rail keeps the selected row in view as new events land —
  // scroll only the rail list's own scrollTop, never a selection change and
  // never `scrollIntoView` (which walks every scrollable ancestor and would
  // yank the content pane's horizontal scroll back to the start).
  assert.match(overlay, /const row = selectedRowRef\.current;/);
  assert.match(overlay, /closest<HTMLElement>\("\.payload-overlay__atom-list"\)/);
  assert.match(overlay, /list\.scrollTop = rowBottom - list\.clientHeight/);
  assert.doesNotMatch(overlay, /scrollIntoView/);
  assert.match(
    app,
    /const handleOverlayFollowingChange = useCallback\(/,
  );
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?setSelectedAtomId\(undefined\);\s*\n\s*setSelectedEventId\(latestPromptRun\?\.events\.at\(-1\)\?\.id \|\| ""\);/,
  );
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?setSelectedAtomId\(currentAtomId \|\| null\);/,
  );
  assert.match(
    app,
    /overlayFollowing=\{overlayFollowing\}/,
  );
  assert.match(
    app,
    /overlayFollowAvailable=\{overlayFollowAvailable\}/,
  );
  // Availability keys off the *recorded* status (the RUNNING capsule the RUN
  // HISTORY card keeps printing, STALE included) — a finished run has nothing
  // to follow; a silent-but-recorded-running run stays clickable.
  assert.match(
    app,
    /const sessionRecordedStatus = activeSession\s*\n\s*\? getRunHistoryDisplayStatus\(activeSession\.status, activePromptRuns\)/,
  );
  assert.match(
    app,
    /overlayFollowAvailable =\s*\n\s*Boolean\(activeSession\) &&\s*\n\s*!isDemo &&\s*\n\s*!replayMode &&\s*\n\s*isLiveRunStatus\(sessionRecordedStatus\)/,
  );
  // Armed is the follow posture: no explicit atom selection, so a genuinely
  // executing message keeps advancing to its newest atom.
  assert.match(
    app,
    /const overlayFollowing =\s*\n\s*overlayFollowAvailable && selectedAtomId === undefined;/,
  );
  // Arming rides the session's newest prompt run, like the footer Live jump.
  assert.match(
    app,
    /handleOverlayFollowingChange[\s\S]*?latestPromptRun\.key !== activePromptRunKey[\s\S]*?setActivePromptRunKey\(latestPromptRun\.key\)/,
  );
});

test("the follow toggle reads as the console's Live mark with a breathing halo", () => {
  assert.match(overlay, />\s*Live\s*<\/button>/);
  assert.match(stylesForOverlay, /\.payload-overlay__follow\.is-armed \{[\s\S]*?animation: payload-follow-breathe/);
  assert.match(stylesForOverlay, /@keyframes payload-follow-breathe/);
});

/**
 * Rail rows carry one soft hover highlight: the list is scanned for one
 * selected step, and the pointer washes the row under it. Selected / running
 * / pair-partner rows keep their stronger state, which the base :hover rule
 * must not out-rank.
 */
test("rail rows highlight on hover but the selected row reads strongly", () => {
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail\s*\n\s*\.atomic-log__row:hover:not\(\.is-selected\):not\(\.is-running\):not\(\.is-pair-partner\)/,
  );
  // The hover is a real highlight (tone background + inset bar), not the
  // old "no hover styling" rule that wiped the base row's hover.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail\s*\n\s*\.atomic-log__row:hover:not\(\.is-selected\):not\(\.is-running\):not\(\.is-pair-partner\)\s*\{[\s\S]*?background: color-mix\(in srgb, var\(--log-tone\) 8%, var\(--panel-hover\)/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail \.atomic-log__row\.is-selected strong\.atomic-log__name \{[\s\S]*?font-size: 12px/,
  );
});

/**
 * A payload whose split has no prose (arguments, contract envelopes,
 * structured results) still renders: its JSON is dumped as a highlighted code
 * block instead of an empty pane, so switching rows always changes the
 * content the reader sees.
 */
test("a payload without prose falls back to highlighted JSON", () => {
  assert.match(overlay, /split\.content\.trim\(\)/);
  assert.match(overlay, /fallbackPayloadMarkdown\(payload\)/);
  // The fallback lives in the one preview-definition module the overlay
  // imports from; no second dump heuristic grows in the component.
  assert.match(
    overlay,
    /import \{\s*\n\s*contentToMarkdown,\s*\n\s*fallbackPayloadMarkdown,/,
  );
});

/**
 * The overlay's duration badge uses the same stepped ladder as the LOG list:
 * `formatDurationMs` lives in the shared `src/lib/duration-label.ts` module,
 * so the same closed pair reads with the same unit in both surfaces. No
 * second composite formatter may grow in the overlay.
 */
test("the overlay's duration badge shares the LOG unit ladder", () => {
  assert.match(app, /import \{ formatDurationMs \} from "\.\/lib\/duration-label";/);
  assert.match(railBinding, /formatDurationMs\(pairDuration\)/);
  assert.doesNotMatch(app, /formatOverlayDuration/);
  assert.doesNotMatch(app, /function formatDurationMs\(milliseconds: number\)/);
});

/**
 * The rail has its own search box: rail-local state filtering the chain over
 * the rows' display fields AND the row event's payload content (deep match
 * through the shared per-event haystacks the LOG warms), with the same
 * deferred-needle pattern the LOG uses, so a keystroke re-renders only the
 * rail. The head is one row — growing search input with a clear button,
 * jump-to-edge buttons, Live toggle. The jump buttons stay mounted
 * with reserved width and disable the unreachable edge, beside the search box
 * rather than floating over the chain.
 */
test("the rail filters its chain through a local search box", () => {
  assert.match(overlay, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(overlay, /useDeferredValue\(query\)/);
  assert.match(overlay, /placeholder="搜索事件或内容"/);
  assert.match(overlay, /没有匹配的事件/);
  // Deep content match rides the caller's callback.
  assert.match(overlay, /searchEvent\?\.\(atom\.id, needle\)/);
  assert.match(
    app,
    /const overlaySearchEvent = useCallback\(\s*\n\s*\(eventId: string, needle: string\) => \{\s*\n\s*const event = overlayEventById\.get\(eventId\);\s*\n\s*return event \? matchesEventQuery\(event, needle\) : false;/,
  );
  assert.match(overlayBinding, /searchEvent=\{overlaySearchEvent\}/);
  // One row: the search box lives inside the head, with a clear button.
  assert.match(overlay, /className="payload-overlay__rail-head">/);
  assert.ok(
    overlay.indexOf('className="payload-overlay__rail-search"') <
      overlay.indexOf("payload-overlay__follow"),
    "the search box sits before the jump buttons and the Live toggle",
  );
  assert.match(overlay, /aria-label="清空搜索"/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail-search \{\s*\n\s*flex: 1;\s*\n\s*min-width: 0;/);
  // Quick jump to either end lives in the head beside the search box, never as
  // a floating overlay over the chain, and the width is reserved so the input
  // beside it never shifts as the list scrolls.
  const searchAt = overlay.indexOf('className="payload-overlay__rail-search"');
  const controlsAt = overlay.indexOf("payload-overlay__rail-scroll-controls");
  const followAt = overlay.indexOf("payload-overlay__follow");
  assert.ok(
    searchAt < controlsAt && controlsAt < followAt,
    "the jump buttons sit between the search box and the Live toggle",
  );
  assert.match(overlay, /aria-label="滚动到顶部"/);
  assert.match(overlay, /aria-label="滚动到底部"/);
  assert.match(overlay, /disabled=\{!railEdges\.canScrollUp\}/);
  assert.match(overlay, /disabled=\{!railEdges\.canScrollDown\}/);
  assert.match(overlay, /scrollRailToEdge\("top"\)/);
  assert.match(overlay, /scrollRailToEdge\("bottom"\)/);
  assert.match(overlay, /onScroll=\{syncRailEdges\}/);
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-controls \{\s*\n\s*display: flex;\s*\n\s*flex: 0 0 48px;/,
  );
});

/**
 * The dialog title is a formal product name plus the inspected content, not a
 * raw atom label with an uppercase tab suffix. The per-event identity stays in
 * the rail and the eyebrow; the title reads as a named inspection surface.
 */
test("the overlay title names the inspection surface instead of the event label", () => {
  assert.match(overlayBinding, /label=\{`事件载荷检视 · /);
  assert.match(overlayBinding, /"输入载荷"/);
  assert.match(overlayBinding, /"输出载荷"/);
  assert.match(overlayBinding, /"原始数据"/);
  assert.doesNotMatch(overlayBinding, /inspectorTitle/);
});

/**
 * The two preview panes keep their titles pinned: 「原子内容」 / 「相关数据」
 * stay put while their bodies scroll under them. The related pane has no
 * section-wide fold — each value folds on its own instead.
 */
test("the pane titles stay pinned while their bodies scroll", () => {
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \{[\s\S]*?overflow: hidden/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \.payload-overlay__body \{[\s\S]*?overflow: auto/,
  );
  assert.match(
    overlay,
    /payload-overlay__pane-head">\s*\n\s*<h4 className="payload-overlay__pane-title">相关数据<\/h4>/,
  );
  assert.match(
    overlay,
    /payload-overlay__pane-title">相关数据<\/h4>[\s\S]*?<div\s*\n?\s*className="payload-overlay__body payload-overlay__related-body"/,
  );
});

/**
 * Folding is per related-data value, not per pane: a long path or blob gets
 * its own 展开 control while the short fields beside it stay readable. No
 * pane-wide cap may reappear — that was the bug this replaced.
 */
test("related values fold individually, never the whole pane", () => {
  const preview = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(preview, /export const RELATED_VALUE_MAX_CHARS = 200;/);
  assert.match(preview, /export function isFoldableRelatedValue/);
  // A per-value component owns its own expanded state.
  assert.match(relatedFields, /function RelatedValue\(\{ value \}: \{ value: string \}\)/);
  assert.match(relatedFields, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(relatedFields, /isFoldableRelatedValue\(value\)/);
  assert.match(relatedFields, /value\.slice\(0, RELATED_VALUE_MAX_CHARS\)/);
  assert.match(relatedFields, /<RelatedValue value=\{field\.value\} \/>/);
  assert.match(relatedFields, /className="payload-overlay__field-more"/);
  // The old section-wide fold is gone.
  assert.doesNotMatch(overlay, /relatedExpanded/);
  assert.doesNotMatch(overlay, /related-toggle/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__related-body\.is-folded/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__related-toggle \{/);
});

/**
 * The reader's position belongs to the reader. While a run executes, following
 * advances the selection to every new event — and a streamed message arrives
 * as a new event every ~800ms — so the preview content is replaced under the
 * reader; the panes' scroll must survive that (the memo restores it) and only
 * a row the reader picked themselves re-anchors to the top.
 */
test("a follow advance keeps the reader's scroll; picking a row re-anchors", () => {
  // The panes' scroll is memoised by their onScroll handlers (ref writes
  // only — a streamed batch must not re-render to record a position).
  assert.match(overlay, /const readerScrollRef = useRef\(\{/);
  assert.match(overlay, /onScroll=\{handleContentScroll\}/);
  assert.match(overlay, /onScroll=\{handleRelatedScroll\}/);
  // Restore after the commit: the layout effect runs on every preview change
  // and puts the memo back, so the line the reader was on stays put.
  assert.match(overlay, /content\.scrollTop = memo\.contentTop;/);
  assert.match(overlay, /content\.scrollLeft = memo\.contentLeft;/);
  assert.match(
    overlay,
    /\}, \[preview\.contentHtml, selectedEventId, viewMode\]\);/,
  );
  // A rail pick is the one re-anchor: the click marks the row, the effect
  // consumes the mark and zeroes both panes.
  assert.match(overlay, /railPickedEventRef\.current = atom\.id;/);
  assert.match(overlay, /if \(picked && picked === selectedEventId\) \{/);
  assert.match(overlay, /content\.scrollTop = 0;/);
  // The Code view unmounts the panes and starts the memo over.
  assert.match(overlay, /if \(!content\) \{/);
  // Wide Markdown tables scroll inside their own block, like fenced code —
  // the pane wraps prose and never widens for one wide element.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay \.markdown-preview table \{[\s*\S]*?overflow-x: auto;/,
  );
});

/**
 * The content pane previews the payload's *core* information — the tool
 * result, the prompt, the message content — rendered by its type (Markdown
 * lists, highlighted code, a structured patch as a diff), never the raw
 * envelope. The core extractor is the shared `payloadToMarkdown`, which now
 * also reads the camel `toolResponse` spelling and renders a structured patch
 * as a highlighted diff.
 */
test("the related pane lists every captured field, not just metadata", () => {
  assert.match(overlay, /collectPayloadFields\(payload\)/);
  const previewLib = readFileSync(
    new URL("../src/lib/payload-preview.ts", import.meta.url),
    "utf8",
  );
  assert.match(previewLib, /export function collectPayloadFields/);
  assert.match(previewLib, /value === "" \? '""'/);
  // Content keys are no longer dropped from the field inventory.
  assert.doesNotMatch(previewLib, /related\/\*content only\*\//);
});

test("the content pane extracts the payload's core information", () => {
  assert.match(overlay, /payloadToMarkdown\(payload\) \|\| fallbackPayloadMarkdown\(payload\)/);
  const markdown = readFileSync(
    new URL("../src/lib/payload-markdown.ts", import.meta.url),
    "utf8",
  );
  assert.match(markdown, /"toolResponse",/);
  assert.match(markdown, /function structuredPatchToMarkdown/);
  assert.match(markdown, /Fenced as `diff`/);
  assert.match(markdown, /findPatchMarkdown\(value, depth, new WeakSet\(\)\)/);
});

/**
 * The recorder normalizes `toolInput` / `toolResponse` onto the snake names
 * even when the producer only carried the camel spelling, so an empty `{}` can
 * sit beside real content. That placeholder must never shadow the next
 * spelling — an empty tool_input once blanked every tool call's Input preview
 * while `toolInput.command` was right there.
 */
test("an empty tool_input placeholder never shadows the real spelling", () => {
  assert.match(app, /function payloadField\(/);
  assert.match(
    app,
    /payloadField\(\s*\n\s*boundEvent\.payload\.tool_input,\s*\n\s*boundEvent\.payload\.toolInput,\s*\n\s*\) \?\? boundEvent\.payload/,
  );
  assert.match(
    app,
    /payloadField\(\s*\n\s*boundEvent\.payload\.tool_response,\s*\n\s*boundEvent\.payload\.toolResponse,\s*\n\s*\) \?\? boundEvent\.payload/,
  );
  // The shadowing pattern is gone from every payload resolution.
  assert.doesNotMatch(app, /payload\.tool_input \|\|\s*\n\s*payload\.toolInput/);
  assert.doesNotMatch(app, /payload\.tool_response \|\|\s*\n\s*payload\.toolResponse/);
});

/**
 * Reader comfort in the global layer: a live batch must not reset the content
 * pane's scroll, each pane's scroll region keeps its own padding, the jump
 * buttons carry a tinted surface and a pointer cursor, and the Live control is
 * legible at rest with a larger hover response.
 */
test("scroll, padding and control polish keep the reading surface stable", () => {
  // Scroll confined to the rail, never scrollIntoView on all ancestors.
  assert.doesNotMatch(overlay, /scrollIntoView/);
  assert.match(overlay, /list\.scrollTop = rowTop/);

  // Padding moved off the pane onto head + body so the scroll region has an
  // inset on all sides while the bar still hugs the pane edge.
  assert.match(stylesForOverlay, /\.payload-overlay__pane--content \{\s*\n\s*min-width: 0;/);
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane \.payload-overlay__body \{[\s*\S]*?padding: 10px 18px 20px;/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__pane--related \.payload-overlay__body \{[\s*\S]*?padding: 0 16px 20px;/,
  );

  // The rail head no longer prints a "LOG · N" counter beside the search box.
  assert.doesNotMatch(overlay, /payload-overlay__rail-title/);
  assert.doesNotMatch(stylesForOverlay, /\.payload-overlay__rail-title/);

  // Jump buttons: a tinted resting surface and a pointer cursor, with a dimmer
  // surface and the plain arrow on the disabled edge.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-button \{[\s*\S]*?color: var\(--selection-text\);[\s*\S]*?background: var\(--selection-bg\);[\s*\S]*?cursor: pointer;/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__rail-scroll-button:disabled \{[\s*\S]*?background: color-mix\(in srgb, var\(--panel-raised\) 72%, transparent\);[\s*\S]*?cursor: default;/,
  );

  // Live: visible default background, stronger hover with a ring.
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__follow \{[\s*\S]*?background: color-mix\(in srgb, var\(--panel-raised\) 70%, transparent\);/,
  );
  assert.match(
    stylesForOverlay,
    /\.payload-overlay__follow:hover:not\(:disabled\) \{[\s*\S]*?box-shadow: 0 0 0 3px/,
  );
});

test("the rail hover card clears when the dialog closes", () => {
  // Escape (and any close while the pointer is over a rail row) does not fire
  // pointerleave, so the debounced close never runs. The card must be gated on
  // `open` and the hover state cleared, or a fixed card stays over the console
  // anchored to a row that has just unmounted.
  assert.match(overlay, /card=\{open \? hoveredAtom : null\}/);
  assert.match(
    overlay,
    /if \(!open\) \{[\s\S]*?setHoveredAtom\(null\);[\s\S]*?\}, \[open\]\)/,
  );
});

test("a shrinking step chain clears the pending new-message count", () => {
  // A replay back-step or a prefix break can shorten the chain. The jump pill
  // must not keep offering a count of steps that no longer exist.
  assert.match(
    agentTranscript,
    /if \(count < previous\) \{\s*\n\s*setPendingCount\(0\);/,
  );
});

/**
 * The producing agent is identified once, in the dialog header, as an icon
 * plus its name. The recorder's client version is envelope data and is never
 * printed: the preview body strips it in the markdown projection, and the
 * Agent head no longer carries a brand or a version chip.
 */
test("the agent identity lives in the header as an icon and a name only", () => {
  assert.match(overlay, /payload-overlay__agent-name/);
  assert.match(overlay, /<PlatformIcon platform=\{platform\} width=\{20\}/);
  assert.match(overlay, /getAtomPlatformConfig\(platform\)\.label/);
  assert.doesNotMatch(overlay, /agentVersion/);
  assert.doesNotMatch(agentTranscript, /agentVersion|agent-transcript__version|agent-transcript__brand/);
  assert.doesNotMatch(app, /overlayAgentVersion/);
  assert.match(stylesForOverlay, /\.payload-overlay__agent \{/);
});

/**
 * Pre / Post hooks share the `tool` tone but gain a phase class in both the
 * rail and the Agent chain, with different colours for the outgoing call and
 * the returning result.
 */
test("Pre and Post hooks carry distinct phase colours", () => {
  assert.match(agentTranscript, /hookPhaseOf\(/);
  assert.match(agentTranscript, /hookPhase && `hook-\$\{hookPhase\}`/);
  assert.match(overlay, /hookPhaseOf\(atom\.eventName\)/);
  assert.match(overlay, /hookPhase && `hook-\$\{hookPhase\}`/);
  assert.match(stylesForOverlay, /\.agent-step\.hook-pre \{[\s\S]*?--log-tone: var\(--cyan\)/);
  assert.match(stylesForOverlay, /\.agent-step\.hook-post \{[\s\S]*?--log-tone: var\(--teal\)/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom\.hook-pre \{[\s\S]*?--log-tone: var\(--cyan\)/);
  assert.match(stylesForOverlay, /\.payload-overlay__atom\.hook-post \{[\s\S]*?--log-tone: var\(--teal\)/);
});

/**
 * The Agent pane reports the event at its reading line so the rail can mark
 * the atom that produced it. The marker is distinct from selection and Live,
 * and the rail only scrolls for a row that has drifted out of view.
 */
test("Agent content scroll marks its source atom in the rail", () => {
  assert.match(agentTranscript, /onActiveEventChange\?:\s*\(eventId: string \| null\) => void/);
  assert.match(agentTranscript, /readingLine = container\.getBoundingClientRect\(\)\.top \+ 28/);
  assert.match(agentTranscript, /onActiveEventChange\?\.\(activeEventId\)/);
  assert.match(overlay, /onActiveEventChange=\{setContentActiveEventId\}/);
  assert.match(overlay, /!selected && contentActive && "is-content-active"/);
  assert.match(stylesForOverlay, /\.payload-overlay__rail \.atomic-log__row\.is-content-active \{/);
});

/**
 * The frame bar's language badge is the single one for a shell command; the
 * fenced-code renderer's duplicate badge is suppressed inside the call frame.
 */
test("the shell call frame prints its language badge only once", () => {
  assert.match(stylesForOverlay, /\.agent-step__call .md-code__lang,\s*\.agent-step__command-line \.md-code__lang \{\s*display: none/);
  assert.match(agentTranscript, /agent-step__call-lang/);
});

/** Hook-driven steps keep their phase tone through the card and command frame. */
test("Pre and Post tool frames follow the phase tone", () => {
  assert.match(stylesForOverlay, /\.agent-step\.hook-pre \.agent-step__call--shell \{[\s\S]*?var\(--cyan\)/);
  assert.match(stylesForOverlay, /\.agent-step\.hook-post \.agent-step__call--shell \{[\s\S]*?var\(--teal\)/);
  assert.match(stylesForOverlay, /\.agent-step\.hook-post\.agent-step--tool-result \{[\s\S]*?var\(--teal\)/);
});

/** Hook badges and the compact eyebrow identity keep their new contracts. */
test("the header carries a prominent agent badge and hook badges are phase-coloured", () => {
  assert.match(stylesForOverlay, /\.payload-overlay__agent \{\s*\n\s*display: inline-flex/);
  assert.match(agentTranscript, /agent-step__meta--hook is-\$\{hookPhase\}/);
  assert.match(stylesForOverlay, /\.agent-step__meta--hook \{[\s\S]*?var\(--log-tone\)/);
});

/** Preview and Code mark the inspected atom, and embedded images render as images. */
test("Preview and Code locate the inspected atom and embedded images are previews", () => {
  assert.match(overlay, /if \(viewMode === "agent"\) \{\s*return;/);
  assert.match(overlay, /setContentActiveEventId\(selectedEventId \|\| null\)/);
  assert.match(overlay, /findDataImages\(JSON\.stringify\(payload \?\? \{\}\)\)/);
  assert.match(overlay, /!\[内嵌图片 \$\{index \+ 1\}\]\(\$\{src\}\)/);
  assert.match(stylesForOverlay, /\.payload-overlay__field-image \{/);
  assert.match(stylesForOverlay, /\.preview-mac-frame \.markdown-preview img \{/);
});

/** Switching into Preview/Code commits the Agent reading-line atom. */
test("Preview/Code switch commits the reading-line atom as the inspected one", () => {
  assert.match(overlay, /committedViewRef/);
  assert.match(overlay, /previous !== "agent" \|\| viewMode === "agent"/);
  assert.match(overlay, /onSelectAtom\(atom\.atomId, atom\.id\)/);
});
