/*
 * render.js — turns game state into DOM.
 *
 * Rendering is mostly "rebuild from state", which keeps the UI honest. Two
 * pieces are incremental on purpose:
 *   - the room tracks which cards were already on screen, so only newly
 *     dealt cards play the flip animation;
 *   - the action log only appends new entries, so the ARIA live region
 *     announces each event once instead of re-reading the whole history.
 */
(function (Scoundrel) {
  'use strict';

  const { game: Game, deck: Deck, rng } = Scoundrel;

  const $ = (id) => document.getElementById(id);

  const el = {
    healthPanel: $('hud-health'),
    healthValue: $('health-value'),
    healthMeter: $('health-meter'),
    healthFill: $('health-fill'),
    weaponPanel: $('hud-weapon'),
    weaponChip: $('weapon-chip'),
    weaponValue: $('weapon-value'),
    weaponLast: $('weapon-last'),
    weaponStack: $('weapon-stack'),
    statTurn: $('stat-turn'),
    statDeck: $('stat-deck'),
    statDiscard: $('stat-discard'),
    hudFlags: $('hud-flags'),
    roomHeading: $('room-heading'),
    roomStatus: $('room-status'),
    roomGrid: $('room-grid'),
    avoidBtn: $('btn-avoid'),
    avoidReason: $('avoid-reason'),
    gameOver: $('game-over'),
    gameOverTitle: $('game-over-title'),
    log: $('log'),
    debugSeed: $('debug-seed'),
    debugSummary: $('debug-summary'),
    debugDeck: $('debug-deck'),
    debugReveal: $('debug-reveal')
  };

  const TYPE_NAMES = { monster: 'Monster', weapon: 'Weapon', potion: 'Potion' };

  let visibleCardIds = new Set(); // cards on screen after the previous render
  let renderedGameId = null;
  let renderedLogLastId = 0;

  /* ------------------------------------------------------------------ */
  /* Small DOM helper                                                   */
  /* ------------------------------------------------------------------ */

  function h(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const v = attrs[key];
        if (v == null || v === false) return;
        if (key === 'class') node.className = v;
        else if (key === 'text') node.textContent = v;
        else if (key === 'style') node.setAttribute('style', v);
        else node.setAttribute(key, v === true ? '' : v);
      });
    }
    (children || []).forEach((child) => {
      if (child == null || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                */
  /* ------------------------------------------------------------------ */

  function renderHUD(state) {
    const max = Game.MAX_HEALTH;
    const pct = Math.max(0, Math.min(100, (state.health / max) * 100));
    el.healthValue.textContent = state.health;
    el.healthFill.style.width = pct + '%';
    el.healthMeter.setAttribute('aria-valuenow', String(state.health));
    el.healthMeter.setAttribute('aria-valuetext', state.health + ' of ' + max + ' health');
    el.healthPanel.dataset.level = state.health <= 5 ? 'critical' : state.health <= 10 ? 'low' : 'ok';

    const w = state.weapon;
    if (w) {
      el.weaponChip.textContent = Deck.label(w.card);
      el.weaponChip.classList.add('is-equipped');
      el.weaponValue.textContent = String(Deck.value(w.card)) + ' (' + Deck.label(w.card) + ')';
      el.weaponLast.textContent = w.lastDefeated === null ? '—' : String(w.lastDefeated);
    } else {
      el.weaponChip.textContent = '—';
      el.weaponChip.classList.remove('is-equipped');
      el.weaponValue.textContent = 'Bare hands';
      el.weaponLast.textContent = '—';
    }
    el.weaponStack.replaceChildren(
      ...(w ? w.stack : []).map((m) =>
        h('li', { class: 'stack-chip', 'aria-label': Deck.spokenName(m) }, [Deck.label(m)])
      )
    );
    el.weaponStack.hidden = !w || w.stack.length === 0;

    el.statTurn.textContent = state.turn;
    el.statDeck.textContent = state.deck.length;
    el.statDiscard.textContent = state.discard.length;

    const flags = [];
    flags.push(state.potionUsedThisRoom ? 'Potion used this room' : 'Potion available');
    if (state.avoidedLastRoom) flags.push('Avoided last room');
    el.hudFlags.textContent = flags.join(' · ');
  }

  /* ------------------------------------------------------------------ */
  /* Room                                                               */
  /* ------------------------------------------------------------------ */

  function renderRoom(state) {
    el.roomHeading.textContent = 'Room ' + state.turn;

    const left = Game.cardsLeftToResolve(state);
    const remaining = Game.roomCards(state).length;
    if (state.status === 'won') {
      el.roomStatus.textContent = 'Every card in the dungeon has been resolved.';
    } else if (state.status === 'lost') {
      el.roomStatus.textContent = 'Your adventure ends here.';
    } else if (remaining > left) {
      el.roomStatus.textContent =
        'Resolve ' + left + ' more ' + (left === 1 ? 'card' : 'cards') + '. The last one carries into the next room.';
    } else {
      el.roomStatus.textContent =
        'Final cards: resolve all ' + left + ' to clear the dungeon.';
    }

    renderAvoid(state);

    const nowVisible = new Set();
    let dealIndex = 0;
    const slots = state.room.map((card, slot) => {
      if (!card) {
        return h('li', { class: 'slot slot--empty' }, [
          h('div', { class: 'card-placeholder', 'aria-hidden': 'true' }, [
            state.status === 'playing' ? 'Resolved' : ''
          ])
        ]);
      }
      nowVisible.add(card.id);
      const isNew = !visibleCardIds.has(card.id);
      const carried = card.id === state.carriedId;
      return h('li', { class: 'slot slot--' + card.type, 'data-slot': slot }, [
        renderCard(card, slot, { isNew, dealIndex: isNew ? dealIndex++ : 0, carried }),
        renderActions(state, card, slot)
      ]);
    });

    el.roomGrid.replaceChildren(...slots);
    visibleCardIds = nowVisible;

    el.gameOver.hidden = state.status === 'playing';
    if (state.status !== 'playing') {
      el.gameOverTitle.textContent =
        state.status === 'won'
          ? 'Dungeon cleared with ' + state.health + ' health. Score ' + state.score + '.'
          : 'Slain in room ' + state.turn + '. Score ' + state.score + '.';
    }
  }

  function renderAvoid(state) {
    el.avoidBtn.parentElement.hidden = state.status !== 'playing';
    const status = Game.avoidStatus(state);
    el.avoidBtn.setAttribute('aria-disabled', String(!status.allowed));
    el.avoidBtn.classList.toggle('is-disabled', !status.allowed);
    el.avoidReason.textContent = status.allowed ? 'Send all 4 cards under the dungeon.' : status.reason;
  }

  function renderCard(card, slot, opts) {
    const type = card.type;
    const value = Deck.value(card);
    const rank = Deck.rankLabel(card);
    const sym = Deck.symbol(card);
    const art = Deck.art(card);
    const label =
      'Slot ' + (slot + 1) + ': ' + Deck.spokenName(card) + ', ' + type + ', value ' + value +
      (opts.carried ? ', carried from the last room' : '');

    const corner = (pos) =>
      h('span', { class: 'card-corner card-corner--' + pos, 'aria-hidden': 'true' }, [
        h('span', { class: 'card-rank', text: rank }),
        h('span', { class: 'card-suit', text: sym })
      ]);

    return h(
      'article',
      {
        class: 'card card--' + type + (opts.isNew ? ' is-dealing' : ''),
        'data-suit': card.suit,
        'aria-label': label,
        style: '--deal-index:' + opts.dealIndex
      },
      [
        h('div', { class: 'card-inner' }, [
          h('div', { class: 'card-face card-front' + (art ? ' has-art' : '') }, [
            art ? h('img', { class: 'card-art', src: art, alt: '', draggable: 'false' }) : null,
            corner('top'),
            art ? null : h('span', { class: 'card-pip', 'aria-hidden': 'true', text: sym }),
            h('span', { class: 'card-type', 'aria-hidden': 'true' }, [
              TYPE_NAMES[type],
              h('span', { class: 'card-value', text: String(value) })
            ]),
            corner('bottom'),
            opts.carried ? h('span', { class: 'card-badge', 'aria-hidden': 'true', text: 'Carried' }) : null
          ]),
          h('div', { class: 'card-face card-back', 'aria-hidden': 'true' })
        ])
      ]
    );
  }

  function renderActions(state, card, slot) {
    const actions = Game.cardActions(state, slot);
    const name = Deck.spokenName(card);
    const buttons = actions.map((action, i) => {
      const d = describeAction(state, card, action);
      const lethal = typeof action.damage === 'number' && action.damage >= state.health;
      return h(
        'button',
        {
          type: 'button',
          class: 'action action--' + action.mode + (i === 0 ? ' action--primary' : '') + (lethal ? ' is-lethal' : ''),
          'data-slot': slot,
          'data-mode': action.mode,
          'aria-label': d.verb + ' ' + name + (d.spokenDetail ? ', ' + d.spokenDetail : '') + (lethal ? ', lethal' : ''),
          'aria-keyshortcuts': i === 0 ? String(slot + 1) : action.mode === 'barehanded' ? 'Shift+' + (slot + 1) : null
        },
        [
          h('span', { class: 'action-main' }, [
            h('span', { class: 'action-verb', text: d.title }),
            i === 0 ? h('kbd', { 'aria-hidden': 'true', text: String(slot + 1) }) : null
          ]),
          h('span', { class: 'action-detail', text: lethal ? d.detail + ' · lethal' : d.detail })
        ]
      );
    });

    const note = actions[0] && actions[0].weaponBlocked
      ? h('p', { class: 'action-note' }, [
          Deck.label(state.weapon.card) + ' can’t be used: last defeated ' + state.weapon.lastDefeated + '.'
        ])
      : null;

    return h('div', { class: 'card-actions' }, buttons.concat(note ? [note] : []));
  }

  function describeAction(state, card, action) {
    switch (action.mode) {
      case 'weapon': {
        const w = Deck.label(state.weapon.card);
        return {
          verb: 'Fight with ' + Deck.spokenName(state.weapon.card) + ':',
          title: 'Fight with ' + w,
          detail: 'Take ' + action.damage,
          spokenDetail: 'take ' + action.damage + ' damage'
        };
      }
      case 'barehanded':
        return {
          verb: action.weaponBlocked || !state.weapon ? 'Fight' : 'Fight bare-handed:',
          title: state.weapon ? 'Bare-handed' : 'Fight',
          detail: 'Take ' + action.damage,
          spokenDetail: 'take ' + action.damage + ' damage'
        };
      case 'equip':
        return {
          verb: 'Equip',
          title: 'Equip',
          detail: action.replaces ? 'Replaces ' + Deck.label(action.replaces) : 'Weapon ' + Deck.value(card),
          spokenDetail: action.replaces ? 'replaces ' + Deck.spokenName(action.replaces) : ''
        };
      case 'drink':
        return {
          verb: 'Drink',
          title: 'Drink',
          detail: action.heal > 0 ? 'Heal ' + action.heal : 'Already at full',
          spokenDetail: 'heal ' + action.heal
        };
      case 'discard':
      default:
        return {
          verb: 'Discard',
          title: 'Discard',
          detail: 'No effect · potion used',
          spokenDetail: 'no effect, a potion was already used this room'
        };
    }
  }

  /* ------------------------------------------------------------------ */
  /* Log                                                                */
  /* ------------------------------------------------------------------ */

  function logItem(entry) {
    return h('li', { class: 'log-entry log-entry--' + entry.kind }, [
      h('span', { class: 'log-turn', 'aria-hidden': 'true', text: 'R' + entry.turn }),
      h('span', { class: 'log-text', text: entry.text })
    ]);
  }

  function renderLog(state) {
    if (state.gameId !== renderedGameId) {
      // A new game or a fresh page load: rebuild silently, then let the live
      // region announce only what happens next.
      el.log.setAttribute('aria-busy', 'true');
      el.log.replaceChildren(...state.log.map(logItem));
      el.log.removeAttribute('aria-busy');
    } else {
      state.log.filter((e) => e.id > renderedLogLastId).forEach((e) => el.log.appendChild(logItem(e)));
      while (el.log.children.length > state.log.length) el.log.removeChild(el.log.firstChild);
    }

    renderedGameId = state.gameId;
    renderedLogLastId = state.logSeq;
    el.log.scrollTop = el.log.scrollHeight;
  }

  /* ------------------------------------------------------------------ */
  /* Debug                                                              */
  /* ------------------------------------------------------------------ */

  function renderDebug(state) {
    el.debugSeed.textContent = rng.formatSeed(state.seed) + ' (' + state.seed + ')';
    const monsters = state.deck.filter((c) => c.type === 'monster').length;
    el.debugSummary.textContent =
      state.deck.length + ' cards in the dungeon (' + monsters + ' monsters). ' +
      'Monster value remaining: ' + Game.remainingMonsterTotal(state) + '.';

    const reveal = el.debugReveal.checked;
    el.debugDeck.hidden = !reveal;
    if (reveal) {
      el.debugDeck.replaceChildren(
        ...state.deck.map((c) =>
          h('li', { class: 'debug-chip debug-chip--' + c.type, 'aria-label': Deck.spokenName(c) }, [Deck.label(c)])
        )
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Feedback                                                           */
  /* ------------------------------------------------------------------ */

  /** Restart a one-shot CSS animation class on an element. */
  function pulse(node, className) {
    node.classList.remove(className);
    void node.offsetWidth; // force reflow so the animation can replay
    node.classList.add(className);
    node.addEventListener('animationend', () => node.classList.remove(className), { once: true });
  }

  function feedback(result) {
    if (!result || !result.ok) return;
    if (result.type === 'monster' && result.damage > 0) pulse(el.healthPanel, 'is-hurt');
    if (result.type === 'potion' && result.heal > 0) pulse(el.healthPanel, 'is-healed');
    if (result.type === 'weapon' || (result.type === 'monster' && result.usedWeapon)) {
      pulse(el.weaponPanel, 'is-updated');
    }
  }

  function renderAll(state) {
    renderHUD(state);
    renderRoom(state);
    renderLog(state);
    renderDebug(state);
  }

  /** Forget what was on screen, e.g. before a new game, so every card flips in. */
  function resetRoomMemory() {
    visibleCardIds = new Set();
  }

  Scoundrel.render = { renderAll, renderDebug, feedback, pulse, resetRoomMemory };
})(window.Scoundrel = window.Scoundrel || {});
