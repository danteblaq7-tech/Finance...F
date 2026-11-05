// Reads the figures off a student's fee statement.
//
// Input is plain text: the text layer of a PDF, or the contents of a CSV / TXT export. Fee statements differ from
// one institution to the next, so the parser looks for *labelled* figures ("Total Fees", "Amount Paid",
// "Balance"), understands a Debit / Credit / Balance ledger with a totals row, and understands CSV exports.
//
// It never guesses silently: everything doubtful is reported in `flags`, and the caller sends flagged statements
// to a human instead of deciding automatically.
//
// Pure functions only (no I/O), so they are easy to unit test: see test/statementParser.test.js

/** Matches one amount: 85,000.00 | 85000 | (5,000.00) | 5,000 CR. Ignores digits glued to "/" (dates, 2026/2027, student IDs). */
const AMOUNT = /(?<![\w/.,])(\()?\s*(-)?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(\))?(?![\w/])(?:\s*(CR|DR)\b)?/gi;

/**
 * Turn "85,000.00" / "(5,000)" / "5,000 CR" into a signed number.
 * Convention: a positive balance is money OWED; brackets, a minus sign or "CR" mean a credit (overpaid).
 */
function toNumber(m) {
  const [, open, minus, whole, decimals, close, drCr] = m;
  let n = Number(whole.replace(/,/g, '') + (decimals ?? ''));
  if (!Number.isFinite(n)) return null;
  if ((open && close) || minus || (drCr && drCr.toUpperCase() === 'CR')) n = -n;
  return n;
}

/** All amounts on a line, in order. `strong` ones have thousands separators or decimals, so they are clearly money. */
function amountsIn(line) {
  const cleaned = line.replace(/\b(KES|KSHS?|K\.?SH\.?)\b\.?/gi, ' ');
  const out = [];
  for (const m of cleaned.matchAll(AMOUNT)) {
    const value = toNumber(m);
    if (value === null) continue;
    out.push({ value, strong: Boolean(m[4]) || m[3].includes(',') });
  }
  return out;
}

/** The most likely amount on a line: the last "strong" one if there is any, else the last plain number. */
function pickAmount(line) {
  const all = amountsIn(line);
  if (!all.length) return null;
  const strong = all.filter((a) => a.strong);
  return (strong.length ? strong : all).at(-1).value;
}

const LABELS = {
  total: [
    /\btotal\s+(fees?|fee\s+charged|billed|billing|invoice[d]?|charges?|debits?|payable)\b/i,
    /\bfees?\s+(charged|payable|invoiced|billed)\b/i,
    /\b(gross\s+fees?|total\s+invoiced|amount\s+invoiced|total\s+amount\s+billed)\b/i,
  ],
  paid: [
    /\btotal\s+(paid|payments?|receipts?|credits?|amount\s+paid)\b/i,
    /\b(amount\s+paid|payments?\s+(received|made)|fees?\s+paid|paid\s+to\s+date|total\s+receipts?)\b/i,
  ],
  // Ordered by trust: the first label that matches wins.
  balance: [
    /\b(closing\s+balance|balance\s+c\/?f|balance\s+carried\s+forward)\b/i,
    /\b(outstanding(\s+(balance|fees?|amount))?|amount\s+due|balance\s+due|arrears|fee\s+balance|total\s+balance)\b/i,
    /\bbalance\b/i,
  ],
};
const NOT_A_CLOSING_BALANCE = /\b(b\/?f|brought\s+forward|opening|previous|prior)\b/i;

const matchesAny = (patterns, line) => patterns.findIndex((p) => p.test(line));

/** Normalise an institutional ID so "egm / 027 / 2024" and "EGM/027/2024" compare equal. */
export const normaliseId = (s) => String(s ?? '').toUpperCase().replace(/\s+/g, '');

