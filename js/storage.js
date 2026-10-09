/*
 * storage.js — LocalStorage persistence.
 *
 * The full game state is saved after every action, so a reload resumes the
 * run and "Restart" can rebuild the same dungeon from the saved seed.
 * Storage can be unavailable (private mode, blocked site data), so every
 * access is guarded and the game simply runs unsaved in that case.
 */
(function (Scoundrel) {
  'use strict';

  const SAVE_KEY = 'scoundrel.save.v1';
  const RECORDS_KEY = 'scoundrel.records.v1';

  function read(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function saveGame(state) {
    return write(SAVE_KEY, state);
  }

  function loadGame() {
    const state = read(SAVE_KEY);
    return Scoundrel.game.isValidState(state) ? state : null;
  }

  function loadRecords() {
    const r = read(RECORDS_KEY);
    return {
      played: (r && r.played) || 0,
      wins: (r && r.wins) || 0,
      best: r && typeof r.best === 'number' ? r.best : null
    };
  }

  /** Record a finished game; returns the updated records and whether it set a new best. */
  function recordResult(score, won) {
    const records = loadRecords();
    records.played += 1;
    if (won) records.wins += 1;
    const isBest = records.best === null || score > records.best;
    if (isBest) records.best = score;
    write(RECORDS_KEY, records);
    return { records, isBest };
  }

  Scoundrel.storage = { saveGame, loadGame, loadRecords, recordResult };
})(window.Scoundrel = window.Scoundrel || {});
