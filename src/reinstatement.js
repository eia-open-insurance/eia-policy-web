/**
 * Reinstatement guard helpers.
 *
 * A cancelled policy cannot be reinstated while the return-premium credit note
 * raised from its cancellation is still open. The expert/domain return
 * 409 `CANCELLATION_CREDIT_NOTE_OPEN` with a canonical Problem body whose
 * `detail` names the open notes and explains the remedy, and whose
 * `meta.noteNumbers` carries the same note numbers in machine-readable form.
 *
 * The public body may predate `meta`, so the detail sentence is also parsed:
 *
 *   Cancellation CXL-2026-0000001 has open credit notes CN-2026-0000001
 *   (DRAFT), CN-2026-0000002 (ISSUED). Cancel or reverse these credit notes
 *   first, then reinstate the policy.
 *
 * The guard is rendered inside the Reinstatement section; the form values are
 * never discarded on this rejection.
 */

export const CANCELLATION_CREDIT_NOTE_OPEN = 'CANCELLATION_CREDIT_NOTE_OPEN';

const DEFAULT_GUARD_DETAIL =
  'Cancellation credit notes are still open, so the policy cannot be reinstated.';
const DEFAULT_GUARD_GUIDANCE =
  'Cancel or reverse the open credit notes before reinstating the policy.';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

/**
 * `meta.noteNumbers` is the canonical list, but accept the adjacent names so a
 * rollout body that uses `creditNoteNumbers` or an object list still works.
 */
function numbersFromValue(value) {
  if (!Array.isArray(value)) return [];
  return unique(value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (!entry || typeof entry !== 'object') return '';
      return text(entry.noteNumber)
        || text(entry.creditNoteNumber)
        || text(entry.number);
    })
    .filter(Boolean));
}

function noteTokens(segment) {
  const withoutStatuses = String(segment).replace(/\([^)]*\)/g, ' ');
  const tokens = withoutStatuses.match(/[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+/gi) || [];
  return unique(tokens.filter((token) => /\d/.test(token)));
}

/**
 * Parse the note numbers out of the canonical detail sentence. Only the phrase
 * after "credit notes" is inspected so the cancellation reference in the same
 * sentence is not mistaken for a note number.
 */
function numbersFromDetail(detail) {
  const sentence = text(detail);
  if (!sentence) return [];
  const phrase = sentence.match(
    /(?:open\s+)?(?:credit\s+)?notes?\s*(?:numbers?)?\s*[:#-]?\s*([^.;]+)/i
  );
  return phrase ? noteTokens(phrase[1]) : [];
}

export function openCreditNoteNumbers(body) {
  if (!body || typeof body !== 'object') return [];
  const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const candidates = [
    meta.noteNumbers,
    meta.creditNoteNumbers,
    meta.openCreditNoteNumbers,
    meta.creditNotes,
    meta.openCreditNotes,
    body.noteNumbers,
    body.creditNoteNumbers,
    body.openCreditNoteNumbers,
    body.creditNotes,
    body.openCreditNotes
  ];
  for (const candidate of candidates) {
    const numbers = numbersFromValue(candidate);
    if (numbers.length > 0) return numbers;
  }
  return numbersFromDetail(body.detail || body.title || body.message);
}

/**
 * A reinstatement 409 is the credit-note guard only when the stable code says
 * so, or, for a rollout body without a code, when the detail/meta carries the
 * open-note facts. Any other 409 (stale ETag, not cancelled, and so on) keeps
 * the existing page-level problem handling.
 */
export function isCancellationCreditNoteOpen(body, status) {
  if (Number(status) !== 409) return false;
  const code = text(body?.code).toUpperCase();
  if (code === CANCELLATION_CREDIT_NOTE_OPEN) return true;
  if (code) return false;
  const detail = text(body?.detail);
  return openCreditNoteNumbers(body).length > 0
    || /open\s+(?:credit\s+)?notes?|(?:credit\s+)?notes?\s+(?:are|is|remain)\s+open/i.test(detail);
}

/**
 * Builds the local guard view: the canonical code and detail are shown verbatim,
 * and the note numbers/guidance drive the link to the Billing ledger.
 */
export function reinstatementCreditNoteGuard(body) {
  const meta = body?.meta && typeof body.meta === 'object' ? body.meta : {};
  return {
    code: text(body?.code) || CANCELLATION_CREDIT_NOTE_OPEN,
    detail: text(body?.detail)
      || text(body?.title)
      || text(body?.message)
      || DEFAULT_GUARD_DETAIL,
    noteNumbers: openCreditNoteNumbers(body),
    guidance: text(meta.guidance) || DEFAULT_GUARD_GUIDANCE
  };
}
