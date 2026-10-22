import React, { useEffect, useRef, useState } from 'react';
import CrossLink, { navigateTo } from './navigation.jsx';
import DirectoryPersonPicker from './DirectoryPersonPicker.jsx';
import EntityPicker from './EntityPicker.jsx';
import ProductPicker from './ProductPicker.jsx';
import { api, newIdempotencyKey, problemMessage } from './api.js';
import {
  directoryPersonName,
  getCachedDirectory,
  loadDirectory
} from './directory.js';
import { formatMoney } from './format.js';
import { partyEndpoint, partyRecordLabel } from './party.js';
import { productLabel as productLabelFor } from './products.js';
import {
  MAX_REFERRAL_NOTES_LENGTH,
  REFERRAL_REASONS,
  defaultReferralDecisionForm,
  defaultReferralForm,
  normalizeReferralHistory,
  normalizeReferralResult,
  referralDecisionLabel,
  referralDecisionPayload,
  referralCanBeOpened,
  referralIsPending,
  referralPayload,
  referralReasonLabel,
  referralStatusTone,
  mergeReferral,
  submissionReferralDecisionEndpoint,
  submissionReferralEndpoint,
  submissionReferralsEndpoint,
  validateReferralDecisionForm,
  validateReferralForm
} from './referral.js';
import {
  MAX_SUBMISSION_NOTES_LENGTH,
  SUBMISSION_STATUSES,
  defaultSubmissionConversionForm,
  defaultSubmissionForm,
  normalizeConversionResult,
  normalizeSubmission,
  normalizeSubmissionPage,
  submissionActionsFor,
  submissionApplicantLabel,
  submissionCanConvert,
  submissionConversionPayload,
  submissionConvertEndpoint,
  submissionCreatePayload,
  submissionEndpoint,
  submissionIsTerminal,
  submissionListEndpoint,
  submissionMatchesFilters,
  submissionReference,
  submissionStatusEndpoint,
  submissionStatusLabel,
  submissionStatusPayload,
  submissionStatusTone,
  submissionsEndpoint,
  validateSubmissionConversionForm,
  validateSubmissionForm
} from './submissions.js';

const PAGE_SIZE = 20;

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function formatTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function limitText(submission) {
  return formatMoney(
    submission?.requestedLimitAmount,
    submission?.requestedLimitCurrency
  );
}

function detailFromResponse(body, fallbackId) {
  const raw = body?.submission || body?.item || body;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeSubmission({
    ...raw,
    submissionId: raw.submissionId || raw.id || fallbackId
  });
}

/**
 * Referral commands may answer with the updated submission, a submission
 * wrapper, or the referral record alone. Only a body that actually carries a
 * submission is normalized here; a referral-only envelope must not be mistaken
 * for an empty submission record.
 */
function submissionFromCommandResponse(body, fallbackId) {
  if (!body || typeof body !== 'object') return null;
  const raw = body.submission
    || body.item
    || (body.submissionId || body.submissionNumber ? body : null);
  if (!raw || typeof raw !== 'object') return null;
  return detailFromResponse(raw, fallbackId);
}

/**
 * New-business submissions live before the policy record exists.
 *
 * The tab lists the underwriting queue, creates submissions, and moves them
 * through the underwriting statuses. None of those actions creates, quotes, or
 * binds a policy: a policy is created later, by the Policy domain, in a
 * separate conversion.
 */
