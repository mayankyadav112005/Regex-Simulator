/* ══════════════════════════════════════════════════════════════
   Regex Simulator – Core Logic + Regex → NFA + Visualization
   ══════════════════════════════════════════════════════════════ */

// ── DOM References ──────────────────────────────────────────────
const regexInput       = document.getElementById('regex-input');
const mainRegexDisplay = document.getElementById('main-regex-display');
const mainRegexValue   = document.getElementById('main-regex-value');
const btnClear         = document.getElementById('btn-clear');
const btnGenerate      = document.getElementById('btn-generate');
const btnConvertFA     = document.getElementById('btn-convert-fa');
const outputPlaceholder= document.getElementById('output-placeholder');
const stringList       = document.getElementById('string-list');
const stringCount      = document.getElementById('string-count');
const testInput        = document.getElementById('test-input');
const btnTestString    = document.getElementById('btn-test-string');
const testResultDiv    = document.getElementById('test-result');
const testResultBadge  = document.getElementById('test-result-badge');
const testResultDetail = document.getElementById('test-result-detail');
const regex1Input      = document.getElementById('regex1-input');
const regex2Input      = document.getElementById('regex2-input');
const btnEquiv         = document.getElementById('btn-equiv');
const equivResult      = document.getElementById('equiv-result');
const resultBadge      = document.getElementById('result-badge');
const resultDetail     = document.getElementById('result-detail');
const toastContainer   = document.getElementById('toast-container');

// FA elements
const faPlaceholder    = document.getElementById('fa-placeholder');
const faTableWrap      = document.getElementById('fa-table-wrap');
const faTableHead      = document.getElementById('fa-table-head');
const faTableBody      = document.getElementById('fa-table-body');
const faGraphContainer = document.getElementById('fa-graph-container');
const faCanvas         = document.getElementById('fa-canvas');
const faTypeBadge      = document.getElementById('fa-type-badge');

// ── Constants ───────────────────────────────────────────────────
const MAX_STRING_LENGTH = 5;

// ── Current NFA (for test string) ───────────────────────────────
let currentNFA = null;

/* ════════════════════════════════════════════════════════════════
   1. PALETTE – Insert symbol at cursor
   ════════════════════════════════════════════════════════════════ */
document.getElementById('regex-palette').addEventListener('click', (e) => {
    const btn = e.target.closest('.palette-btn');
    if (!btn) return;
    const symbol = btn.dataset.symbol;
    insertAtCursor(regexInput, symbol);
    pulseButton(btn);
    updateMainRegexDisplay();
});

/**
 * Insert text into an input element at the current cursor position.
 */
function insertAtCursor(input, text) {
    input.focus();
    const start = input.selectionStart;
    const end   = input.selectionEnd;
    const value = input.value;
    input.value = value.slice(0, start) + text + value.slice(end);
    const newPos = start + text.length;
    input.setSelectionRange(newPos, newPos);
    // Remove error state if present
    input.classList.remove('input-error');
}

/** Tiny visual pulse feedback */
function pulseButton(btn) {
    btn.style.transform = 'scale(0.88)';
    setTimeout(() => { btn.style.transform = ''; }, 120);
}

/** Update the main regex display panel */
function updateMainRegexDisplay() {
    const val = regexInput.value.trim();
    if (val) {
        mainRegexValue.textContent = val;
        mainRegexDisplay.classList.add('active');
    } else {
        mainRegexValue.textContent = '—';
        mainRegexDisplay.classList.remove('active');
    }
}

regexInput.addEventListener('input', () => {
    regexInput.classList.remove('input-error');
    updateMainRegexDisplay();
});

/* ════════════════════════════════════════════════════════════════
   2. CLEAR INPUT
   ════════════════════════════════════════════════════════════════ */
btnClear.addEventListener('click', () => {
    regexInput.value = '';
    regexInput.classList.remove('input-error');
    regexInput.focus();
    updateMainRegexDisplay();
    showToast('Input cleared', 'info');
});

/* ════════════════════════════════════════════════════════════════
   3. REGEX PARSER  (supports: a b 0 1 ε + | . * ( ) )
   ────────────────────────────────────────────────────────────────
   Grammar (precedence low→high):
     Expr   → Term (('+' | '|') Term)*
     Term   → Factor Factor*          (implicit concatenation)
     Factor → Atom '*'*
     Atom   → CHAR | '(' Expr ')'
   ────────────────────────────────────────────────────────────────
   We build a tiny AST and then enumerate all strings up to a
   given maximum length.
   ════════════════════════════════════════════════════════════════ */