const ID_LABEL = /\b(reg(?:istration)?\.?\s*(?:no|number|#)|adm(?:ission)?\.?\s*(?:no|number|#)|student\s*(?:id|no|number|code)|matric(?:ulation)?\s*(?:no|number))\b\.?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9/\-. ]{2,28}?)(?=\s{2,}|\s*$|\s*[,;|]|\s+(?:name|course|programme|program|year|semester|date)\b)/im;

/** Every "2026/2027" style academic year mentioned in the text, normalised to YYYY/YYYY. */
function academicYearsIn(text) {
  const years = new Set();
  for (const m of text.matchAll(/\b(20\d{2})\s*[/-]\s*(20\d{2}|\d{2})\b/g)) {
    const end = m[2].length === 2 ? m[1].slice(0, 2) + m[2] : m[2];
    years.add(`${m[1]}/${end}`);
  }
  return [...years];
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────

function splitCsvLine(line, delimiter) {
  const cells = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { cells.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const cellNumber = (cell) => {
  if (cell === undefined || cell === '') return null;
  const all = amountsIn(cell);
  return all.length ? all[0].value : null;
};

/**
 * CSV with a header row.
 *   summary:  total_fee, amount_paid, balance  → first data row
 *   ledger:   date, description, debit, credit, balance → totals = sum(debit), sum(credit); balance = last row
 */
function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const delimiter = [',', ';', '\t'].map((d) => [d, lines[0].split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.toLowerCase());
  if (header.length < 2) return null;
  const col = (re) => header.findIndex((h) => re.test(h));
  const rows = lines.slice(1).map((l) => splitCsvLine(l, delimiter));

  const iTotal = col(/^(total[\s_]*(fees?|billed|invoiced|charges?)?|fees?[\s_]*(charged|payable|billed)|invoiced)$/);
  const iPaid = col(/^(amount[\s_]*paid|total[\s_]*paid|paid|payments?)$/);
  const iBalance = col(/^(balance|outstanding|closing[\s_]*balance|amount[\s_]*due)$/);
  if (iTotal >= 0 && iBalance >= 0 || iTotal >= 0 && iPaid >= 0) {
    const r = rows[0];
    return { total: cellNumber(r[iTotal]), paid: iPaid >= 0 ? cellNumber(r[iPaid]) : null, balance: iBalance >= 0 ? cellNumber(r[iBalance]) : null, source: 'csv-summary', rows };
  }

  const iDebit = col(/^(debit|debits|charges?|invoiced|dr)$/);
  const iCredit = col(/^(credit|credits|payments?|receipts?|cr)$/);
  if (iDebit >= 0 && iCredit >= 0) {
    const sum = (i) => rows.reduce((s, r) => s + (cellNumber(r[i]) ?? 0), 0);
    const lastBalance = iBalance >= 0 ? [...rows].reverse().map((r) => cellNumber(r[iBalance])).find((v) => v !== null) ?? null : null;
    return { total: sum(iDebit), paid: sum(iCredit), balance: lastBalance, source: 'csv-ledger', rows };
  }
  return null;
}

// ── Ledger in PDF text: header "Debit Credit Balance" followed by a "Total" row ─────────────────
// PDF text extraction is unpredictable: sometimes a table row comes out on one line, sometimes every cell is on its
// own line. So this works on a stream of words and ignores line breaks completely.

const AMOUNT_WORD = /^\(?-?\d[\d,]*(?:\.\d{1,2})?\)?(?:CR|DR)?$/i;

function parseLedgerTotals(text) {
  const words = text.split(/\s+/).filter((w) => !/^(KES|KSHS?|KSH\.?)$/i.test(w));
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
  const iDebit = lower.indexOf('debit');
  const iCredit = lower.indexOf('credit', Math.max(iDebit, 0));
  if (iDebit < 0 || iCredit < 0 || iCredit - iDebit > 8) return null;

  // Column order is the order the header words appear in (Balance may come before, between or after).
  const headerEnd = Math.max(iDebit, iCredit) + 4;
  const header = [['debit', iDebit], ['credit', iCredit], ['balance', lower.indexOf('balance', Math.max(0, Math.min(iDebit, iCredit) - 4))]]
    .filter(([, at]) => at >= 0 && at <= headerEnd)
    .sort((a, b) => a[1] - b[1])
    .map(([name]) => name);

  for (let i = Math.max(iDebit, iCredit) + 1; i < words.length; i++) {
    if (!/^totals?$/i.test(words[i])) continue;
    const nums = [];
    for (let j = i + 1; j < words.length && nums.length < header.length && AMOUNT_WORD.test(words[j]); j++) nums.push(words[j]);
    if (nums.length !== header.length) continue;
    const values = nums.map((w) => amountsIn(w)[0]?.value ?? null);
    const byName = Object.fromEntries(header.map((n, k) => [n, values[k]]));
    return { total: byName.debit ?? null, paid: byName.credit ?? null, balance: byName.balance ?? null, source: 'ledger' };
  }
  return null;
}

// ── Labelled lines ("Total Fees: KES 85,000.00") ─────────────────────────────────────────────────

function parseLabelled(lines) {
  const found = { total: null, paid: null, balance: null };
  let balanceRank = Infinity;

  lines.forEach((line, idx) => {
    const amountOnLineOrNext = () => {
      const here = pickAmount(line);
      if (here !== null) return here;
      // PDF text often puts a table cell's value on the next line.
      const next = lines[idx + 1];
      return next && !/[a-z]{3,}/i.test(next.replace(/\b(KES|KSHS?|CR|DR)\b/gi, '')) ? pickAmount(next) : null;
    };

    for (const key of ['total', 'paid']) {
      if (found[key] === null && matchesAny(LABELS[key], line) >= 0) {
        const v = amountOnLineOrNext();
        if (v !== null) found[key] = Math.abs(v);
      }
    }
    const rank = matchesAny(LABELS.balance, line);
    if (rank >= 0 && rank < balanceRank && !NOT_A_CLOSING_BALANCE.test(line) && matchesAny(LABELS.total, line) < 0 && matchesAny(LABELS.paid, line) < 0) {
      const v = amountOnLineOrNext();
      if (v !== null) { found.balance = v; balanceRank = rank; }
    }
  });
  return found.total === null && found.paid === null && found.balance === null ? null : { ...found, source: 'labels' };
}

// ── Public API ───────────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} text  text of the statement (PDF text layer, CSV or TXT)
 * @returns {{
 *   totalFee: number|null, amountPaid: number|null, balance: number|null,   // balance = money OWED (never negative)
 *   creditBalance: boolean, studentId: string|null, academicYears: string[],
 *   confidence: 'high'|'medium'|'low'|'none', source: string|null, flags: string[]
 * }}
 */
export function parseFeeStatement(text) {
  const flags = [];
  const clean = String(text ?? '').replace(/\u00a0/g, ' ').replace(/\r/g, '');
  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);

  const raw = parseCsv(clean) ?? parseLedgerTotals(clean) ?? parseLabelled(lines);

  const idMatch = clean.match(ID_LABEL);
  const result = {
    totalFee: null, amountPaid: null, balance: null, creditBalance: false,
    studentId: idMatch ? normaliseId(idMatch[2]) : null,
    academicYears: academicYearsIn(clean),
    confidence: 'none', source: raw?.source ?? null, flags,
  };
  if (!raw) { flags.push('no_figures'); return result; }

  let { total, paid, balance } = raw;
  if (total !== null) total = Math.abs(total);
  if (paid !== null) paid = Math.abs(paid);
  let owed = balance === null ? null : Math.max(0, balance);
  result.creditBalance = balance !== null && balance < 0;

  // Fill in whatever is missing from the other two; flag it when what is printed does not add up.
  if (total !== null && paid !== null) {
    const derived = Math.max(0, total - paid);
    if (owed === null) owed = derived;
    else if (Math.abs(owed - derived) > 1) flags.push('inconsistent');
  } else if (total !== null && owed !== null) {
    paid = Math.max(0, total - owed);
    flags.push('paid_derived');
  } else if (paid !== null && owed !== null) {
    total = paid + owed;
    flags.push('total_derived');
  }

  result.totalFee = total;
  result.amountPaid = paid;
  result.balance = owed;
  const have = [raw.total, raw.paid, raw.balance].filter((v) => v !== null && v !== undefined).length;
  result.confidence = flags.includes('inconsistent') ? 'low' : have >= 3 ? 'high' : have === 2 ? 'medium' : 'low';
  if (owed === null) flags.push('no_balance');
  return result;
}

/**
 * Does the statement belong to this student, and is it for this exam period?
 *  - `wrong_student`: the statement names a DIFFERENT student ID → reject the upload outright.
 *  - `no_student_id`: the statement doesn't contain the student's ID at all → a human must look at it.
 *  - `wrong_period`: it mentions academic years, but never the one being applied for.
 */
export function checkOwnership(parsed, text, { studentId, academicYear }) {
  const mine = normaliseId(studentId);
  const haystack = normaliseId(text);
  const flags = [];
  let identity = 'unknown';
  if (mine && haystack.includes(mine)) identity = 'matched';
  else if (parsed.studentId && parsed.studentId !== mine) identity = 'mismatch';
  if (identity === 'mismatch') flags.push('wrong_student');
  else if (identity === 'unknown') flags.push('no_student_id');
  if (parsed.academicYears.length && academicYear && !parsed.academicYears.includes(academicYear)) flags.push('wrong_period');
  return { identity, flags };
}