export default function SubmissionsWorkspace({ onPolicyConverted = null }) {
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [links, setLinks] = useState({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [selected, setSelected] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [applicantLabels, setApplicantLabels] = useState({});
  const [notice, setNotice] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(defaultSubmissionForm);
  const [applicantLabel, setApplicantLabel] = useState('');
  const [productLabel, setProductLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [action, setAction] = useState(null);
  const [reason, setReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertForm, setConvertForm] = useState(() => defaultSubmissionConversionForm(null));
  const [convertBusy, setConvertBusy] = useState(false);
  const [convertError, setConvertError] = useState('');
  const [directory, setDirectory] = useState(
    () => getCachedDirectory() || { people: [], teams: [] }
  );
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState('');
  const [referralOpen, setReferralOpen] = useState(false);
  const [referralForm, setReferralForm] = useState(defaultReferralForm);
  const [referralBusy, setReferralBusy] = useState(false);
  const [referralError, setReferralError] = useState('');
  const [decision, setDecision] = useState(null);
  const [decisionForm, setDecisionForm] = useState(() => defaultReferralDecisionForm());
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [decisionError, setDecisionError] = useState('');
  const [referralHistory, setReferralHistory] = useState([]);
  const [referralHistoryLoading, setReferralHistoryLoading] = useState(false);
  const [referralHistoryError, setReferralHistoryError] = useState('');
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const referralHistoryRequestRef = useRef(0);
  const labelRequestsRef = useRef(new Set());

  async function loadSubmissions(pageToLoad = 0, options = {}) {
    const requestId = listRequestRef.current + 1;
    listRequestRef.current = requestId;
    if (!options.quiet) setLoading(true);
    setLoadError('');
    try {
      const result = await api(submissionListEndpoint(pageToLoad, PAGE_SIZE));
      if (requestId !== listRequestRef.current) return false;
      if (!result.response.ok) {
        setLoadError(
          problemMessage(result.body, `Submission load failed: ${result.response.status}`)
        );
        return false;
      }
      const pageData = normalizeSubmissionPage(result.body, pageToLoad, PAGE_SIZE);
      setItems(pageData.items);
      setPage(pageData.page);
      setTotal(pageData.total);
      setLinks(pageData.links);
      const labels = {};
      for (const item of pageData.items) {
        if (item.applicantPartyId && item.applicantLabel) {
          labels[item.applicantPartyId] = item.applicantLabel;
        }
      }
      if (Object.keys(labels).length) {
        setApplicantLabels((current) => ({ ...current, ...labels }));
      }
      return true;
    } catch (e) {
      if (requestId === listRequestRef.current) setLoadError(e.message);
      return false;
    } finally {
      if (requestId === listRequestRef.current) setLoading(false);
    }
  }

  /**
   * The submission detail carries only the current referral, so the history is
   * a separate read. It travels with every detail read (initial selection,
   * detail refresh, and the re-read after a refer/decision) and is contained:
   * a failed history read reports inside the history area and never blocks the
   * detail, its actions, or the queue.
   */
  async function loadReferralHistory(submissionId, options = {}) {
    if (!submissionId) return false;
    const requestId = referralHistoryRequestRef.current + 1;
    referralHistoryRequestRef.current = requestId;
    if (!options.quiet) setReferralHistoryLoading(true);
    setReferralHistoryError('');
    try {
      const result = await api(submissionReferralsEndpoint(submissionId));
      if (requestId !== referralHistoryRequestRef.current) return false;
      if (!result.response.ok) {
        setReferralHistoryError(
          problemMessage(
            result.body,
            `Referral history is unavailable: ${result.response.status}`
          )
        );
        return false;
      }
      setReferralHistory(normalizeReferralHistory(result.body));
      return true;
    } catch (e) {
      if (requestId === referralHistoryRequestRef.current) {
        setReferralHistoryError(
          e.message || 'Referral history is temporarily unavailable.'
        );
      }
      return false;
    } finally {
      if (requestId === referralHistoryRequestRef.current) {
        setReferralHistoryLoading(false);
      }
    }
  }

  async function loadSubmissionDetail(submissionId, options = {}) {
    if (!submissionId) return false;
    loadReferralHistory(submissionId, { quiet: options.quiet }).catch(() => {});
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    if (!options.quiet) setDetailLoading(true);
    setDetailError('');
    try {
      const result = await api(submissionEndpoint(submissionId));
      if (requestId !== detailRequestRef.current) return false;
      if (!result.response.ok) {
        setDetailError(
          problemMessage(result.body, `Submission load failed: ${result.response.status}`)
        );
        return false;
      }
      const normalized = detailFromResponse(result.body, submissionId);
      if (!normalized) {
        setDetailError('The submission read returned no record.');
        return false;
      }
      setSelected(normalized);
      setItems((current) => current.map((item) => (
        item.submissionId === normalized.submissionId ? { ...item, ...normalized } : item
      )));
      if (normalized.applicantPartyId && normalized.applicantLabel) {
        setApplicantLabels((current) => ({
          ...current,
          [normalized.applicantPartyId]: normalized.applicantLabel
        }));
      }
      return true;
    } catch (e) {
      if (requestId === detailRequestRef.current) setDetailError(e.message);
      return false;
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  useEffect(() => {
    loadSubmissions(0).catch(() => {});
  }, []);

  /**
   * The queue carries the applicant party id even when the summary omits its
   * display name. Resolving it here keeps the party cross-link readable without
   * letting a Party read failure break the queue.
   */
  useEffect(() => {
    const ids = new Set();
    for (const item of [...items, selected]) {
      if (!item?.applicantPartyId) continue;
      if (submissionApplicantLabel(item, applicantLabels)) continue;
      if (labelRequestsRef.current.has(item.applicantPartyId)) continue;
      ids.add(item.applicantPartyId);
    }
    const pending = [...ids].slice(0, 8);
    if (!pending.length) return undefined;
    let active = true;
    for (const id of pending) {
      labelRequestsRef.current.add(id);
      api(partyEndpoint(id))
        .then(({ response, body }) => {
          if (!active || !response.ok) return;
          const label = partyRecordLabel(body);
          if (!label) return;
          setApplicantLabels((current) => (
            current[id] ? current : { ...current, [id]: label }
          ));
        })
        .catch(() => {});
    }
    return () => {
      active = false;
    };
  }, [items, selected, applicantLabels]);

  const referralReferredTo = selected?.referral?.referredTo || '';
  const referralDecidedBy = selected?.referral?.decidedBy || '';
  const referralHistoryPeople = referralHistory
    .flatMap((entry) => [entry?.referredTo, entry?.decidedBy])
    .filter(Boolean)
    .join('|');

  /**
   * A recorded referral names directory people by id. Resolve the directory
   * once when the selected submission carries such an id, so the panel can
   * show names instead of short UUIDs. A directory failure is contained: the
   * panel falls back to the id and a dialog read retries.
   */
  useEffect(() => {
    if (!referralReferredTo && !referralDecidedBy && !referralHistoryPeople) return;
    const cached = getCachedDirectory();
    if (cached) {
      setDirectory(cached);
      setDirectoryError('');
      return;
    }
    ensureDirectory().catch(() => {});
  }, [referralReferredTo, referralDecidedBy, referralHistoryPeople]);

  const visibleSubmissions = items.filter((item) => (
    submissionMatchesFilters(item, { query, status: statusFilter }, applicantLabels)
  ));
  const filterActive = Boolean(query.trim() || statusFilter);

  function updateForm(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function openCreateDialog() {
    setForm(defaultSubmissionForm());
    setApplicantLabel('');
    setProductLabel('');
    setFormError('');
    setCreateOpen(true);
    setNotice('');
  }

  function closeCreateDialog() {
    if (saving) return;
    setCreateOpen(false);
    setFormError('');
  }

  function openSubmission(submission) {
    if (!submission?.submissionId) return;
    setDetailError('');
    setSelected(submission);
    loadSubmissionDetail(submission.submissionId).catch(() => {});
  }

  function closeSelected() {
    detailRequestRef.current += 1;
    referralHistoryRequestRef.current += 1;
    setSelected(null);
    setDetailError('');
    setDetailLoading(false);
    setReferralHistory([]);
    setReferralHistoryLoading(false);
    setReferralHistoryError('');
    setConvertOpen(false);
    setConvertError('');
    setReferralOpen(false);
    setReferralError('');
    setDecision(null);
    setDecisionError('');
  }

  async function refreshWorkspace() {
    const ok = await loadSubmissions(page, { quiet: true });
    if (selected?.submissionId) {
      await loadSubmissionDetail(selected.submissionId, { quiet: true });
    }
    setNotice(ok ? 'Submissions refreshed.' : 'Submission refresh failed.');
  }

  async function refreshSelectedSubmission() {
    if (!selected?.submissionId) return;
    const ok = await loadSubmissionDetail(selected.submissionId);
    await loadSubmissions(page, { quiet: true });
    setNotice(ok ? 'Submission refreshed.' : 'Submission refresh failed.');
  }

  /**
   * The people directory is platform master data. It is read lazily when a
   * referral picker opens, or when the selected referral already carries a
   * person id that the panel should resolve to a name. The module cache means
   * reopening a dialog never issues a second read.
   */
  async function ensureDirectory() {
    const cached = getCachedDirectory();
    if (cached) {
      setDirectory(cached);
      setDirectoryError('');
      return cached;
    }
    setDirectoryLoading(true);
    setDirectoryError('');
    try {
      const loaded = await loadDirectory();
      setDirectory(loaded);
      return loaded;
    } catch (e) {
      setDirectoryError(e.message || 'The people directory is temporarily unavailable.');
      return null;
    } finally {
      setDirectoryLoading(false);
    }
  }

  function personDisplay(personId) {
    if (!personId) return '—';
    return directoryPersonName(directory.people, personId) || shortId(personId);
  }

  function applySubmissionUpdate(record) {
    if (!record?.submissionId) return;
    setSelected((current) => (
      current?.submissionId === record.submissionId
        ? { ...current, ...record }
        : current
    ));
    setItems((current) => current.map((item) => (
      item.submissionId === record.submissionId ? { ...item, ...record } : item
    )));
  }

  function openReferral() {
    if (!selected || !referralCanBeOpened(selected.status, selected.referral)) return;
    setReferralForm(defaultReferralForm());
    setReferralError('');
    setReferralOpen(true);
    setNotice('');
    ensureDirectory().catch(() => {});
  }

  function closeReferral() {
    if (referralBusy) return;
    setReferralOpen(false);
    setReferralError('');
  }

  function updateReferral(field, value) {
    setReferralForm((current) => ({ ...current, [field]: value }));
    setReferralError('');
  }

  /**
   * Opening a referral records the reason, authority, directory person, and
   * optional notes, then the referral starts PENDING and the submission moves
   * to REFERRED. The command response is applied optimistically, but the
   * detail and queue are re-read before the notice is announced.
   */
  async function submitReferral(event) {
    event.preventDefault();
    if (!selected?.submissionId || referralBusy) return;
    const target = selected;
    const validation = validateReferralForm(referralForm);
    if (validation) {
      setReferralError(validation);
      return;
    }
    const payload = referralPayload(referralForm);
    setReferralBusy(true);
    setReferralError('');
    try {
      const result = await api(submissionReferralEndpoint(target.submissionId), {
        method: 'POST',
        body: payload,
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        // A 400 validation problem or a 409 stale/duplicate referral conflict
        // stays in the dialog; a 409 also re-reads the submission so the panel
        // shows the referral the domain actually holds.
        setReferralError(
          problemMessage(result.body, `Referral failed: ${result.response.status}`)
        );
        if (result.response.status === 409) {
          await loadSubmissionDetail(target.submissionId, { quiet: true });
          await loadSubmissions(page, { quiet: true });
        }
        return;
      }

      const normalized = normalizeReferralResult(result.body);
      const openedAt = new Date().toISOString();
      const fallbackReferral = {
        referralId: '',
        status: 'PENDING',
        reason: payload.reason,
        authority: payload.authority,
        referredTo: payload.referredTo,
        notes: payload.notes || '',
        decidedBy: '',
        at: openedAt,
        referredAt: openedAt,
        decidedAt: ''
      };
      const nextReferral = mergeReferral(fallbackReferral, normalized.referral);
      const fallbackStatus = target.status === 'RECEIVED' ? 'REFERRED' : target.status;
      const updated = submissionFromCommandResponse(result.body, target.submissionId);
      applySubmissionUpdate(updated
        ? { ...updated, referral: updated.referral || nextReferral }
        : { ...target, status: fallbackStatus, referral: nextReferral });

      setReferralOpen(false);
      setReferralForm(defaultReferralForm());
      setReferralError('');

      await loadSubmissionDetail(target.submissionId, { quiet: true });
      await loadSubmissions(page, { quiet: true });

      const reference = updated?.submissionNumber
        || target.submissionNumber
        || submissionReference(target);
      setNotice(
        `${result.replayed ? 'Idempotent replay: ' : ''}Referral opened for ${reference} — `
        + `${referralReasonLabel(payload.reason)} · ${payload.authority}. `
        + 'The submission is REFERRED and the referral is PENDING.'
      );
    } catch (e) {
      setReferralError(e.message);
    } finally {
      setReferralBusy(false);
    }
  }

  function openDecision(nextDecision) {
    if (!selected || !referralIsPending(selected.referral)) return;
    setDecision(nextDecision);
    setDecisionForm(defaultReferralDecisionForm(nextDecision));
    setDecisionError('');
    setNotice('');
    ensureDirectory().catch(() => {});
  }

  function closeDecision() {
    if (decisionBusy) return;
    setDecision(null);
    setDecisionError('');
  }

  function updateDecision(field, value) {
    setDecisionForm((current) => ({ ...current, [field]: value }));
    setDecisionError('');
  }

  /**
   * Approve/decline resolves the pending referral. It records the directory
   * person who decided it and optional notes. Approval leaves the submission
   * REFERRED; a decline also moves the submission lifecycle to DECLINED. It
   * never changes terms or creates a policy.
   */
  async function submitDecision(event) {
    event.preventDefault();
    if (!selected?.submissionId || !decision || decisionBusy) return;
    const target = selected;
    const validation = validateReferralDecisionForm({ ...decisionForm, decision });
    if (validation) {
      setDecisionError(validation);
      return;
    }
    const payload = referralDecisionPayload({ ...decisionForm, decision });
    setDecisionBusy(true);
    setDecisionError('');
    try {
      const result = await api(submissionReferralDecisionEndpoint(target.submissionId), {
        method: 'POST',
        body: payload
      });
      if (!result.response.ok) {
        setDecisionError(
          problemMessage(result.body, `Referral decision failed: ${result.response.status}`)
        );
        if (result.response.status === 409) {
          await loadSubmissionDetail(target.submissionId, { quiet: true });
          await loadSubmissions(page, { quiet: true });
        }
        return;
      }

      const normalized = normalizeReferralResult(result.body);
      const decidedAt = new Date().toISOString();
      const fallbackReferral = {
        ...(target.referral || {}),
        status: payload.decision,
        decidedBy: payload.decidedBy,
        notes: payload.notes || target.referral?.notes || '',
        at: decidedAt,
        decidedAt
      };
      const nextReferral = mergeReferral(fallbackReferral, normalized.referral);
      const updated = submissionFromCommandResponse(result.body, target.submissionId);
      applySubmissionUpdate(updated
        ? { ...updated, referral: updated.referral || nextReferral }
        : { ...target, referral: nextReferral });

      setDecision(null);
      setDecisionForm(defaultReferralDecisionForm());
      setDecisionError('');

      await loadSubmissionDetail(target.submissionId, { quiet: true });
      await loadSubmissions(page, { quiet: true });

      const reference = updated?.submissionNumber
        || target.submissionNumber
        || submissionReference(target);
      setNotice(
        `${result.replayed ? 'Idempotent replay: ' : ''}Referral `
        + `${payload.decision === 'APPROVED' ? 'approved' : 'declined'} for ${reference} by `
        + `${personDisplay(payload.decidedBy)}.`
      );
    } catch (e) {
      setDecisionError(e.message);
    } finally {
      setDecisionBusy(false);
    }
  }

  function goToPage(pageNumber) {
    if (pageNumber < 0 || loading) return;
    setNotice('');
    loadSubmissions(pageNumber).catch(() => {});
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (saving) return;
    setFormError('');
    const validation = validateSubmissionForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    setSaving(true);
    try {
      const result = await api(submissionsEndpoint(), {
        method: 'POST',
        body: submissionCreatePayload(form),
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        setFormError(
          problemMessage(result.body, `Submission creation failed: ${result.response.status}`)
        );
        return;
      }
      const created = detailFromResponse(result.body, '');
      const reference = created?.submissionNumber || 'submission';
      setCreateOpen(false);
      setForm(defaultSubmissionForm());
      setApplicantLabel('');
      setProductLabel('');
      setNotice(result.replayed
        ? `Idempotent replay: returned ${reference}. No policy was created.`
        : `Created ${reference}. No policy was created; submissions precede policies.`);
      await loadSubmissions(0, { quiet: true });
      if (created?.submissionId) {
        // A new submission has no referral rounds yet, but the panel must not
        // keep the history of the previously selected submission.
        setReferralHistory([]);
        setReferralHistoryError('');
        setSelected(created);
        loadReferralHistory(created.submissionId, { quiet: true }).catch(() => {});
      }
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function openAction(actionEntry) {
    setAction(actionEntry);
    setReason('');
    setActionError('');
  }

  function closeAction() {
    if (actionBusy) return;
    setAction(null);
    setReason('');
    setActionError('');
  }

  async function submitStatusChange(event) {
    event.preventDefault();
    if (!selected?.submissionId || !action || actionBusy) return;
    const target = action;
    setActionBusy(true);
    setActionError('');
    try {
      const result = await api(submissionStatusEndpoint(selected.submissionId), {
        method: 'PATCH',
        body: submissionStatusPayload(target.status, reason)
      });
      if (!result.response.ok) {
        setActionError(
          problemMessage(result.body, `Status change failed: ${result.response.status}`)
        );
        if (result.response.status === 409) {
          await loadSubmissionDetail(selected.submissionId, { quiet: true });
        }
        return;
      }
      const updated = detailFromResponse(result.body, selected.submissionId);
      setAction(null);
      setReason('');
      if (updated?.submissionId
        && (updated.submissionNumber || updated.applicantPartyId || updated.productCode)) {
        setSelected(updated);
        setItems((current) => current.map((item) => (
          item.submissionId === updated.submissionId ? { ...item, ...updated } : item
        )));
      }
      const refreshed = await loadSubmissionDetail(selected.submissionId, { quiet: true });
      if (!refreshed) {
        const fallback = { ...selected, status: target.status };
        setSelected(fallback);
        setItems((current) => current.map((item) => (
          item.submissionId === fallback.submissionId ? { ...item, ...fallback } : item
        )));
      }
      await loadSubmissions(page, { quiet: true });
      const reference = updated?.submissionNumber
        || selected.submissionNumber
        || submissionReference(selected);
      const noPolicy = ['QUOTED', 'BOUND'].includes(target.status)
        ? ' No policy was created; quoting and binding the submission record the underwriting position only.'
        : '';
      setNotice(`Submission ${reference} moved to ${target.status}.${noPolicy}`);
    } catch (e) {
      setActionError(e.message);
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * Conversion is the explicit hand-off to the Policy domain: it creates the
   * DRAFT policy record and binds the submission. It is separate from the
   * underwriting status actions, which never create a policy.
   */
  function openConvertDialog() {
    if (!selected || !submissionCanConvert(selected.status)) return;
    setConvertForm(defaultSubmissionConversionForm(selected));
    setConvertError('');
    setConvertOpen(true);
    setNotice('');
  }

  function closeConvertDialog() {
    if (convertBusy) return;
    setConvertOpen(false);
    setConvertError('');
  }

  function updateConversion(field, value) {
    setConvertForm((current) => ({ ...current, [field]: value }));
    setConvertError('');
  }

  async function submitConversion(event) {
    event.preventDefault();
    if (!selected?.submissionId || convertBusy) return;
    const target = selected;
    const validation = validateSubmissionConversionForm(convertForm, target);
    if (validation) {
      setConvertError(validation);
      return;
    }
    setConvertBusy(true);
    setConvertError('');
    try {
      const result = await api(submissionConvertEndpoint(target.submissionId), {
        method: 'POST',
        body: submissionConversionPayload(convertForm),
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        // A 400 validation problem or a 409 stale/already-converted conflict
        // stays in the dialog; a 409 also re-reads the submission so the
        // operator sees the position the domain actually holds.
        setConvertError(
          problemMessage(result.body, `Conversion failed: ${result.response.status}`)
        );
        if (result.response.status === 409) {
          await loadSubmissionDetail(target.submissionId, { quiet: true });
          await loadSubmissions(page, { quiet: true });
        }
        return;
      }

      const conversion = normalizeConversionResult(
        result.body,
        result.response.headers.get('Location')
      );
      if (!conversion.policyId) {
        setConvertError(
          'The conversion succeeded but did not return the new policy id, so it cannot be opened. Refresh the queue and open the policy from the policy book.'
        );
        return;
      }

      // The command also binds the submission. The envelope may already carry
      // the converted projection, so show it immediately, then re-read both the
      // detail and the queue before leaving the tab; a return to Submissions
      // shows the server's position rather than the stale QUOTED row.
      if (conversion.submission?.submissionId) {
        const converted = conversion.submission;
        setSelected((current) => (current ? { ...current, ...converted } : converted));
        setItems((current) => current.map((item) => (
          item.submissionId === converted.submissionId
            ? { ...item, ...converted }
            : item
        )));
      }
      await loadSubmissionDetail(target.submissionId, { quiet: true });
      await loadSubmissions(page, { quiet: true });

      setConvertOpen(false);
      setConvertError('');
      const policyReference = conversion.policyNumber
        || `${conversion.policyId.slice(0, 8)}…`;
      setNotice(
        `${result.replayed ? 'Idempotent replay: ' : ''}Converted submission `
        + `${target.submissionNumber || submissionReference(target)} to DRAFT policy `
        + `${policyReference}.`
      );

      if (typeof onPolicyConverted === 'function') {
        onPolicyConverted({
          policyId: conversion.policyId,
          policyNumber: conversion.policyNumber,
          policyStatus: conversion.policyStatus,
          replayed: result.replayed,
          submissionId: target.submissionId,
          submissionNumber: target.submissionNumber,
          submissionReference: submissionReference(target)
        });
      } else {
        // Standalone use still lands on the created policy; the shell handles
        // the tab switch when it provides the callback.
        navigateTo(`/policy?record=${encodeURIComponent(conversion.policyId)}`);
      }
    } catch (e) {
      setConvertError(e.message);
    } finally {
      setConvertBusy(false);
    }
  }

  function applicantText(submission) {
    const label = submissionApplicantLabel(submission, applicantLabels);
    if (label) return label;
    return submission?.applicantPartyId ? shortId(submission.applicantPartyId) : '—';
  }

  const selectedActions = selected ? submissionActionsFor(selected.status) : [];
  const selectedNumber = selected ? submissionReference(selected) : '';
  const selectedConvertible = selected ? submissionCanConvert(selected.status) : false;
  const selectedReferral = selected?.referral || null;
  const selectedReferralPending = referralIsPending(selectedReferral);
  const selectedReferralCanOpen = Boolean(
    selected && referralCanBeOpened(selected.status, selectedReferral)
  );

  return (
    <section className="eia-submissions" data-testid="submissions-workspace">
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Policy · New business</div>
          <h1>Submissions</h1>
          <p className="subtitle">
            The underwriting queue before a policy exists. Record the applicant and requested
            terms, search and filter the queue, and move each submission through referral,
            quote, and bind.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct">NEW BUSINESS</span>
          <button
            type="button"
            className="eia-btn-ghost"
            data-testid="refresh-submissions"
            onClick={refreshWorkspace}
            disabled={loading}
          >
            Refresh
          </button>
          <button type="button" data-testid="new-submission" onClick={openCreateDialog}>
            New submission
          </button>
        </div>
      </header>

      {notice && <p role="status" data-testid="submissions-notice">{notice}</p>}

      <section
        className="eia-context-panel eia-submission-context"
        aria-label="Submissions context"
        data-testid="submissions-context"
      >
        <h4>Submissions precede policies</h4>
        <p>
          <b>A submission is the new-business opportunity, not a policy.</b> It records the
          applicant, product code, requested effective date, requested limit and currency, tort
          codes, and notes while underwriting is still in progress.
        </p>
        <p>
          <b>Quoting or binding a submission does not create a policy yet.</b> Moving a submission
          to QUOTED or BOUND records the underwriting position only. The policy record is created
          later, in the Policy domain, as a separate conversion.
        </p>
        <p>
          <b>Status actions update only this submission.</b> They never create, amend, quote, or
          bind a policy, and they never change policy coverage, limits, or premium.
        </p>
      </section>

      <section className="eia-submission-search" aria-label="Submission search and filters">
        <div className="eia-search-box">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search submissions by number, applicant, product, tort, or status…"
            aria-label="Search submissions"
            autoComplete="off"
          />
          {filterActive && (
            <button
              type="button"
              className="eia-queue-clear"
              onClick={() => {
                setQuery('');
                setStatusFilter('');
              }}
            >
              Clear
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter submissions by status"
        >
          <option value="">All statuses</option>
          {SUBMISSION_STATUSES.map((status) => (
            <option key={status} value={status}>
              {submissionStatusLabel(status)} ({status})
            </option>
          ))}
        </select>
      </section>

      <p className="eia-muted eia-submission-filter-meta" data-testid="submissions-filter-meta">
        {filterActive
          ? `${visibleSubmissions.length} of ${items.length} on this page match`
          : `${total} ${total === 1 ? 'submission' : 'submissions'} in the queue`}
      </p>

      {loadError && (
        <section className="eia-card eia-submission-load-error" role="alert" data-testid="submissions-load-error">
          <p>{loadError}</p>
          <button type="button" className="eia-btn-secondary" onClick={() => loadSubmissions(page)}>
            Retry
          </button>
        </section>
      )}

      <div className="eia-record-layout eia-submission-layout">
        <div>
          <aside className="eia-record-list eia-submission-queue" aria-label="Submission queue">
            <div className="eia-record-list-head">
              <strong>Submission queue</strong>
              <span className="eia-muted">
                {filterActive ? `${visibleSubmissions.length} of ${items.length}` : total}
              </span>
            </div>
            {loading && items.length === 0 && <div className="empty">Loading submissions…</div>}
            {!loading && visibleSubmissions.length === 0 && (
              <div className="empty" data-testid="submissions-empty">
                {filterActive
                  ? 'No submissions match the current search and status filter.'
                  : 'No submissions yet. Create a submission to start underwriting before a policy exists.'}
              </div>
            )}
            {visibleSubmissions.map((submission, index) => {
              const isSelected = selected?.submissionId === submission.submissionId;
              return (
                <div
                  key={submission.submissionId || `${submission.submissionNumber}-${index}`}
                  className={`eia-submission-row${isSelected ? ' selected' : ''}`}
                  data-testid="submission-row"
                >
                  <button
                    type="button"
                    aria-label={`Open submission ${submissionReference(submission)}`}
                    aria-pressed={isSelected}
                    onClick={() => openSubmission(submission)}
                  >
                    <span className="record-primary">{submissionReference(submission)}</span>
                    <span className="record-secondary">
                      Product {submission.productCode || '—'}
                      {' · '}
                      Requested {submission.requestedEffectiveDate || '—'}
                    </span>
                    <span className="eia-submission-row-status">
                      <span className={`eia-pill ${submissionStatusTone(submission.status)}`}>
                        {submission.status}
                      </span>
                      <span className="eia-muted">{limitText(submission)}</span>
                    </span>
                  </button>
                  <div className="eia-submission-row-party">
                    <span className="eia-muted">Applicant</span>
                    {submission.applicantPartyId ? (
                      <CrossLink
                        href={`/party?record=${submission.applicantPartyId}`}
                        title={`Open applicant party ${submission.applicantPartyId}`}
                        data-testid="submission-applicant-link"
                      >
                        {applicantText(submission)}
                      </CrossLink>
                    ) : (
                      <span className="eia-muted">—</span>
                    )}
                  </div>
                </div>
              );
            })}
          </aside>

          <nav
            aria-label="Submission pagination"
            className="eia-toolbar"
            style={{ marginTop: 10, marginBottom: 0, justifyContent: 'space-between' }}
          >
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={() => goToPage(page - 1)}
              disabled={page <= 0 || loading}
            >
              Previous
            </button>
            <span className="eia-muted">
              Page {page + 1} · {total} {total === 1 ? 'submission' : 'submissions'}
            </span>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={() => goToPage(page + 1)}
              disabled={!links?.next || loading}
            >
              Next
            </button>
          </nav>
        </div>

        <section className="eia-record-panel" aria-label="Submission detail">
          {!selected ? (
            <div className="eia-empty" data-testid="submission-detail-empty">
              Select a submission from the queue to see the applicant, requested terms, tort
              codes, notes, and allowed status actions. Status changes never create a policy.
            </div>
          ) : (
            <>
              <div className="eia-record-title">
                <div>
                  <h2 data-testid="submission-number">{selectedNumber}</h2>
                  <p className="eia-record-subtitle">
                    <span
                      className={`eia-pill ${submissionStatusTone(selected.status)}`}
                      data-testid="submission-status"
                    >
                      {selected.status}
                    </span>
                    {' · '}
                    Product {selected.productCode || '—'}
                    {' · '}
                    Requested effective {selected.requestedEffectiveDate || '—'}
                  </p>
                  <p className="eia-record-subtitle">
                    Applicant{' '}
                    {selected.applicantPartyId ? (
                      <CrossLink
                        href={`/party?record=${selected.applicantPartyId}`}
                        title={`Open applicant party ${selected.applicantPartyId}`}
                        data-testid="submission-detail-applicant-link"
                      >
                        {applicantText(selected)}
                      </CrossLink>
                    ) : '—'}
                  </p>
                  {selected.policyId ? (
                    <p className="eia-record-subtitle">
                      Policy{' '}
                      <CrossLink
                        href={`/policy?record=${selected.policyId}`}
                        title={`Open created policy ${selected.policyId}`}
                        data-testid="submission-detail-policy-link"
                      >
                        Open created policy
                      </CrossLink>
                    </p>
                  ) : null}
                </div>
                <div className="eia-actions">
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    data-testid="refresh-submission"
                    onClick={refreshSelectedSubmission}
                    disabled={detailLoading}
                  >
                    Refresh
                  </button>
                  <button type="button" className="eia-btn-ghost" onClick={closeSelected}>
                    Close
                  </button>
                </div>
              </div>

              {detailError && (
                <p role="alert" data-testid="submission-detail-error">
                  {detailError}
                </p>
              )}

              {detailLoading && <p className="eia-muted">Loading submission…</p>}

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Status</h3>
                  <div className="value" data-testid="submission-summary-status">
                    {selected.status}
                  </div>
                  <div className="eia-metric-label">{submissionStatusLabel(selected.status)}</div>
                </div>
                <div className="eia-card">
                  <h3>Requested limit</h3>
                  <div className="value">{limitText(selected)}</div>
                  <div className="eia-metric-label">
                    {selected.requestedLimitCurrency || '—'} requested
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Requested effective</h3>
                  <div className="value">{selected.requestedEffectiveDate || '—'}</div>
                  <div className="eia-metric-label">requested inception</div>
                </div>
                <div className="eia-card">
                  <h3>Received</h3>
                  <div className="value eia-submission-received">
                    {formatTimestamp(selected.receivedAt)}
                  </div>
                  <div className="eia-metric-label">submission received</div>
                </div>
              </div>

              <div className="eia-grid eia-grid-2">
                <section className="eia-card" aria-label="Submission fields">
                  <h3>Submission fields</h3>
                  <dl className="eia-kv" style={{ marginTop: 8 }}>
                    <dt>Submission number</dt>
                    <dd className="eia-mono">{selected.submissionNumber || '—'}</dd>
                    <dt>Submission id</dt>
                    <dd className="eia-mono">{selected.submissionId || '—'}</dd>
                    <dt>Status</dt>
                    <dd>
                      <span className={`eia-pill ${submissionStatusTone(selected.status)}`}>
                        {selected.status}
                      </span>
                    </dd>
                    <dt>Applicant party</dt>
                    <dd>
                      {selected.applicantPartyId ? (
                        <CrossLink
                          href={`/party?record=${selected.applicantPartyId}`}
                          title={`Open applicant party ${selected.applicantPartyId}`}
                        >
                          {applicantText(selected)}
                        </CrossLink>
                      ) : '—'}
                    </dd>
                    <dt>Product code</dt>
                    <dd>{selected.productCode || '—'}</dd>
                    <dt>Requested effective</dt>
                    <dd>{selected.requestedEffectiveDate || '—'}</dd>
                    <dt>Requested limit</dt>
                    <dd>{limitText(selected)}</dd>
                    <dt>Tort codes</dt>
                    <dd>
                      {selected.tortCodes.length ? (
                        <span className="eia-submission-torts">
                          {selected.tortCodes.map((code) => (
                            <span className="eia-pill blue" key={code}>{code}</span>
                          ))}
                        </span>
                      ) : '—'}
                    </dd>
                    <dt>Notes</dt>
                    <dd className="eia-submission-notes">{selected.notes || '—'}</dd>
                    <dt>Received</dt>
                    <dd>{formatTimestamp(selected.receivedAt)}</dd>
                    <dt>Last updated</dt>
                    <dd>{formatTimestamp(selected.updatedAt)}</dd>
                    <dt>Version</dt>
                    <dd>{selected.version ?? '—'}</dd>
                  </dl>
                </section>

                <section className="eia-card" aria-label="Submission status actions">
                  <h3>Status actions</h3>
                  <p className="eia-muted eia-submission-action-lede">
                    Allowed moves from <b>{selected.status}</b>. Each move records the next
                    underwriting status on this submission.
                  </p>
                  {selectedActions.length ? (
                    <div className="eia-submission-status-actions">
                      {selectedActions.map((entry) => (
                        <button
                          key={entry.status}
                          type="button"
                          className={entry.status === 'DECLINED' || entry.status === 'WITHDRAWN'
                            ? 'eia-btn-secondary'
                            : undefined}
                          data-testid={`submission-action-${entry.status.toLowerCase()}`}
                          onClick={() => openAction(entry)}
                        >
                          {entry.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="eia-submission-terminal" data-testid="submission-terminal">
                      <b>{submissionIsTerminal(selected.status) ? 'This submission is closed.' : 'No status actions are available.'}</b>
                      <span>
                        {selected.status === 'BOUND'
                          ? ' Binding records the underwriting position only; it does not create a policy. Convert the submission to create the DRAFT policy.'
                          : ' No further status actions are available for this submission.'}
                      </span>
                    </div>
                  )}
                  <p className="eia-submission-no-policy" data-testid="submission-no-policy">
                    <b>Quoting or binding does not create a policy yet.</b> The policy record is
                    created by the explicit Convert to policy action, which also binds the
                    submission.
                  </p>
                </section>
              </div>

              <section
                className="eia-card eia-submission-referral"
                aria-label="Submission referral"
                data-testid="submission-referral-panel"
              >
                <div className="eia-submission-referral-head">
                  <div>
                    <h3>Referral</h3>
                    <p className="eia-muted eia-submission-action-lede">
                      A referral records the underwriting decision request. Approving keeps the
                      submission REFERRED; declining also moves its lifecycle to DECLINED. A decision
                      never changes the requested terms and never creates a policy.
                    </p>
                  </div>
                  {selectedReferral && (
                    <span
                      className={`eia-pill ${referralStatusTone(selectedReferral.status)}`}
                      data-testid="referral-status"
                    >
                      {selectedReferral.status || 'UNKNOWN'}
                    </span>
                  )}
                </div>

                {selectedReferral ? (
                  <dl className="eia-kv eia-submission-referral-fields">
                    <dt>Reason</dt>
                    <dd data-testid="referral-reason">
                      {selectedReferral.reason
                        ? `${referralReasonLabel(selectedReferral.reason)} (${selectedReferral.reason})`
                        : '—'}
                    </dd>
                    <dt>Authority</dt>
                    <dd data-testid="referral-authority">{selectedReferral.authority || '—'}</dd>
                    <dt>Referred to</dt>
                    <dd data-testid="referral-referred-to" title={selectedReferral.referredTo}>
                      {personDisplay(selectedReferral.referredTo)}
                    </dd>
                    <dt>Notes</dt>
                    <dd className="eia-submission-notes" data-testid="referral-notes">
                      {selectedReferral.notes || '—'}
                    </dd>
                    <dt>Decided by</dt>
                    <dd data-testid="referral-decided-by" title={selectedReferral.decidedBy}>
                      {personDisplay(selectedReferral.decidedBy)}
                    </dd>
                    <dt>At</dt>
                    <dd data-testid="referral-at">{formatTimestamp(selectedReferral.at)}</dd>
                  </dl>
                ) : (
                  <p
                    className="eia-muted eia-submission-referral-empty"
                    data-testid="referral-empty"
                  >
                    No referral has been opened for this submission.
                  </p>
                )}

                {directoryError && (selectedReferral?.referredTo || selectedReferral?.decidedBy) ? (
                  <p
                    className="eia-muted eia-submission-referral-hint"
                    data-testid="referral-directory-unavailable"
                  >
                    The people directory is unavailable; person ids are shown instead of names.
                  </p>
                ) : null}

                {selectedReferralPending ? (
                  <div className="eia-submission-status-actions" data-testid="referral-actions">
                    <button
                      type="button"
                      data-testid="referral-approve"
                      onClick={() => openDecision('APPROVED')}
                    >
                      Approve referral
                    </button>
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      data-testid="referral-decline"
                      onClick={() => openDecision('DECLINED')}
                    >
                      Decline referral
                    </button>
                  </div>
                ) : selectedReferralCanOpen ? (
                  <div className="eia-submission-status-actions" data-testid="referral-actions">
                    <button type="button" data-testid="submission-refer" onClick={openReferral}>
                      {selectedReferral ? 'Refer again' : 'Refer'}
                    </button>
                  </div>
                ) : (
                  <p
                    className="eia-muted eia-submission-referral-hint"
                    data-testid="referral-unavailable"
                  >
                    {selectedReferral?.status === 'APPROVED'
                      ? 'The referral has been approved; no further referral is available for this submission.'
                      : 'Referral is available only while the submission is RECEIVED or REFERRED.'}
                  </p>
                )}

                <div
                  className="eia-submission-referral-history"
                  data-testid="referral-history"
                >
                  <div className="eia-submission-referral-history-head">
                    <h4>Referral history</h4>
                    <span className="eia-muted" data-testid="referral-history-count">
                      {referralHistoryLoading
                        ? '…'
                        : `${referralHistory.length} `
                          + `${referralHistory.length === 1 ? 'round' : 'rounds'}`}
                    </span>
                  </div>
                  <p className="eia-muted eia-submission-referral-history-lede">
                    Every referral round is kept append-only. Opening a referral adds a round;
                    its decision updates the pending round with the decider and timestamp.
                  </p>

                  {referralHistoryError ? (
                    <div
                      className="eia-submission-referral-history-error"
                      role="alert"
                      data-testid="referral-history-error"
                    >
                      <span>{referralHistoryError}</span>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        data-testid="referral-history-retry"
                        onClick={() => {
                          if (selected?.submissionId) {
                            loadReferralHistory(selected.submissionId).catch(() => {});
                          }
                        }}
                      >
                        Retry
                      </button>
                    </div>
                  ) : referralHistoryLoading ? (
                    <p
                      className="eia-muted eia-submission-referral-history-status"
                      data-testid="referral-history-loading"
                    >
                      Loading referral history…
                    </p>
                  ) : referralHistory.length === 0 ? (
                    <p
                      className="eia-muted eia-submission-referral-history-status"
                      data-testid="referral-history-empty"
                    >
                      No referral history has been recorded for this submission.
                    </p>
                  ) : (
                    <div className="eia-table-wrap" style={{ marginTop: 10 }}>
                      <table
                        className="eia-table eia-submission-referral-history-table"
                        aria-label="Referral history"
                        data-testid="referral-history-table"
                      >
                        <thead>
                          <tr>
                            <th>Reason</th>
                            <th>Authority</th>
                            <th>Referred to</th>
                            <th>Decision</th>
                            <th>Decided by</th>
                            <th>At</th>
                            <th>Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {referralHistory.map((entry, index) => (
                            <tr
                              key={entry.referralId || `referral-history-${index}`}
                              data-testid="referral-history-row"
                            >
                              <td data-testid="referral-history-reason">
                                {entry.reason
                                  ? `${referralReasonLabel(entry.reason)} (${entry.reason})`
                                  : '—'}
                              </td>
                              <td data-testid="referral-history-authority">
                                {entry.authority || '—'}
                              </td>
                              <td
                                data-testid="referral-history-referred-to"
                                title={entry.referredTo}
                              >
                                {personDisplay(entry.referredTo)}
                              </td>
                              <td data-testid="referral-history-decision">
                                <span className={`eia-pill ${referralStatusTone(entry.status)}`}>
                                  {entry.status || '—'}
                                </span>
                              </td>
                              <td
                                data-testid="referral-history-decided-by"
                                title={entry.decidedBy}
                              >
                                {personDisplay(entry.decidedBy)}
                              </td>
                              <td
                                className="eia-submission-referral-history-time"
                                data-testid="referral-history-at"
                              >
                                {formatTimestamp(entry.at)}
                              </td>
                              <td
                                className="eia-submission-referral-history-notes"
                                data-testid="referral-history-notes"
                              >
                                {entry.notes || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>

              <section
                className="eia-card eia-submission-convert"
                aria-label="Convert submission to policy"
                data-testid="submission-convert-panel"
              >
                <h3>Convert to policy</h3>
                <p className="eia-muted eia-submission-action-lede">
                  Conversion creates a <b>DRAFT</b> policy from this submission&apos;s applicant,
                  product, and requested limit, and <b>binds the submission</b>. The new policy
                  record is owned by the Policy domain; the submission keeps its own history.
                </p>
                {selectedConvertible ? (
                  <div className="eia-submission-status-actions">
                    <button
                      type="button"
                      data-testid="submission-convert"
                      onClick={openConvertDialog}
                    >
                      Convert to policy
                    </button>
                  </div>
                ) : (
                  <p
                    className="eia-muted eia-submission-convert-unavailable"
                    data-testid="submission-convert-unavailable"
                  >
                    {['RECEIVED', 'REFERRED'].includes(selected.status)
                      ? 'Convert to policy is available once the submission is quoted or bound.'
                      : 'This submission is closed and cannot be converted to a policy.'}
                  </p>
                )}
              </section>

              <section
                className="eia-context-panel"
                aria-label="Submission detail context"
                data-testid="submission-detail-context"
              >
                <h4>Submission context</h4>
                <p>
                  <b>This record is an underwriting submission.</b> It captures what the applicant
                  requested, not a bound policy or its coverage. The fields here are the submission
                  request, and the queue is the new-business pipeline.
                </p>
                <p>
                  <b>Status actions update only this submission.</b> Even BOUND means the
                  underwriting position is bound on the submission; the Policy domain creates the
                  policy record separately, with its own version, coverages, limits, and premium.
                </p>
                <p>
                  <b>Conversion is explicit.</b> Convert to policy on a QUOTED or BOUND submission
                  creates the DRAFT policy in the Policy domain and binds the submission; quoting or
                  binding the submission on its own never creates a policy record.
                </p>
                <p>
                  <b>The referral workflow is separate from the status actions.</b> A referral
                  records the reason, authority, directory decision owner, and notes. Approving keeps
                  the submission REFERRED; declining also moves its lifecycle to DECLINED.
                </p>
              </section>
            </>
          )}
        </section>
      </div>

      {createOpen && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-submission-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-create-dialog-title"
            aria-describedby="submission-create-dialog-description"
            data-testid="submission-create-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="submission-create-dialog-title">New submission</h2>
              <button
                type="button"
                className="eia-btn-ghost"
                onClick={closeCreateDialog}
                disabled={saving}
              >
                Close
              </button>
            </div>
            <p className="eia-modal-lede" id="submission-create-dialog-description">
              Record a new-business submission before a policy exists. The applicant, requested
              terms, tort codes, and notes stay on the submission.
            </p>

            {formError && (
              <p role="alert" data-testid="submission-form-error" className="eia-modal-error">
                {formError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitCreate}>
              <div className="eia-field span-3">
                <label>Applicant party</label>
                <EntityPicker
                  endpoint="/api/v1/parties/search"
                  value={form.applicantPartyId}
                  valueLabel={applicantLabel}
                  onChange={(id, item) => {
                    setForm((current) => ({ ...current, applicantPartyId: id || '' }));
                    setApplicantLabel(item
                      ? [item.label, item.secondary].filter(Boolean).join(' · ')
                      : '');
                  }}
                />
                <span className="eia-field-hint">
                  Predictive lookup over the Party catalog. The applicant must exist before a
                  submission can be created.
                </span>
              </div>

              {form.applicantPartyId && (
                <section
                  className="eia-card eia-selected-party span-3"
                  aria-label="Selected applicant party"
                >
                  <div className="eia-selected-party-meta">
                    <span className="eia-muted">Selected applicant party</span>
                    <b>{applicantLabel || shortId(form.applicantPartyId)}</b>
                    <code className="eia-mono">{form.applicantPartyId}</code>
                  </div>
                  <CrossLink
                    className="eia-selected-party-link"
                    href={`/party?record=${form.applicantPartyId}`}
                  >
                    Open party record
                  </CrossLink>
                </section>
              )}

              <div className="eia-field">
                <label htmlFor="submission-product">Product</label>
                <ProductPicker
                  id="submission-product"
                  value={form.productCode}
                  valueLabel={productLabel}
                  onChange={(code, product) => {
                    setForm((current) => ({ ...current, productCode: code || '' }));
                    setProductLabel(product ? productLabelFor(product) : '');
                  }}
                />
                <span className="eia-field-hint">
                  Search the active product catalog by code or name. The submission stores the
                  selected product code. If the catalog is empty, enter the code manually.
                </span>
              </div>

              <div className="eia-field">
                <label htmlFor="submission-requested-effective-date">Requested effective date</label>
                <input
                  id="submission-requested-effective-date"
                  type="date"
                  value={form.requestedEffectiveDate}
                  onChange={(event) => updateForm('requestedEffectiveDate', event.target.value)}
                  required
                />
              </div>

              <div className="eia-field">
                <label htmlFor="submission-limit">Requested limit</label>
                <input
                  id="submission-limit"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.requestedLimitAmount}
                  onChange={(event) => updateForm('requestedLimitAmount', event.target.value)}
                  required
                />
              </div>

              <div className="eia-field">
                <label htmlFor="submission-limit-currency">Limit currency</label>
                <input
                  id="submission-limit-currency"
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  placeholder="USD"
                  value={form.requestedLimitCurrency}
                  onChange={(event) => updateForm(
                    'requestedLimitCurrency',
                    event.target.value.toUpperCase()
                  )}
                  required
                />
              </div>

              <div className="eia-field span-3">
                <label htmlFor="submission-tort-codes">Tort codes</label>
                <input
                  id="submission-tort-codes"
                  placeholder="ASBESTOS, PFAS"
                  value={form.tortCodesInput}
                  onChange={(event) => updateForm('tortCodesInput', event.target.value)}
                />
                <span className="eia-field-hint">
                  Comma-separated codes. They record appetite and referral context on the
                  submission; they do not create coverage.
                </span>
              </div>

              <div className="eia-field span-3">
                <label htmlFor="submission-notes">Notes</label>
                <textarea
                  id="submission-notes"
                  rows={3}
                  maxLength={MAX_SUBMISSION_NOTES_LENGTH}
                  placeholder="Underwriting notes, loss history, or referral context"
                  value={form.notes}
                  onChange={(event) => updateForm('notes', event.target.value)}
                />
              </div>

              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" disabled={saving}>
                  {saving ? 'Creating…' : 'Create submission'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeCreateDialog}
                  disabled={saving}
                >
                  Cancel
                </button>
              </div>
            </form>

            <section
              className="eia-context-panel"
              aria-label="Create submission context"
              data-testid="submission-create-context"
            >
              <h4>No policy is created here</h4>
              <p>
                <b>Submissions precede policies.</b> Creating this record starts new-business
                underwriting. It does not create a policy, assign a policy number, or bind
                coverage.
              </p>
              <p>
                <b>The submission keeps its own status.</b> Quoting or binding later changes only
                this submission&apos;s underwriting position; the policy record is created
                separately after conversion.
              </p>
            </section>
          </div>
        </div>
      )}

      {action && selected && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-submission-status-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-status-dialog-title"
            aria-describedby="submission-status-dialog-description"
            data-testid="submission-status-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="submission-status-dialog-title">
                {action.label} · {selectedNumber}
              </h2>
              <span className={`eia-pill ${submissionStatusTone(selected.status)}`}>
                {selected.status}
              </span>
            </div>
            <p className="eia-modal-lede" id="submission-status-dialog-description">
              Move this submission from <b>{selected.status}</b> to <b>{action.status}</b>. The
              change records the underwriting position on the submission only.
            </p>

            {actionError && (
              <p role="alert" className="eia-modal-error" data-testid="submission-action-error">
                {actionError}
              </p>
            )}

            <form onSubmit={submitStatusChange}>
              <div className="eia-field">
                <label htmlFor="submission-status-reason">Reason (optional)</label>
                <textarea
                  id="submission-status-reason"
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this submission moving?"
                />
                <span className="eia-field-hint">
                  The reason is optional. When provided, it is recorded with the status action.
                </span>
              </div>
              <div className="eia-modal-actions">
                <button type="submit" disabled={actionBusy}>
                  {actionBusy ? 'Updating…' : `Move to ${action.status}`}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeAction}
                  disabled={actionBusy}
                >
                  Cancel
                </button>
              </div>
            </form>

            {action.status === 'REFERRED' && (
              <p
                className="eia-submission-referral-hint"
                data-testid="submission-action-referral-hint"
              >
                This move records the REFERRED status only. Open a referral from the Referral panel
                to record the reason, authority, directory person, and notes.
              </p>
            )}

            {['QUOTED', 'BOUND'].includes(action.status) && (
              <p className="eia-submission-no-policy" data-testid="submission-action-no-policy">
                <b>No policy is created by this action.</b> Quoting or binding a submission does not
                create a policy yet; use Convert to policy to create the DRAFT policy record.
              </p>
            )}
          </div>
        </div>
      )}

      {referralOpen && selected && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-submission-referral-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-referral-dialog-title"
            aria-describedby="submission-referral-dialog-description"
            data-testid="submission-referral-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="submission-referral-dialog-title">Refer submission · {selectedNumber}</h2>
              <span className={`eia-pill ${submissionStatusTone(selected.status)}`}>
                {selected.status}
              </span>
            </div>
            <p className="eia-modal-lede" id="submission-referral-dialog-description">
              Record why this submission needs a decision and who decides it. The referral starts
              <b> PENDING</b> and the submission moves to <b>REFERRED</b>.
            </p>

            {referralError && (
              <p role="alert" className="eia-modal-error" data-testid="referral-form-error">
                {referralError}
              </p>
            )}

            {directoryError && (
              <p role="alert" className="eia-modal-error" data-testid="referral-directory-error">
                {directoryError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitReferral}>
              <div className="eia-field">
                <label htmlFor="submission-referral-reason">Reason</label>
                <select
                  id="submission-referral-reason"
                  value={referralForm.reason}
                  onChange={(event) => updateReferral('reason', event.target.value)}
                >
                  <option value="">Select a reason…</option>
                  {REFERRAL_REASONS.map((entry) => (
                    <option key={entry.code} value={entry.code}>
                      {entry.label} ({entry.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className="eia-field">
                <label htmlFor="submission-referral-authority">Authority</label>
                <input
                  id="submission-referral-authority"
                  placeholder="e.g. Chief Underwriting Officer"
                  value={referralForm.authority}
                  onChange={(event) => updateReferral('authority', event.target.value)}
                />
                <span className="eia-field-hint">
                  The authority that will decide the referral, such as a role or committee.
                </span>
              </div>

              <div className="eia-field span-3">
                <label htmlFor="submission-referral-referred-to">Referred to</label>
                <DirectoryPersonPicker
                  id="submission-referral-referred-to"
                  people={directory.people}
                  value={referralForm.referredTo}
                  onChange={(person) => updateReferral('referredTo', person?.id || '')}
                  loading={directoryLoading}
                />
                <span className="eia-field-hint">
                  Directory person who owns the referral decision.
                </span>
                {directoryError && (
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    data-testid="referral-directory-retry"
                    onClick={() => ensureDirectory()}
                    disabled={directoryLoading}
                  >
                    Retry directory
                  </button>
                )}
              </div>

              <div className="eia-field span-3">
                <label htmlFor="submission-referral-notes">Notes (optional)</label>
                <textarea
                  id="submission-referral-notes"
                  rows={3}
                  maxLength={MAX_REFERRAL_NOTES_LENGTH}
                  placeholder="Referral context, conditions, or the decision requested"
                  value={referralForm.notes}
                  onChange={(event) => updateReferral('notes', event.target.value)}
                />
              </div>

              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" disabled={referralBusy}>
                  {referralBusy ? 'Opening referral…' : 'Refer submission'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeReferral}
                  disabled={referralBusy}
                >
                  Cancel
                </button>
              </div>
            </form>

            <section className="eia-context-panel" aria-label="Referral context">
              <h4>Referral is not a policy or a declination</h4>
              <p>
                <b>Opening a referral records the decision request.</b> The submission moves to
                REFERRED; its applicant, product, limits, and premium are unchanged.
              </p>
              <p>
                <b>Approval leaves the submission REFERRED; a decline also sets it DECLINED.</b>{' '}
                Neither decision changes the requested terms or creates a policy.
              </p>
            </section>
          </div>
        </div>
      )}

      {decision && selected && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-submission-referral-decision-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-referral-decision-title"
            aria-describedby="submission-referral-decision-description"
            data-testid="referral-decision-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="submission-referral-decision-title">
                {referralDecisionLabel(decision)} referral · {selectedNumber}
              </h2>
              <span className="eia-pill amber">PENDING</span>
            </div>
            <p className="eia-modal-lede" id="submission-referral-decision-description">
              The referral will be recorded as <b>{decision}</b>. The submission keeps its current
              status ({selected.status}); only the referral decision changes.
            </p>

            {decisionError && (
              <p role="alert" className="eia-modal-error" data-testid="referral-decision-error">
                {decisionError}
              </p>
            )}

            {directoryError && (
              <p role="alert" className="eia-modal-error" data-testid="referral-directory-error">
                {directoryError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitDecision}>
              <div className="eia-field span-3">
                <label htmlFor="submission-referral-decided-by">Decided by</label>
                <DirectoryPersonPicker
                  id="submission-referral-decided-by"
                  people={directory.people}
                  value={decisionForm.decidedBy}
                  onChange={(person) => updateDecision('decidedBy', person?.id || '')}
                  loading={directoryLoading}
                />
                <span className="eia-field-hint">
                  Directory person who made the referral decision.
                </span>
                {directoryError && (
                  <button
                    type="button"
                    className="eia-btn-secondary"
                    data-testid="referral-directory-retry"
                    onClick={() => ensureDirectory()}
                    disabled={directoryLoading}
                  >
                    Retry directory
                  </button>
                )}
              </div>

              <div className="eia-field span-3">
                <label htmlFor="submission-referral-decision-notes">Notes (optional)</label>
                <textarea
                  id="submission-referral-decision-notes"
                  rows={3}
                  maxLength={MAX_REFERRAL_NOTES_LENGTH}
                  placeholder="Decision conditions or rationale"
                  value={decisionForm.notes}
                  onChange={(event) => updateDecision('notes', event.target.value)}
                />
              </div>

              <div className="eia-field span-3 eia-modal-actions">
                <button
                  type="submit"
                  disabled={decisionBusy}
                  data-testid="referral-decision-submit"
                >
                  {decisionBusy ? 'Recording…' : `${referralDecisionLabel(decision)} referral`}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeDecision}
                  disabled={decisionBusy}
                >
                  Cancel
                </button>
              </div>
            </form>

            <section className="eia-context-panel" aria-label="Referral decision context">
              <h4>The submission status is separate</h4>
              <p>
                <b>This decision resolves the referral.</b>
                {decision === 'APPROVED'
                  ? ' Approval lets the submission continue through underwriting.'
                  : ' A declined referral leaves the submission open; decline or withdraw the submission separately.'}
              </p>
            </section>
          </div>
        </div>
      )}

      {convertOpen && selected && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-submission-modal eia-submission-convert-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-convert-dialog-title"
            aria-describedby="submission-convert-dialog-description"
            data-testid="submission-convert-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="submission-convert-dialog-title">
                Convert to policy · {selectedNumber}
              </h2>
              <span className={`eia-pill ${submissionStatusTone(selected.status)}`}>
                {selected.status}
              </span>
            </div>
            <p className="eia-modal-lede" id="submission-convert-dialog-description">
              Converting creates a <b>DRAFT</b> policy from this submission&apos;s applicant, product,
              and requested limit, and <b>binds the submission</b>. The premium and term entered here
              become the new policy&apos;s terms.
            </p>

            {convertError && (
              <p
                role="alert"
                className="eia-modal-error"
                data-testid="submission-convert-error"
              >
                {convertError}
              </p>
            )}

            <section
              className="eia-card eia-submission-convert-summary"
              aria-label="Conversion summary"
              data-testid="submission-convert-summary"
            >
              <dl className="eia-kv">
                <dt>Applicant</dt>
                <dd>{applicantText(selected)}</dd>
                <dt>Product</dt>
                <dd>{selected.productCode || '—'}</dd>
                <dt>Requested limit</dt>
                <dd>{limitText(selected)}</dd>
                <dt>Requested effective</dt>
                <dd>{selected.requestedEffectiveDate || '—'}</dd>
                <dt>Submission status</dt>
                <dd>
                  <span className={`eia-pill ${submissionStatusTone(selected.status)}`}>
                    {selected.status}
                  </span>
                </dd>
              </dl>
            </section>

            <form className="eia-form-grid" onSubmit={submitConversion}>
              <div className="eia-field">
                <label htmlFor="submission-convert-premium">Premium amount</label>
                <input
                  id="submission-convert-premium"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="125000.00"
                  value={convertForm.premiumAmount}
                  onChange={(event) => updateConversion('premiumAmount', event.target.value)}
                />
                <span className="eia-field-hint">
                  Written premium for the new policy. The submission&apos;s requested limit is not
                  copied into premium.
                </span>
              </div>

              <div className="eia-field">
                <label htmlFor="submission-convert-currency">Premium currency</label>
                <input
                  id="submission-convert-currency"
                  maxLength={3}
                  placeholder="USD"
                  value={convertForm.premiumCurrency}
                  onChange={(event) => updateConversion(
                    'premiumCurrency',
                    event.target.value.toUpperCase()
                  )}
                />
                <span className="eia-field-hint">Three-letter ISO 4217 code.</span>
              </div>

              <div className="eia-field">
                <label htmlFor="submission-convert-expiration">
                  Expiration date (optional)
                </label>
                <input
                  id="submission-convert-expiration"
                  type="date"
                  value={convertForm.expirationDate}
                  onChange={(event) => updateConversion('expirationDate', event.target.value)}
                />
                <span className="eia-field-hint">
                  Defaults to one year after the requested effective date. Leave blank to omit it
                  from the command.
                </span>
              </div>

              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" disabled={convertBusy}>
                  {convertBusy ? 'Converting…' : 'Convert to policy'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeConvertDialog}
                  disabled={convertBusy}
                >
                  Cancel
                </button>
              </div>
            </form>

            <section
              className="eia-context-panel"
              aria-label="Conversion context"
              data-testid="submission-convert-context"
            >
              <h4>Conversion creates the policy record</h4>
              <p>
                <b>The Policy domain creates a DRAFT policy and binds this submission.</b> The new
                policy starts with the submission&apos;s applicant, product, requested limit, and
                requested effective date; the premium and expiration you enter are its initial
                terms.
              </p>
              <p>
                <b>This is separate from the status actions.</b> Quoting or binding the submission
                records the underwriting position only. Conversion is the explicit hand-off that
                creates policy coverage, limits, premium, and version history.
              </p>
            </section>
          </div>
        </div>
      )}
    </section>
  );
}
