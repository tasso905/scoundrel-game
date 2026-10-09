/*
 * main.js — app controller.
 *
 * Owns the single `state` object, routes input (pointer and keyboard) to the
 * rules engine, saves after every change, and manages dialogs and focus.
 */
(function (Scoundrel) {
  'use strict';

  const { game: Game, storage: Storage, render: Render, rng, deck: Deck } = Scoundrel;

  const $ = (id) => document.getElementById(id);
  const roomGrid = $('room-grid');
  const avoidBtn = $('btn-avoid');
  const avoidReason = $('avoid-reason');
  const helpDialog = $('help-dialog');
  const endDialog = $('end-dialog');
  const confirmDialog = $('confirm-dialog');
  const debugPanel = $('debug-panel');
  const debugBtn = $('btn-debug');

  const DEBUG_PREF_KEY = 'scoundrel.debug';
  const LEAVE_MS = 220; // matches the .is-leaving animation in styles.css
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  let state = null;
  let busy = false; // true while a card's exit animation plays

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                          */
  /* ------------------------------------------------------------------ */

  function startGame(seed, options) {
    state = Game.newGame(seed);
    state.recorded = false;
    busy = false;
    Render.resetRoomMemory();
    commit();
    if (!options || options.focus !== false) focusFirstAction();
  }

  function commit(result) {
    Storage.saveGame(state);
    Render.renderAll(state);
    Render.feedback(result);
    if (state.status !== 'playing' && !state.recorded) finishGame(result);
  }

  function finishGame(result) {
    const won = state.status === 'won';
    const { records, isBest } = Storage.recordResult(state.score, won);
    state.recorded = true;
    Storage.saveGame(state);

    $('end-banner').dataset.outcome = state.status;
    $('end-title').textContent = won ? 'Dungeon cleared!' : 'You were slain';
    $('end-score').textContent = formatScore(state.score);

    if (won) {
      $('end-summary').textContent =
        'You made it through all ' + state.turn + ' rooms with ' + state.health + ' health to spare.';
    } else {
      const monsters = state.deck.concat(Game.roomCards(state)).filter((c) => c.type === 'monster');
      const killer = result && result.card ? ' by ' + Deck.label(result.card) : '';
      $('end-summary').textContent =
        'Slain in room ' + state.turn + killer + '. ' + monsters.length + ' monsters remained, worth ' +
        Game.remainingMonsterTotal(state) + ' in total.';
    }

    $('end-records').textContent =
      (isBest ? 'New best score! ' : 'Best: ' + formatScore(records.best) + ' · ') +
      'Wins: ' + records.wins + ' of ' + records.played + ' games.';

    // Let the final card animation land before the modal takes over.
    window.setTimeout(() => openDialog(endDialog), reducedMotion.matches ? 0 : 450);
  }

  function formatScore(score) {
    return score < 0 ? '−' + Math.abs(score) : String(score);
  }

  function isInProgress() {
    return state.status === 'playing' && (state.turn > 1 || state.resolvedThisRoom > 0);
  }

  function requestNewGame(seed) {
    const go = () => startGame(seed);
    if (!isInProgress()) return go();
    confirmAction('Start a new game?', 'Your current run will be abandoned.', 'New game').then((ok) => ok && go());
  }

  function requestRestart() {
    const go = () => startGame(state.seed);
    if (!isInProgress()) return go();
    confirmAction(
      'Restart this dungeon?',
      'You will start over with the same deck order (seed ' + rng.formatSeed(state.seed) + ').',
      'Restart'
    ).then((ok) => ok && go());
  }

  /* ------------------------------------------------------------------ */
  /* Player actions                                                     */
  /* ------------------------------------------------------------------ */

  function resolveCard(slot, mode) {
    if (busy || state.status !== 'playing') return;
    const actions = Game.cardActions(state, slot);
    if (!actions.length || (mode && !actions.some((a) => a.mode === mode))) return;

    const hadFocus = roomGrid.contains(document.activeElement);
    const cardEl = roomGrid.querySelector('.slot[data-slot="' + slot + '"] .card');
    const run = () => {
      busy = false;
      const result = Game.resolve(state, slot, mode);
      commit(result);
      if (hadFocus || result.newRoom) focusAfterResolve(slot, result);
    };

    if (reducedMotion.matches || !cardEl) return run();
    busy = true;
    cardEl.classList.add('is-leaving');
    window.setTimeout(run, LEAVE_MS);
  }

  function avoidRoom() {
    if (busy) return;
    const result = Game.avoid(state);
    if (!result.ok) {
      Render.pulse(avoidReason, 'is-nudged');
      return;
    }
    commit(result);
  }

  /* ------------------------------------------------------------------ */
  /* Focus management                                                   */
  /* ------------------------------------------------------------------ */

  function actionButtons() {
    return Array.from(roomGrid.querySelectorAll('.action'));
  }

  /** Only take focus if it was lost (e.g. its button was removed); never steal it from a control. */
  function focusFirstAction() {
    const active = document.activeElement;
    const focusLost = !active || active === document.body || !document.contains(active);
    if (!focusLost && !roomGrid.contains(active)) return;
    const first = actionButtons()[0];
    if (first) first.focus({ preventScroll: true });
  }

  /** After a card is resolved its buttons vanish; move focus somewhere sensible. */
  function focusAfterResolve(slot, result) {
    if (state.status !== 'playing') return;
    const buttons = actionButtons();
    if (!buttons.length) return;
    if (result.newRoom) {
      buttons[0].focus({ preventScroll: true });
      return;
    }
    const next =
      buttons.find((b) => Number(b.dataset.slot) > slot) ||
      buttons.find((b) => Number(b.dataset.slot) < slot);
    (next || buttons[0]).focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------------ */
  /* Dialogs                                                            */
  /* ------------------------------------------------------------------ */

  function openDialog(dialog) {
    if (dialog.open) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function closeDialog(dialog) {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function anyDialogOpen() {
    return [helpDialog, endDialog, confirmDialog].some((d) => d.open);
  }

  function confirmAction(title, text, okLabel) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const ok = $('confirm-ok');
    ok.textContent = okLabel;

    return new Promise((resolve) => {
      let confirmed = false;
      const onOk = () => {
        confirmed = true;
        closeDialog(confirmDialog);
      };
      ok.addEventListener('click', onOk, { once: true });
      confirmDialog.addEventListener(
        'close',
        () => {
          ok.removeEventListener('click', onOk);
          resolve(confirmed);
        },
        { once: true }
      );
      openDialog(confirmDialog);
      ok.focus();
    });
  }

  function bindDialogs() {
    [helpDialog, endDialog, confirmDialog].forEach((dialog) => {
      dialog.addEventListener('click', (e) => {
        // Clicking the backdrop (the dialog element itself, outside its content) closes it.
        if (e.target === dialog) closeDialog(dialog);
        if (e.target.closest('[data-close]')) closeDialog(dialog);
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Debug panel                                                        */
  /* ------------------------------------------------------------------ */

  function setDebugOpen(open) {
    debugPanel.hidden = !open;
    debugBtn.setAttribute('aria-expanded', String(open));
    try {
      window.localStorage.setItem(DEBUG_PREF_KEY, open ? '1' : '0');
    } catch (err) {
      /* storage unavailable: preference just won't persist */
    }
    if (open) Render.renderDebug(state);
  }

  function initialDebugOpen() {
    if (/[?&]debug\b/.test(window.location.search)) return true;
    try {
      return window.localStorage.getItem(DEBUG_PREF_KEY) === '1';
    } catch (err) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                              */
  /* ------------------------------------------------------------------ */

  function onKeydown(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    if (anyDialogOpen()) return; // native <dialog> handles Esc and traps focus
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

    // Use e.code for digits so Shift+1 still reads as "1" on any layout.
    const digit = /^(Digit|Numpad)([1-4])$/.exec(e.code);
    if (digit) {
      e.preventDefault();
      const slot = Number(digit[2]) - 1;
      resolveCard(slot, e.shiftKey ? 'barehanded' : undefined);
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'a') avoidRoom();
    else if (key === 'n') requestNewGame();
    else if (key === 'r') requestRestart();
    else if (key === 'h' || key === '?') openDialog(helpDialog);
    else return;
    e.preventDefault();
  }

  function bindControls() {
    $('btn-new').addEventListener('click', () => requestNewGame());
    $('btn-restart').addEventListener('click', requestRestart);
    $('btn-help').addEventListener('click', () => openDialog(helpDialog));
    avoidBtn.addEventListener('click', avoidRoom);

    roomGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('button.action');
      if (btn) resolveCard(Number(btn.dataset.slot), btn.dataset.mode);
    });

    // "New game" / "Replay" buttons in the game-over panel and end dialog.
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const dialog = btn.closest('dialog');
      if (dialog) closeDialog(dialog);
      startGame(btn.dataset.action === 'restart' ? state.seed : undefined);
    });

    debugBtn.addEventListener('click', () => setDebugOpen(debugPanel.hidden));
    $('debug-reveal').addEventListener('change', () => Render.renderDebug(state));
    $('seed-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('seed-input');
      const seed = rng.parseSeed(input.value);
      if (seed === null) {
        input.focus();
        return;
      }
      input.value = '';
      requestNewGame(seed);
    });

    document.addEventListener('keydown', onKeydown);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                               */
  /* ------------------------------------------------------------------ */

  function init() {
    bindControls();
    bindDialogs();

    const saved = Storage.loadGame();
    if (saved) {
      state = saved;
      if (state.recorded === undefined) state.recorded = state.status !== 'playing';
      Render.renderAll(state);
    } else {
      startGame(undefined, { focus: false });
    }
    setDebugOpen(initialDebugOpen());
  }

  init();
})(window.Scoundrel = window.Scoundrel || {});
