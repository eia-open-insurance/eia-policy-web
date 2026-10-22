/**
 * Related notifications for a policy record.
 *
 * A notification is a delivery artifact owned by the Notifications vertical.
 * Policy reads the notifications whose `sourceType`/`sourceId` point at the
 * selected policy and shows them as read-only context: the card never creates,
 * sends, or changes a notification, and a failed lookup never blocks the policy
 * record itself.
 */

/** The Overview preview shows only the newest few; the count keeps the total. */
export const RELATED_NOTIFICATION_LIMIT = 3;

/**
 * GET /api/v1/notifications?sourceType=POLICY&sourceId=<policyId>.
 * The tenant travels in the X-EIA-Tenant header owned by the caller.
 */
export function policyNotificationsEndpoint(policyId) {
  if (!policyId) return '';
  const params = new URLSearchParams();
  params.set('sourceType', 'POLICY');
  params.set('sourceId', policyId);
  return `/api/v1/notifications?${params.toString()}`;
}

/** Notifications are opened in their own workbench by record id. */
export function notificationRecordHref(notificationId) {
  if (!notificationId) return '/notifications';
  return `/notifications?record=${encodeURIComponent(notificationId)}`;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

/**
 * Only the fields the Overview card renders are normalized. A row without an
 * id cannot be linked, so it is dropped instead of shown as unlinked noise.
 */
function normalizeNotification(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = firstText(row.id, row.notificationId);
  if (!id) return null;
  return {
    id,
    notificationNumber: firstText(
      row.notificationNumber,
      row.number,
      row.reference,
      row.subject,
      id
    ),
    subject: firstText(row.subject, row.title, row.notificationSubject),
    status: firstText(row.status).toUpperCase(),
    createdAt: firstText(row.createdAt, row.createdOn, row.created)
  };
}

/**
 * Tolerant read of GET /api/v1/notifications: a bare array or an `{items}`
 * envelope during rollout.
 */
export function normalizePolicyNotifications(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : [];
  return rows
    .map((row) => normalizeNotification(row))
    .filter((row) => row !== null);
}

/**
 * The card count is the total number of related notifications, which can be
 * larger than the three-row preview. A page envelope may carry `total`; a bare
 * array and a truncated payload fall back to the rows that are present.
 */
export function notificationCount(body, items) {
  const rows = Array.isArray(items) ? items : [];
  const total = Number(body?.total);
  return Number.isInteger(total) && total >= rows.length ? total : rows.length;
}

function createdMillis(notification) {
  const parsed = Date.parse(notification?.createdAt);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * Newest first. The notification number breaks same-instant ties so the
 * three-row preview is deterministic across reloads.
 */
export function sortNotificationsNewest(items) {
  return [...(Array.isArray(items) ? items : [])].sort((left, right) => {
    const timeDiff = createdMillis(right) - createdMillis(left);
    if (timeDiff !== 0) return timeDiff;
    return String(right?.notificationNumber || '')
      .localeCompare(String(left?.notificationNumber || ''));
  });
}

export function newestNotifications(items, limit = RELATED_NOTIFICATION_LIMIT) {
  const size = Number.isInteger(limit) && limit > 0 ? limit : RELATED_NOTIFICATION_LIMIT;
  return sortNotificationsNewest(items).slice(0, size);
}

/**
 * Mirrors the Notifications workbench status tone so a SENT message reads as
 * successful and a FAILED/CANCELLED one reads as a delivery problem.
 */
export function notificationStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (['SENT', 'DELIVERED', 'READ', 'ACKNOWLEDGED', 'ACTIONED'].includes(normalized)) {
    return 'green';
  }
  if (['FAILED', 'EXPIRED', 'CANCELLED'].includes(normalized)) return 'red';
  if (['QUEUED', 'SUPPRESSED'].includes(normalized)) return 'amber';
  return 'blue';
}

/** UTC keeps the card stable in tests and across operator time zones. */
export function formatNotificationTimestamp(value) {
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

export function emptyPolicyNotificationsState() {
  return { items: [], count: 0, loading: false, error: '' };
}