// AST node types
const CHAR   = 'CHAR';
const EMPTY  = 'EMPTY';   // ε
const UNION  = 'UNION';
const CONCAT = 'CONCAT';
const STAR   = 'STAR';

/** Tokenise a regex string into an array of tokens. */
function tokenise(raw) {
    const tokens = [];
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (' \t'.includes(ch)) continue; // skip whitespace
        tokens.push(ch);
    }
    return tokens;
}

/** Recursive-descent parser. Returns an AST root node. */
function parse(regex) {
    const tokens = tokenise(regex);
    let pos = 0;

    function peek()    { return pos < tokens.length ? tokens[pos] : null; }
    function advance() { return tokens[pos++]; }

    function parseExpr() {
        let node = parseTerm();
        while (peek() === '+' || peek() === '|') {
            advance(); // consume '+' or '|'
            const right = parseTerm();
            node = { type: UNION, left: node, right };
        }
        return node;
    }

    function parseTerm() {
        let node = parseFactor();
        // Implicit concatenation: if next token is a char, '(' or something
        // that can start an Atom, we concatenate.
        while (peek() !== null && peek() !== ')' && peek() !== '+' && peek() !== '|') {
            const right = parseFactor();
            node = { type: CONCAT, left: node, right };
        }
        return node;
    }

    function parseFactor() {
        let node = parseAtom();
        while (peek() === '*') {
            advance();
            node = { type: STAR, child: node };
        }
        return node;
    }

    function parseAtom() {
        const tok = peek();
        if (tok === null) throw new Error('Unexpected end of expression');
        if (tok === ')') throw new Error('Unexpected closing parenthesis');
        if (tok === '*') throw new Error('Unexpected * without preceding expression');
        if (tok === '+' || tok === '|') throw new Error(`Unexpected operator "${tok}"`);

        if (tok === '(') {
            advance(); // consume '('
            const node = parseExpr();
            if (peek() !== ')') throw new Error('Missing closing parenthesis');
            advance(); // consume ')'
            return node;
        }

        // Concatenation dot is just ignored as a token – it's implicit
        if (tok === '.') {
            advance();
            // Treat '.' as explicit concat – just parse next factor
            return parseFactor();
        }

        // Otherwise it's a character literal
        advance();
        return { type: CHAR, value: tok };
    }

    const ast = parseExpr();
    if (pos < tokens.length) {
        throw new Error(`Unexpected token "${tokens[pos]}" at position ${pos + 1}`);
    }
    return ast;
}

/* ════════════════════════════════════════════════════════════════
   4. STRING GENERATION from AST (BFS / set-based, bounded length)
   ════════════════════════════════════════════════════════════════ */

/**
 * Generate all strings accepted by the regex AST up to `maxLen`.
 * Returns a sorted array of unique strings.
 */
function generateStrings(ast, maxLen) {
    // Returns a Set of strings
    function gen(node, limit) {
        if (!node) return new Set(['']);

        switch (node.type) {
            case CHAR:
                return new Set([node.value]);

            case EMPTY:
                return new Set(['']);

            case UNION: {
                const left  = gen(node.left, limit);
                const right = gen(node.right, limit);
                const merged = new Set(left);
                for (const s of right) merged.add(s);
                return merged;
            }

            case CONCAT: {
                const left  = gen(node.left, limit);
                const right = gen(node.right, limit);
                const result = new Set();
                for (const l of left) {
                    if (l.length > limit) continue;
                    for (const r of right) {
                        const combined = l + r;
                        if (combined.length <= limit) result.add(combined);
                    }
                }
                return result;
            }

            case STAR: {
                // Kleene star: ε + L + LL + LLL + ...
                const base = gen(node.child, limit);
                const result = new Set(['']); // ε always included
                let prev = new Set(['']);

                for (let i = 0; i < limit; i++) {
                    const next = new Set();
                    for (const p of prev) {
                        if (p.length > limit) continue;
                        for (const b of base) {
                            const combined = p + b;
                            if (combined.length <= limit) {
                                next.add(combined);
                            }
                        }
                    }
                    if (next.size === 0) break;
                    let anyNew = false;
                    for (const s of next) {
                        if (!result.has(s)) {
                            anyNew = true;
                            result.add(s);
                        }
                    }
                    if (!anyNew) break;
                    prev = next;
                }
                return result;
            }

            default:
                return new Set();
        }
    }

    const strings = gen(ast, maxLen);
    return [...strings].sort((a, b) => a.length - b.length || a.localeCompare(b));
}

