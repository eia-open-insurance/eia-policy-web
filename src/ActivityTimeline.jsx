import React from 'react';

export const ACTIVITY_LIMIT = 50;

/**
 * Aggregate activity is read from the platform event stream, keyed by the
 * policy id that owns the aggregate. The tenant travels in the request header
 * owned by the caller, so the path only carries the aggregate.
 */
export function activityEndpoint(policyId, limit = ACTIVITY_LIMIT) {
  return `/api/v1/events/aggregate/${encodeURIComponent(policyId)}?limit=${limit}`;
}

const WORD_SEPARATOR = /[._\-\s]+/;

/**
 * Turns ``policy.policy.created`` into ``Policy created``. Adjacent repeated
 * tokens are collapsed so the vertical prefix does not stutter, and every
 * separator style used by event names becomes a word break.
 */
export function readableEventType(eventType) {
  const words = String(eventType || '')
    .split(WORD_SEPARATOR)
    .map((word) => word.trim())
    .filter(Boolean);

  const deduped = [];
  for (const word of words) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.toLowerCase() === word.toLowerCase()) continue;
    deduped.push(word);
  }

  if (deduped.length === 0) return 'Event';
  return deduped
    .map((word, index) => {
      const lower = word.toLowerCase();
      return index === 0 ? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}` : lower;
    })
    .join(' ');
}

export function eventStatusTone(status) {
  const value = String(status || '').toUpperCase();
  if (['PROCESSED', 'APPLIED', 'ACCEPTED', 'COMPLETE', 'COMPLETED', 'SUCCEEDED'].includes(value)) {
    return 'green';
  }
  if (['FAILED', 'REJECTED', 'ERROR', 'DEAD_LETTERED', 'DEAD_LETTER'].includes(value)) {
    return 'red';
  }
  if (['RECEIVED', 'PENDING', 'IN_PROGRESS', 'RETRY', 'HELD', 'QUARANTINED'].includes(value)) {
    return 'amber';
  }
  return 'blue';
}

export function formatEventTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(date);
}

export function formatActivityMoney(amount, currency) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return currency ? `${amount} ${currency}` : String(amount);
  }
  if (!currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(numeric);
  } catch {
    return `${amount} ${currency}`;
  }
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readPath(source, path) {
  let current = source;
  for (const segment of path.split('.')) {
    const object = asObject(current);
    if (!object || !Object.prototype.hasOwnProperty.call(object, segment)) return undefined;
    current = object[segment];
  }
  return current;
}

function textValue(source, paths) {
  for (const path of paths) {
    const value = readPath(source, path);
    if (value === undefined || value === null) continue;
    if (typeof value === 'object') continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * The event service embeds the canonical envelope in ``payload``; the policy
 * facts live in its ``data`` object. Tests and future projections may also
 * send the data object directly, so both shapes are accepted.
 */
export function eventData(event) {
  const payload = asObject(event?.payload);
  if (!payload) return {};
  const data = asObject(payload.data);
  return data ? { ...payload, ...data } : payload;
}

function reasonLabel(eventType) {
  const value = String(eventType || '').toLowerCase();
  if (value.includes('cancel')) return 'Cancellation reason';
  if (value.includes('endorse')) return 'Endorsement reason';
  if (value.includes('reinstate')) return 'Reinstatement reason';
  return 'Reason';
}

/**
 * A timeline row stays legible at a glance: status transition first, then the
 * version, the reason a business user needs, and the money facts that changed.
 */
export function payloadFacts(event) {
  const data = eventData(event);
  const facts = [];

  const from = textValue(data, ['from', 'fromStatus', 'previousStatus', 'oldStatus', 'status.from']);
  const to = textValue(data, ['to', 'toStatus', 'newStatus', 'status.to']);
  const currentStatus = textValue(data, ['status', 'policyStatus']);

  if (from && to) {
    facts.push({ key: 'status', label: 'Status', value: `${from} → ${to}` });
  } else if (from) {
    facts.push({ key: 'status', label: 'Status', value: `${from} →` });
  } else if (to || currentStatus) {
    facts.push({ key: 'status', label: 'Status', value: to || currentStatus });
  }

  const version = textValue(data, [
    'policyVersionNumber',
    'versionNumber',
    'policyVersion',
    'version'
  ]) || (event?.aggregateVersion !== null && event?.aggregateVersion !== undefined
    ? String(event.aggregateVersion)
    : '');
  if (version) facts.push({ key: 'version', label: 'Version', value: version });

  const reason = textValue(data, [
    'reason',
    'cancellationReason',
    'endorsementReason',
    'reinstatementReason',
    'cancellation.reason',
    'endorsement.reason',
    'reinstatement.reason'
  ]);
  if (reason) {
    facts.push({ key: 'reason', label: reasonLabel(event?.eventType), value: reason });
  }

  const premiumAmount = textValue(data, ['premiumAmount', 'premium.amount']);
  if (premiumAmount) {
    facts.push({
      key: 'premium',
      label: 'Premium',
      value: formatActivityMoney(
        premiumAmount,
        textValue(data, ['premiumCurrency', 'premium.currency'])
      )
    });
  }

  const premiumDelta = textValue(data, [
    'premiumDeltaAmount',
    'premium.deltaAmount',
    'premiumDelta.amount'
  ]);
  if (premiumDelta) {
    facts.push({
      key: 'premium-delta',
      label: 'Premium delta',
      value: formatActivityMoney(
        premiumDelta,
        textValue(data, ['premiumDeltaCurrency', 'premiumDelta.currency', 'premiumCurrency'])
      )
    });
  }

  const returnPremium = textValue(data, [
    'returnPremiumAmount',
    'cancellation.returnPremiumAmount',
    'returnPremium.amount'
  ]);
  if (returnPremium) {
    facts.push({
      key: 'return-premium',
      label: 'Return premium',
      value: formatActivityMoney(
        returnPremium,
        textValue(data, ['returnPremiumCurrency', 'premiumCurrency', 'cancellation.premiumCurrency'])
      )
    });
  }

  const limitAmount = textValue(data, [
    'limitAmount',
    'limit.amount',
    'policyLimitAmount',
    'newLimitAmount'
  ]);
  if (limitAmount) {
    facts.push({
      key: 'limit',
      label: 'Limit',
      value: formatActivityMoney(limitAmount, textValue(data, ['limitCurrency', 'limit.currency']))
    });
  }

  return facts;
}

function occurredAtMillis(event) {
  const parsed = Date.parse(event?.occurredAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest first, matching the aggregate query. The aggregate version and event
 * id keep same-instant events deterministic across reloads.
 */
export function sortActivityItems(items) {
  return [...items].sort((left, right) => {
    const timeDiff = occurredAtMillis(right) - occurredAtMillis(left);
    if (timeDiff !== 0) return timeDiff;
    const versionDiff = Number(right?.aggregateVersion || 0) - Number(left?.aggregateVersion || 0);
    if (versionDiff !== 0) return versionDiff;
    return String(left?.eventId || '').localeCompare(String(right?.eventId || ''));
  });
}

function ActivityItem({ event }) {
  const status = event?.status ? String(event.status) : 'UNKNOWN';
  const facts = payloadFacts(event);

  return (
    <li className="eia-timeline-item" data-testid="activity-item">
      <div className="eia-timeline-head">
        <time
          className="eia-activity-time"
          dateTime={event?.occurredAt || undefined}
          title={event?.occurredAt || undefined}
          data-testid="activity-time"
        >
          {formatEventTimestamp(event?.occurredAt)}
        </time>
        <strong
          className="eia-activity-type"
          title={event?.eventType || undefined}
          data-testid="activity-type"
        >
          {readableEventType(event?.eventType)}
        </strong>
        <span
          className={`eia-pill ${eventStatusTone(status)}`}
          data-testid="activity-status"
        >
          {status}
        </span>
      </div>
      {facts.length > 0 && (
        <ul className="eia-activity-facts" aria-label="Event payload summary">
          {facts.map((fact) => (
            <li
              key={fact.key}
              className="eia-activity-fact"
              data-testid={`activity-fact-${fact.key}`}
            >
              <span className="eia-activity-fact-label">{fact.label}</span>{' '}
              <b>{fact.value}</b>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export default function ActivityTimeline({ items = [], loading = false, error = '', onRefresh }) {
  const countLabel = loading
    ? '…'
    : `${items.length} ${items.length === 1 ? 'event' : 'events'}`;

  return (
    <section
      className="eia-card eia-activity"
      data-testid="policy-activity"
      aria-label="Activity timeline"
    >
      <div className="eia-toolbar" style={{ marginBottom: 4 }}>
        <span className="eia-muted" data-testid="activity-count">{countLabel}</span>
        <span className="spacer" />
        <button
          type="button"
          className="eia-btn-secondary"
          onClick={() => {
            if (onRefresh) onRefresh();
          }}
          disabled={loading}
          aria-label="Refresh activity timeline"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <p
        className="eia-muted eia-activity-note"
        data-testid="activity-context-note"
        style={{ margin: 0 }}
      >
        Event-derived timeline: entries come from immutable policy events, are append-only,
        and are never edited or removed. The policy record remains the source of truth.
      </p>

      {loading ? (
        <p className="eia-muted" data-testid="activity-loading" style={{ margin: '12px 0 0' }}>
          Loading activity…
        </p>
      ) : error ? (
        <p className="eia-muted" data-testid="activity-error" style={{ margin: '12px 0 0' }}>
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="eia-empty" data-testid="activity-empty" style={{ marginTop: 12 }}>
          No activity has been recorded for this policy yet.
        </div>
      ) : (
        <ol
          className="eia-timeline"
          data-testid="activity-timeline"
          aria-label="Policy activity timeline"
        >
          {items.map((event, index) => (
            <ActivityItem key={event?.eventId || `activity-${index}`} event={event} />
          ))}
        </ol>
      )}
    </section>
  );
}
