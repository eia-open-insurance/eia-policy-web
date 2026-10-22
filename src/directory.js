import { api, problemMessage } from './api.js';

/**
 * Shared public people directory (`GET /api/v1/directory`).
 *
 * The endpoint is gateway master data and is not tenant scoped, so it is read
 * without the X-EIA-Tenant header. The app loads it once, lazily, when a
 * referral picker first opens, and every later consumer reuses the in-memory
 * value. A failed lookup is not cached, so reopening a dialog retries instead
 * of pinning the app to a transient outage.
 */
export const DIRECTORY_ENDPOINT = '/api/v1/directory';

let cachedDirectory = null;
let pendingDirectory = null;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function teamCode(team) {
  if (typeof team === 'string') return team.trim();
  if (team && typeof team === 'object') return text(team.code) || text(team.value);
  return '';
}

function humanizeCode(code) {
  const words = code.replace(/_/g, ' ').toLowerCase();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : code;
}

/**
 * Normalizes the directory payload into the people and team shapes the
 * referral pickers use. A bare array of people is accepted, and a person
 * without a usable name is dropped rather than rendered as an unnameable
 * option.
 */
export function normalizeDirectory(payload) {
  const rawPeople = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.people)
      ? payload.people
      : [];

  const people = rawPeople
    .map((person) => {
      if (!person || typeof person !== 'object') return null;
      const displayName = text(person.displayName) || text(person.name);
      const id = text(person.id) || displayName;
      if (!displayName || !id) return null;
      const rawTeams = Array.isArray(person.teams)
        ? person.teams
        : Array.isArray(person.teamCodes)
          ? person.teamCodes
          : [];
      const teams = [];
      for (const entry of rawTeams) {
        const code = teamCode(entry);
        if (code && !teams.includes(code)) teams.push(code);
      }
      return {
        id,
        displayName,
        email: text(person.email),
        role: text(person.role),
        teams
      };
    })
    .filter(Boolean);

  const rawTeams = Array.isArray(payload?.teams) ? payload.teams : [];
  const seen = new Set();
  const teams = [];
  for (const entry of rawTeams) {
    const code = teamCode(entry);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const label = entry && typeof entry === 'object' ? text(entry.label) || text(entry.name) : '';
    teams.push({ code, label: label || humanizeCode(code) });
  }

  return { people, teams };
}

/**
 * Resolves the directory people once. A concurrent caller joins the in-flight
 * request instead of issuing a second read.
 */
export function loadDirectory() {
  if (cachedDirectory) return Promise.resolve(cachedDirectory);
  if (pendingDirectory) return pendingDirectory;
  pendingDirectory = api(DIRECTORY_ENDPOINT, { tenant: false })
    .then(({ response, body }) => {
      if (!response.ok) {
        throw new Error(
          problemMessage(body, `Directory load failed: ${response.status}`)
        );
      }
      cachedDirectory = normalizeDirectory(body);
      return cachedDirectory;
    })
    .finally(() => {
      pendingDirectory = null;
    });
  return pendingDirectory;
}

/** Synchronous read for a screen that mounted after the directory settled. */
export function getCachedDirectory() {
  return cachedDirectory;
}

/** Test and shell hooks for reading/clearing the process-local cache. */
export function resetDirectoryCache() {
  cachedDirectory = null;
  pendingDirectory = null;
}

/** Display name for a recorded directory person id, empty when it is unknown. */
export function directoryPersonName(people, id) {
  const key = text(id);
  if (!key || !Array.isArray(people)) return '';
  const person = people.find((entry) => entry.id === key);
  return person ? person.displayName : '';
}