/* ════════════════════════════════════════════════════════════════
   5. GENERATE STRINGS – Button handler
   ════════════════════════════════════════════════════════════════ */
btnGenerate.addEventListener('click', () => {
    const raw = regexInput.value.trim();
    if (!raw) {
        regexInput.classList.add('input-error');
        showToast('Please enter a regular expression.', 'error');
        return;
    }

    try {
        const ast = parse(raw);
        const strings = generateStrings(ast, MAX_STRING_LENGTH);
        renderStrings(strings);
        showToast(`Generated ${strings.length} string(s)`, 'success');
    } catch (err) {
        regexInput.classList.add('input-error');
        showToast(`Invalid regex: ${err.message}`, 'error');
        renderStrings(null, err.message);
    }
});

// Remove error highlight on input
regex1Input.addEventListener('input', () => regex1Input.classList.remove('input-error'));
regex2Input.addEventListener('input', () => regex2Input.classList.remove('input-error'));

/**
 * Render the list of generated strings into the output box.
 */
function renderStrings(strings, errorMsg) {
    stringList.innerHTML = '';

    if (errorMsg) {
        outputPlaceholder.classList.remove('hidden');
        outputPlaceholder.textContent = `⚠ ${errorMsg}`;
        outputPlaceholder.style.color = 'var(--danger)';
        stringCount.textContent = '0';
        return;
    }

    if (!strings || strings.length === 0) {
        outputPlaceholder.classList.remove('hidden');
        outputPlaceholder.textContent = 'No strings generated (empty language).';
        outputPlaceholder.style.color = '';
        stringCount.textContent = '0';
        return;
    }

    outputPlaceholder.classList.add('hidden');
    outputPlaceholder.style.color = '';
    stringCount.textContent = strings.length;

    strings.forEach((str, i) => {
        const li = document.createElement('li');
        const idx = document.createElement('span');
        idx.className = 'index';
        idx.textContent = `#${i + 1}`;
        const val = document.createElement('span');
        if (str === '') {
            val.className = 'value epsilon';
            val.textContent = 'ε (empty string)';
        } else {
            val.className = 'value';
            val.textContent = str;
        }
        li.appendChild(idx);
        li.appendChild(val);
        stringList.appendChild(li);
    });
}

/* ════════════════════════════════════════════════════════════════
   6. THOMPSON'S CONSTRUCTION – Regex AST → NFA
   ════════════════════════════════════════════════════════════════ */

let nfaStateCounter = 0;

function newState() {
    return nfaStateCounter++;
}

/**
 * Build an NFA from an AST using Thompson's construction.
 * Returns { start, accept, transitions }
 * transitions: Map<stateId, [{symbol, to}]>
 */
function buildNFA(ast) {
    nfaStateCounter = 0;
    const nfa = buildNFAFromNode(ast);
    
    // Collect all states
    const allStates = new Set();
    for (let i = 0; i < nfaStateCounter; i++) allStates.add(i);

    // Collect alphabet (exclude ε)
    const alphabet = new Set();
    for (const [, trans] of nfa.transitions) {
        for (const t of trans) {
            if (t.symbol !== 'ε') alphabet.add(t.symbol);
        }
    }

    return {
        states: [...allStates],
        alphabet: [...alphabet].sort(),
        start: nfa.start,
        accept: nfa.accept,
        transitions: nfa.transitions
    };
}

