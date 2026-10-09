/*
 * game.js — the Scoundrel rules engine.
 *
 * Pure game logic with no DOM access. Every action mutates a plain,
 * JSON-serialisable state object, appends to its log, and returns a result
 * describing what happened so the UI can animate it.
 *
 * Deck convention: state.deck[0] is the TOP of the dungeon (next card drawn);
 * the last element is the bottom.
 */
(function (Scoundrel) {
  'use strict';

  const { rng, deck: Deck } = Scoundrel;

  const STATE_VERSION = 1;
  const MAX_HEALTH = 20;
  const ROOM_SIZE = 4;
  const CARDS_TO_RESOLVE = 3; // per full room; the 4th is carried forward
  const LOG_LIMIT = 250;

  /* ------------------------------------------------------------------ */
  /* Setup                                                              */
  /* ------------------------------------------------------------------ */

  function newGame(seed) {
    const seedValue = (seed == null ? rng.randomSeed() : seed) >>> 0;
    const shuffled = rng.shuffle(Deck.buildDungeon(), rng.mulberry32(seedValue));

    const state = {
      version: STATE_VERSION,
      gameId: Date.now().toString(36) + '-' + seedValue.toString(36),
      seed: seedValue,
      deck: shuffled,
      room: emptyRoom(),
      carriedId: null, // id of the card carried into the current room, if any
      discard: [],
      health: MAX_HEALTH,
      weapon: null, // { card, stack: [monsterCards], lastDefeated: number|null }
      turn: 0,
      avoidedLastRoom: false,
      potionUsedThisRoom: false,
      resolvedThisRoom: 0,
      status: 'playing', // 'playing' | 'won' | 'lost'
      score: null,
      log: [],
      logSeq: 0
    };

    addLog(state, 'system', 'Entered a new dungeon (seed ' + rng.formatSeed(seedValue) + ').');
    dealRoom(state);
    return state;
  }

  function emptyRoom() {
    return new Array(ROOM_SIZE).fill(null);
  }

  /**
   * Draw until the room shows 4 cards (or the dungeon runs dry).
   * Any carried card is compacted into slot 0 so it leads the new room.
   */
  function dealRoom(state) {
    const carried = state.room.filter(Boolean);
    const drawn = [];
    while (carried.length + drawn.length < ROOM_SIZE && state.deck.length > 0) {
      drawn.push(state.deck.shift());
    }

    state.room = carried.concat(drawn);
    while (state.room.length < ROOM_SIZE) state.room.push(null);

    state.carriedId = carried.length ? carried[0].id : null;
    state.turn += 1;
    state.potionUsedThisRoom = false;
    state.resolvedThisRoom = 0;

    let text = 'Room ' + state.turn + ': ';
    if (carried.length) text += 'carried ' + carried.map(Deck.label).join(' ') + ', ';
    text += drawn.length ? 'drew ' + drawn.map(Deck.label).join(' ') + '.' : 'no cards left to draw.';
    addLog(state, 'room', text);

    return { carried, drawn };
  }

  /* ------------------------------------------------------------------ */
  /* Queries                                                            */
  /* ------------------------------------------------------------------ */

  function roomCards(state) {
    return state.room.filter(Boolean);
  }

  /** How many cards the player must still resolve before the room ends. */
  function cardsLeftToResolve(state) {
    const remaining = roomCards(state).length;
    const dealt = remaining + state.resolvedThisRoom;
    // A full room needs 3 resolutions (the 4th is carried); a short final
    // room, dealt once the dungeon ran low, must be emptied entirely.
    if (dealt < ROOM_SIZE) return remaining;
    return Math.max(0, CARDS_TO_RESOLVE - state.resolvedThisRoom);
  }

  /**
   * Avoid rules:
   *  - Only before resolving any card in the room (all 4 must go under).
   *  - Never twice in a row: avoiding room N forces you to face room N+1.
   *  - Pointless (and disallowed) if the dungeon is empty, since the same
   *    cards would simply be redrawn.
   */
  function avoidStatus(state) {
    if (state.status !== 'playing') return { allowed: false, reason: 'The game is over.' };
    if (state.avoidedLastRoom) {
      return { allowed: false, reason: 'You avoided the last room. This one must be faced.' };
    }
    if (state.resolvedThisRoom > 0) {
      return { allowed: false, reason: 'You have already started facing this room.' };
    }
    if (roomCards(state).length < ROOM_SIZE || state.deck.length === 0) {
      return { allowed: false, reason: 'No cards left in the dungeon to replace this room.' };
    }
    return { allowed: true, reason: 'Place all 4 cards on the bottom of the dungeon.' };
  }

  /**
   * NON-INCREASING WEAPON RULE
   * A weapon that has slain a monster may only be used on monsters whose value
   * is less than or equal to the LAST monster it slew.
   *
   * Worked example — equip ♦5:
   *   ♠J (11): fresh weapon, any monster allowed → take 11 − 5 = 6. lastDefeated = 11
   *   ♣6 (6):  6 ≤ 11 ✓ → take 6 − 5 = 1.                         lastDefeated = 6
   *   ♣6 (6):  6 ≤ 6  ✓ (equal is fine) → take 1.                  lastDefeated = 6
   *   ♠8 (8):  8 > 6  ✗ → weapon unusable, fight bare-handed for 8.
   *   ♠3 (3):  3 ≤ 6  ✓ → take max(0, 3 − 5) = 0.                  lastDefeated = 3
   * Equipping a new weapon resets the chain (lastDefeated = null).
   */
  function canUseWeapon(weapon, monster) {
    if (!weapon) return false;
    return weapon.lastDefeated === null || Deck.value(monster) <= weapon.lastDefeated;
  }

  function damageFrom(monster, weapon) {
    const raw = Deck.value(monster);
    return weapon ? Math.max(0, raw - Deck.value(weapon.card)) : raw;
  }

  /**
   * The actions a card in the room offers right now, used to build buttons.
   * The first entry is the primary action (keyboard shortcut 1–4).
   */
  function cardActions(state, slot) {
    const card = state.room[slot];
    if (!card || state.status !== 'playing') return [];

    if (card.type === 'monster') {
      const bare = { mode: 'barehanded', damage: damageFrom(card, null) };
      if (canUseWeapon(state.weapon, card)) {
        return [{ mode: 'weapon', damage: damageFrom(card, state.weapon) }, bare];
      }
      return [Object.assign(bare, { weaponBlocked: Boolean(state.weapon) })];
    }

    if (card.type === 'weapon') {
      return [{ mode: 'equip', replaces: state.weapon ? state.weapon.card : null }];
    }

    // Potion
    if (state.potionUsedThisRoom) return [{ mode: 'discard' }];
    const heal = Math.min(Deck.value(card), MAX_HEALTH - state.health);
    return [{ mode: 'drink', heal }];
  }

  /** Sum of every monster still in the dungeon or the current room. */
  function remainingMonsterTotal(state) {
    return state.deck
      .concat(roomCards(state))
      .filter((c) => c.type === 'monster')
      .reduce((sum, c) => sum + Deck.value(c), 0);
  }

  /* ------------------------------------------------------------------ */
  /* Actions                                                            */
  /* ------------------------------------------------------------------ */

  function avoid(state) {
    const status = avoidStatus(state);
    if (!status.allowed) return { ok: false, reason: status.reason };

    // Keep the room's left-to-right order when sliding it under the dungeon.
    const cards = roomCards(state);
    state.deck.push.apply(state.deck, cards);
    state.room = emptyRoom();
    addLog(state, 'avoid', 'Avoided the room: ' + cards.map(Deck.label).join(' ') + ' went to the bottom.');

    dealRoom(state);
    state.avoidedLastRoom = true;
    return { ok: true, type: 'avoid', newRoom: true };
  }

  /**
   * Resolve the card in `slot`. `mode` picks how (see cardActions); when
   * omitted, the card's primary action is used.
   */
  function resolve(state, slot, mode) {
    if (state.status !== 'playing') return { ok: false, reason: 'The game is over.' };
    const card = state.room[slot];
    if (!card) return { ok: false, reason: 'That slot is empty.' };

    const actions = cardActions(state, slot);
    const action = mode ? actions.find((a) => a.mode === mode) : actions[0];
    if (!action) return { ok: false, reason: 'That action is not available for ' + Deck.label(card) + '.' };

    state.room[slot] = null;
    state.resolvedThisRoom += 1;

    let result;
    if (card.type === 'monster') result = fightMonster(state, card, action.mode === 'weapon');
    else if (card.type === 'weapon') result = equipWeapon(state, card);
    else result = usePotion(state, card);

    result.ok = true;
    result.card = card;
    result.slot = slot;
    afterResolve(state, result);
    return result;
  }

  function fightMonster(state, monster, useWeapon) {
    const weapon = useWeapon ? state.weapon : null;
    const damage = damageFrom(monster, weapon);
    state.health = Math.max(0, state.health - damage);

    if (weapon) {
      // Fighting with a weapon always slays the monster; any value the weapon
      // couldn't absorb comes through as damage. The kill joins the weapon's
      // stack and becomes the new ceiling for the non-increasing rule.
      weapon.stack.push(monster);
      weapon.lastDefeated = Deck.value(monster);
      addLog(
        state,
        damage > 0 ? 'damage' : 'kill',
        'Slew ' + Deck.label(monster) + ' with ' + Deck.label(weapon.card) + '. ' +
          (damage > 0 ? 'Took ' + damage + ' damage.' : 'No damage taken.')
      );
    } else {
      state.discard.push(monster);
      addLog(state, 'damage', 'Fought ' + Deck.label(monster) + ' bare-handed. Took ' + damage + ' damage.');
    }

    return { type: 'monster', damage, usedWeapon: Boolean(weapon) };
  }

  function equipWeapon(state, card) {
    const old = state.weapon;
    if (old) {
      // The old weapon and every monster stacked on it are discarded together.
      state.discard.push(old.card);
      state.discard.push.apply(state.discard, old.stack);
    }
    state.weapon = { card, stack: [], lastDefeated: null };
    addLog(
      state,
      'equip',
      'Equipped ' + Deck.label(card) + (old ? ', discarding ' + Deck.label(old.card) + '.' : '.')
    );
    return { type: 'weapon' };
  }

  /**
   * POTION RESTRICTION
   * Only the first potion resolved in a room heals. Later potions in the same
   * room are discarded with no effect. Healing is capped at 20.
   *
   * Worked example — health 14, room holds ♥5 and ♥9:
   *   ♥5 first: 14 + 5 = 19.                   (potion used this room)
   *   ♥9 next:  discarded, still 19.
   * Had ♥9 been first: min(20, 14 + 9) = 20, healing 6 — the extra 3 is lost.
   * A potion carried into the next room counts against THAT room's limit.
   */
  function usePotion(state, card) {
    state.discard.push(card);

    if (state.potionUsedThisRoom) {
      addLog(state, 'warn', 'Discarded ' + Deck.label(card) + ' — only one potion works per room.');
      return { type: 'potion', heal: 0, wasted: true };
    }

    const before = state.health;
    state.health = Math.min(MAX_HEALTH, state.health + Deck.value(card));
    state.potionUsedThisRoom = true;
    const healed = state.health - before;
    addLog(
      state,
      'heal',
      'Drank ' + Deck.label(card) + '. Healed ' + healed +
        (healed < Deck.value(card) ? ' (capped at ' + MAX_HEALTH + ').' : '.')
    );
    return { type: 'potion', heal: healed, wasted: false };
  }

  /**
   * End-of-action bookkeeping, in priority order:
   *   1. Health ≤ 0 → lost, immediately.
   *   2. Room and dungeon both empty → won.
   *   3. Room finished (3 resolved, or a short room emptied) → deal the next
   *      room, carrying the leftover card into slot 0.
   */
  function afterResolve(state, result) {
    if (state.health <= 0) {
      state.status = 'lost';
      state.score = -remainingMonsterTotal(state);
      addLog(state, 'lose', 'You were slain. Score: ' + state.score + '.');
      return;
    }

    const remaining = roomCards(state).length;
    if (remaining === 0 && state.deck.length === 0) {
      state.status = 'won';
      state.score = state.health;
      addLog(state, 'win', 'The dungeon is cleared! Score: ' + state.score + '.');
      return;
    }

    if (cardsLeftToResolve(state) === 0) {
      state.avoidedLastRoom = false; // this room was faced, so avoiding is allowed again
      dealRoom(state);
      result.newRoom = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Log & validation                                                   */
  /* ------------------------------------------------------------------ */

  function addLog(state, kind, text) {
    state.logSeq += 1;
    state.log.push({ id: state.logSeq, turn: state.turn, kind, text });
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  /** Loose structural check for state loaded from LocalStorage. */
  function isValidState(s) {
    return Boolean(
      s && s.version === STATE_VERSION &&
      Array.isArray(s.deck) && Array.isArray(s.room) && s.room.length === ROOM_SIZE &&
      Array.isArray(s.discard) && Array.isArray(s.log) &&
      typeof s.health === 'number' && typeof s.seed === 'number' &&
      ['playing', 'won', 'lost'].includes(s.status)
    );
  }

  Scoundrel.game = {
    MAX_HEALTH,
    ROOM_SIZE,
    newGame,
    avoid,
    resolve,
    avoidStatus,
    cardActions,
    cardsLeftToResolve,
    canUseWeapon,
    damageFrom,
    remainingMonsterTotal,
    roomCards,
    isValidState
  };
})(window.Scoundrel = window.Scoundrel || {});