function buildNFAFromNode(node) {
    if (!node) {
        // Empty – just ε transition
        const s = newState();
        const a = newState();
        const transitions = new Map();
        addTransition(transitions, s, 'ε', a);
        return { start: s, accept: a, transitions };
    }

    switch (node.type) {
        case CHAR: {
            const s = newState();
            const a = newState();
            const transitions = new Map();
            addTransition(transitions, s, node.value, a);
            return { start: s, accept: a, transitions };
        }

        case EMPTY: {
            const s = newState();
            const a = newState();
            const transitions = new Map();
            addTransition(transitions, s, 'ε', a);
            return { start: s, accept: a, transitions };
        }

        case UNION: {
            const nfa1 = buildNFAFromNode(node.left);
            const nfa2 = buildNFAFromNode(node.right);
            const s = newState();
            const a = newState();
            const transitions = mergeTransitions(nfa1.transitions, nfa2.transitions);
            addTransition(transitions, s, 'ε', nfa1.start);
            addTransition(transitions, s, 'ε', nfa2.start);
            addTransition(transitions, nfa1.accept, 'ε', a);
            addTransition(transitions, nfa2.accept, 'ε', a);
            return { start: s, accept: a, transitions };
        }

        case CONCAT: {
            const nfa1 = buildNFAFromNode(node.left);
            const nfa2 = buildNFAFromNode(node.right);
            const transitions = mergeTransitions(nfa1.transitions, nfa2.transitions);
            addTransition(transitions, nfa1.accept, 'ε', nfa2.start);
            return { start: nfa1.start, accept: nfa2.accept, transitions };
        }

        case STAR: {
            const nfa1 = buildNFAFromNode(node.child);
            const s = newState();
            const a = newState();
            const transitions = new Map(nfa1.transitions);
            addTransition(transitions, s, 'ε', nfa1.start);
            addTransition(transitions, s, 'ε', a);
            addTransition(transitions, nfa1.accept, 'ε', nfa1.start);
            addTransition(transitions, nfa1.accept, 'ε', a);
            return { start: s, accept: a, transitions };
        }

        default:
            throw new Error('Unknown AST node type');
    }
}

function addTransition(transitions, from, symbol, to) {
    if (!transitions.has(from)) transitions.set(from, []);
    transitions.get(from).push({ symbol, to });
}

function mergeTransitions(t1, t2) {
    const merged = new Map(t1);
    for (const [state, trans] of t2) {
        if (merged.has(state)) {
            merged.set(state, [...merged.get(state), ...trans]);
        } else {
            merged.set(state, [...trans]);
        }
    }
    return merged;
}

/* ════════════════════════════════════════════════════════════════
   7. NFA SIMULATION – Test a string against the NFA
   ════════════════════════════════════════════════════════════════ */

/**
 * Compute ε-closure of a set of states.
 */
function epsilonClosure(nfa, states) {
    const closure = new Set(states);
    const stack = [...states];
    while (stack.length > 0) {
        const state = stack.pop();
        const transitions = nfa.transitions.get(state) || [];
        for (const t of transitions) {
            if (t.symbol === 'ε' && !closure.has(t.to)) {
                closure.add(t.to);
                stack.push(t.to);
            }
        }
    }
    return closure;
}

/**
 * Simulate the NFA on an input string.
 * Returns true if the string is accepted.
 */
function simulateNFA(nfa, input) {
    let currentStates = epsilonClosure(nfa, [nfa.start]);

    for (const ch of input) {
        const nextStates = new Set();
        for (const state of currentStates) {
            const transitions = nfa.transitions.get(state) || [];
            for (const t of transitions) {
                if (t.symbol === ch) {
                    nextStates.add(t.to);
                }
            }
        }
        currentStates = epsilonClosure(nfa, nextStates);
    }

    return currentStates.has(nfa.accept);
}

/* ════════════════════════════════════════════════════════════════
   8. TEST STRING – Button handler
   ════════════════════════════════════════════════════════════════ */
btnTestString.addEventListener('click', () => {
    const raw = regexInput.value.trim();
    const testStr = testInput.value; // allow empty string

    if (!raw) {
        regexInput.classList.add('input-error');
        showToast('Please enter a regex first in the builder.', 'error');
        return;
    }

    try {
        const ast = parse(raw);
        // Build NFA if not already built
        const nfa = buildNFA(ast);
        const accepted = simulateNFA(nfa, testStr);

        testResultDiv.classList.remove('hidden');

        const displayStr = testStr === '' ? 'ε (empty string)' : `"${testStr}"`;

        if (accepted) {
            testResultBadge.textContent = '✓ Accepted';
            testResultBadge.className = 'result-badge accepted';
            testResultDetail.innerHTML = `String ${displayStr} is <strong>accepted</strong> by the regex <code>${raw}</code>.`;
            showToast(`String accepted!`, 'success');
        } else {
            testResultBadge.textContent = '✗ Rejected';
            testResultBadge.className = 'result-badge rejected';
            testResultDetail.innerHTML = `String ${displayStr} is <strong>rejected</strong> by the regex <code>${raw}</code>.`;
            showToast(`String rejected.`, 'error');
        }
    } catch (err) {
        regexInput.classList.add('input-error');
        showToast(`Invalid regex: ${err.message}`, 'error');
    }
});

testInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        btnTestString.click();
    }
});

/* ════════════════════════════════════════════════════════════════
   9. CONVERT TO FINITE AUTOMATA – Button handler
   ════════════════════════════════════════════════════════════════ */
btnConvertFA.addEventListener('click', () => {
    const raw = regexInput.value.trim();
    if (!raw) {
        regexInput.classList.add('input-error');
        showToast('Please enter a regular expression.', 'error');
        return;
    }

    try {
        const ast = parse(raw);
        const nfa = buildNFA(ast);
        currentNFA = nfa;

        // Update badge
        const hasEpsilon = [...nfa.transitions.values()].some(trans => trans.some(t => t.symbol === 'ε'));
        faTypeBadge.textContent = hasEpsilon ? 'ε-NFA' : 'NFA';

        // Show table and graph
        renderTransitionTable(nfa);
        renderAutomataGraph(nfa);

        faPlaceholder.classList.add('hidden');
        faTableWrap.classList.remove('hidden');
        faGraphContainer.classList.remove('hidden');

        showToast('Regex converted to Finite Automata!', 'success');

        // Scroll to automata section
        document.getElementById('automata-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        regexInput.classList.add('input-error');
        showToast(`Invalid regex: ${err.message}`, 'error');
    }
});

/* ════════════════════════════════════════════════════════════════
   10. RENDER TRANSITION TABLE
   ════════════════════════════════════════════════════════════════ */
function renderTransitionTable(nfa) {
    faTableHead.innerHTML = '';
    faTableBody.innerHTML = '';

    // Build columns: State, then each symbol
    const symbols = [...nfa.alphabet];
    // Check if ε transitions exist
    const hasEps = [...nfa.transitions.values()].some(trans => trans.some(t => t.symbol === 'ε'));
    if (hasEps) symbols.push('ε');

    // Header row
    const headRow = document.createElement('tr');
    const thState = document.createElement('th');
    thState.textContent = 'State';
    headRow.appendChild(thState);
    for (const sym of symbols) {
        const th = document.createElement('th');
        th.textContent = sym;
        headRow.appendChild(th);
    }
    faTableHead.appendChild(headRow);

    // Body rows
    for (const state of nfa.states) {
        const tr = document.createElement('tr');

        // State cell with markers
        const tdState = document.createElement('td');
        tdState.classList.add('state-cell');
        let stateLabel = `q${state}`;
        if (state === nfa.start && state === nfa.accept) {
            stateLabel = `→ *q${state}`;
            tdState.classList.add('state-start', 'state-accept');
        } else if (state === nfa.start) {
            stateLabel = `→ q${state}`;
            tdState.classList.add('state-start');
        } else if (state === nfa.accept) {
            stateLabel = `*q${state}`;
            tdState.classList.add('state-accept');
        }
        tdState.textContent = stateLabel;
        tr.appendChild(tdState);

        // Transition cells
        const stateTransitions = nfa.transitions.get(state) || [];
        for (const sym of symbols) {
            const td = document.createElement('td');
            const targets = stateTransitions
                .filter(t => t.symbol === sym)
                .map(t => `q${t.to}`);
            td.textContent = targets.length > 0 ? `{${targets.join(', ')}}` : '∅';
            if (targets.length === 0) {
                td.style.color = 'var(--text-dim)';
            }
            tr.appendChild(td);
        }

        faTableBody.appendChild(tr);
    }
}

/* ════════════════════════════════════════════════════════════════
   11. RENDER AUTOMATA GRAPH (SVG)
   ════════════════════════════════════════════════════════════════ */
function renderAutomataGraph(nfa) {
    // Clear previous
    faCanvas.innerHTML = '';

    const numStates = nfa.states.length;
    const stateRadius = 28;
    const padding = 80;

    // Layout states in a structured way
    const positions = layoutStates(nfa, stateRadius, padding);

    // Compute SVG size
    let maxX = 0, maxY = 0;
    for (const pos of Object.values(positions)) {
        maxX = Math.max(maxX, pos.x + stateRadius + padding);
        maxY = Math.max(maxY, pos.y + stateRadius + padding);
    }

    faCanvas.setAttribute('width', maxX);
    faCanvas.setAttribute('height', maxY);
    faCanvas.setAttribute('viewBox', `0 0 ${maxX} ${maxY}`);

    // Define arrow markers
    const defs = createSVGElement('defs');

    // Default arrowhead
    const marker = createSVGElement('marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '10');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '10');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const arrowPath = createSVGElement('polygon');
    arrowPath.setAttribute('points', '0 0, 10 3.5, 0 7');
    arrowPath.setAttribute('fill', 'var(--text-dim)');
    arrowPath.setAttribute('class', 'transition-arrow');
    marker.appendChild(arrowPath);
    defs.appendChild(marker);

    // Start arrowhead
    const markerStart = createSVGElement('marker');
    markerStart.setAttribute('id', 'arrowhead-start');
    markerStart.setAttribute('markerWidth', '10');
    markerStart.setAttribute('markerHeight', '7');
    markerStart.setAttribute('refX', '10');
    markerStart.setAttribute('refY', '3.5');
    markerStart.setAttribute('orient', 'auto');
    const arrowPathStart = createSVGElement('polygon');
    arrowPathStart.setAttribute('points', '0 0, 10 3.5, 0 7');
    arrowPathStart.setAttribute('fill', 'var(--accent-2)');
    markerStart.appendChild(arrowPathStart);
    defs.appendChild(markerStart);

    faCanvas.appendChild(defs);

    // Group transitions by (from, to) to merge labels
    const edgeMap = new Map(); // "from-to" → [symbols]
    for (const [from, trans] of nfa.transitions) {
        for (const t of trans) {
            const key = `${from}-${t.to}`;
            if (!edgeMap.has(key)) edgeMap.set(key, []);
            edgeMap.get(key).push(t.symbol);
        }
    }

    // Draw transitions first (behind states)
    const drawnSelfLoops = new Map(); // state → count
    for (const [key, symbols] of edgeMap) {
        const [fromStr, toStr] = key.split('-');
        const from = parseInt(fromStr);
        const to = parseInt(toStr);
        const label = symbols.join(', ');
        const fromPos = positions[from];
        const toPos = positions[to];

        if (from === to) {
            // Self-loop
            drawSelfLoop(faCanvas, fromPos, stateRadius, label);
        } else {
            // Check if reverse edge exists
            const reverseKey = `${to}-${from}`;
            const hasReverse = edgeMap.has(reverseKey);
            drawTransition(faCanvas, fromPos, toPos, stateRadius, label, hasReverse);
        }
    }

    // Draw start arrow
    const startPos = positions[nfa.start];
    const startLine = createSVGElement('line');
    startLine.setAttribute('x1', startPos.x - stateRadius - 35);
    startLine.setAttribute('y1', startPos.y);
    startLine.setAttribute('x2', startPos.x - stateRadius - 2);
    startLine.setAttribute('y2', startPos.y);
    startLine.setAttribute('class', 'start-arrow');
    startLine.setAttribute('marker-end', 'url(#arrowhead-start)');
    faCanvas.appendChild(startLine);

    // Draw "start" label
    const startLabel = createSVGElement('text');
    startLabel.setAttribute('x', startPos.x - stateRadius - 40);
    startLabel.setAttribute('y', startPos.y - 10);
    startLabel.setAttribute('fill', 'var(--accent-2)');
    startLabel.setAttribute('font-family', "'Inter', sans-serif");
    startLabel.setAttribute('font-size', '11');
    startLabel.setAttribute('font-weight', '600');
    startLabel.textContent = 'start';
    faCanvas.appendChild(startLabel);

    // Draw states on top
    for (const state of nfa.states) {
        const pos = positions[state];
        const isStart = state === nfa.start;
        const isAccept = state === nfa.accept;
        drawState(faCanvas, pos, state, isStart, isAccept, stateRadius);
    }
}

/**
 * Layout states in rows with nice spacing.
 */
function layoutStates(nfa, radius, padding) {
    const positions = {};
    const numStates = nfa.states.length;

    if (numStates <= 6) {
        // Simple horizontal layout
        const spacing = radius * 3.5;
        const startX = padding + 40;
        const startY = padding + radius + 20;
        nfa.states.forEach((state, i) => {
            positions[state] = { x: startX + i * spacing, y: startY };
        });
    } else if (numStates <= 12) {
        // Two rows
        const spacing = radius * 3.2;
        const startX = padding + 40;
        const row1Y = padding + radius + 10;
        const row2Y = row1Y + radius * 4;
        const half = Math.ceil(numStates / 2);
        
        nfa.states.forEach((state, i) => {
            if (i < half) {
                positions[state] = { x: startX + i * spacing, y: row1Y };
            } else {
                positions[state] = { x: startX + (i - half) * spacing, y: row2Y };
            }
        });
    } else {
        // Grid layout – multiple rows
        const cols = Math.ceil(Math.sqrt(numStates * 1.5));
        const spacing = radius * 3.2;
        const startX = padding + 40;
        const startY = padding + radius + 10;

        nfa.states.forEach((state, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            positions[state] = {
                x: startX + col * spacing,
                y: startY + row * (radius * 4)
            };
        });
    }

    return positions;
}

function createSVGElement(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
}

function drawState(svg, pos, stateId, isStart, isAccept, radius) {
    const g = createSVGElement('g');

    // Main circle
    const circle = createSVGElement('circle');
    circle.setAttribute('cx', pos.x);
    circle.setAttribute('cy', pos.y);
    circle.setAttribute('r', radius);
    let cls = 'state-circle';
    if (isStart) cls += ' start-state';
    if (isAccept) cls += ' accept-state';
    circle.setAttribute('class', cls);
    g.appendChild(circle);

    // Accept state double circle
    if (isAccept) {
        const innerCircle = createSVGElement('circle');
        innerCircle.setAttribute('cx', pos.x);
        innerCircle.setAttribute('cy', pos.y);
        innerCircle.setAttribute('r', radius - 5);
        innerCircle.setAttribute('class', 'accept-inner');
        g.appendChild(innerCircle);
    }

    // Label
    const label = createSVGElement('text');
    label.setAttribute('x', pos.x);
    label.setAttribute('y', pos.y);
    label.setAttribute('class', 'state-label');
    label.textContent = `q${stateId}`;
    g.appendChild(label);

    svg.appendChild(g);
}

function drawTransition(svg, fromPos, toPos, radius, label, curved) {
    const dx = toPos.x - fromPos.x;
    const dy = toPos.y - fromPos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const ux = dx / dist;
    const uy = dy / dist;

    // Start and end points on circle edges
    const startX = fromPos.x + ux * radius;
    const startY = fromPos.y + uy * radius;
    const endX = toPos.x - ux * (radius + 8); // leave room for arrowhead
    const endY = toPos.y - uy * (radius + 8);

    const path = createSVGElement('path');
    
    if (curved) {
        // Curve the path to avoid overlapping with the reverse edge
        const cx = (startX + endX) / 2 - uy * 30;
        const cy = (startY + endY) / 2 + ux * 30;
        path.setAttribute('d', `M ${startX} ${startY} Q ${cx} ${cy} ${endX} ${endY}`);
        
        // Label at curve midpoint
        const labelX = (startX + endX) / 2 - uy * 20;
        const labelY = (startY + endY) / 2 + ux * 20;
        
        const text = createSVGElement('text');
        text.setAttribute('x', labelX);
        text.setAttribute('y', labelY - 6);
        text.setAttribute('class', 'transition-label');
        text.textContent = label;
        svg.appendChild(text);
    } else {
        path.setAttribute('d', `M ${startX} ${startY} L ${endX} ${endY}`);
        
        // Label at midpoint
        const midX = (startX + endX) / 2;
        const midY = (startY + endY) / 2;
        
        const text = createSVGElement('text');
        text.setAttribute('x', midX);
        text.setAttribute('y', midY - 10);
        text.setAttribute('class', 'transition-label');
        text.textContent = label;
        svg.appendChild(text);
    }

    path.setAttribute('class', 'transition-path');
    path.setAttribute('marker-end', 'url(#arrowhead)');
    svg.appendChild(path);
}

function drawSelfLoop(svg, pos, radius, label) {
    const path = createSVGElement('path');
    
    // Draw a loop arc above the state
    const loopHeight = 40;
    const loopWidth = 20;
    const startX = pos.x - loopWidth / 2;
    const startY = pos.y - radius;
    const endX = pos.x + loopWidth / 2;
    const endY = pos.y - radius;
    
    const cpX1 = pos.x - loopWidth * 1.5;
    const cpY1 = pos.y - radius - loopHeight;
    const cpX2 = pos.x + loopWidth * 1.5;
    const cpY2 = pos.y - radius - loopHeight;

    path.setAttribute('d', `M ${startX} ${startY} C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${endX} ${endY}`);
    path.setAttribute('class', 'transition-path');
    path.setAttribute('marker-end', 'url(#arrowhead)');
    svg.appendChild(path);

    // Label
    const text = createSVGElement('text');
    text.setAttribute('x', pos.x);
    text.setAttribute('y', pos.y - radius - loopHeight + 8);
    text.setAttribute('class', 'transition-label');
    text.textContent = label;
    svg.appendChild(text);
}

/* ════════════════════════════════════════════════════════════════
   12. EQUIVALENCE CHECKER
   ────────────────────────────────────────────────────────────────
   Approximate equivalence by comparing generated string sets up
   to a reasonable length. Two regexes are "equivalent" if they
   produce the exact same set of strings up to that length.
   ════════════════════════════════════════════════════════════════ */
const EQUIV_MAX_LEN = 7; // slightly higher for better coverage

btnEquiv.addEventListener('click', () => {
    const raw1 = regex1Input.value.trim();
    const raw2 = regex2Input.value.trim();

    let hasError = false;
    if (!raw1) { regex1Input.classList.add('input-error'); hasError = true; }
    if (!raw2) { regex2Input.classList.add('input-error'); hasError = true; }
    if (hasError) {
        showToast('Please enter both regular expressions.', 'error');
        return;
    }

    let ast1, ast2, set1, set2;

    try {
        ast1 = parse(raw1);
    } catch (err) {
        regex1Input.classList.add('input-error');
        showToast(`Regex 1 invalid: ${err.message}`, 'error');
        return;
    }

    try {
        ast2 = parse(raw2);
    } catch (err) {
        regex2Input.classList.add('input-error');
        showToast(`Regex 2 invalid: ${err.message}`, 'error');
        return;
    }

    set1 = new Set(generateStrings(ast1, EQUIV_MAX_LEN));
    set2 = new Set(generateStrings(ast2, EQUIV_MAX_LEN));

    // Compare
    let diffString = null;
    for (const s of set1) {
        if (!set2.has(s)) { diffString = s; break; }
    }
    if (!diffString) {
        for (const s of set2) {
            if (!set1.has(s)) { diffString = s; break; }
        }
    }

    // Show result
    equivResult.classList.remove('hidden');

    if (!diffString) {
        resultBadge.textContent = '✓ Equivalent';
        resultBadge.className = 'result-badge equivalent';
        resultDetail.innerHTML = `Both regexes generate the same <strong>${set1.size}</strong> strings (tested up to length ${EQUIV_MAX_LEN}).`;
        showToast('Regexes are equivalent!', 'success');
    } else {
        resultBadge.textContent = '✗ Not Equivalent';
        resultBadge.className = 'result-badge not-equivalent';
        const displayStr = diffString === '' ? 'ε (empty string)' : diffString;
        const inWhich = set1.has(diffString) ? 'Regex 1' : 'Regex 2';
        resultDetail.innerHTML = `Difference found: <code>${displayStr}</code> is accepted by <strong>${inWhich}</strong> but not the other.`;
        showToast('Regexes are NOT equivalent.', 'error');
    }
});

/* ════════════════════════════════════════════════════════════════
   13. TOAST NOTIFICATIONS
   ════════════════════════════════════════════════════════════════ */
function showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.style.animationDuration = '0.4s, 0.4s';
    toast.style.animationDelay = `0s, ${duration / 1000}s`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, duration + 500);
}

/* ════════════════════════════════════════════════════════════════
   14. KEYBOARD SHORTCUT – Enter to generate
   ════════════════════════════════════════════════════════════════ */
regexInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        btnGenerate.click();
    }
});

regex2Input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        e.preventDefault();
        btnEquiv.click();
    }
});

/* ════════════════════════════════════════════════════════════════
   15. INITIAL STATE
   ════════════════════════════════════════════════════════════════ */
// Focus the main input on load
window.addEventListener('DOMContentLoaded', () => {
    regexInput.focus();
    updateMainRegexDisplay();
});
