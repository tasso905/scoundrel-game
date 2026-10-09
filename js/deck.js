/*
 * deck.js — the card model and dungeon construction.
 *
 * A card is a plain object so it serialises cleanly to LocalStorage:
 *   { id: 'S12', suit: 'S', rank: 12, type: 'monster' }
 * A card's value equals its rank (J=11, Q=12, K=13, A=14).
 */
(function (Scoundrel) {
  'use strict';

  const SUITS = {
    S: { symbol: '♠', name: 'Spades' },
    C: { symbol: '♣', name: 'Clubs' },
    D: { symbol: '♦', name: 'Diamonds' },
    H: { symbol: '♥', name: 'Hearts' }
  };

  const TYPE_BY_SUIT = { S: 'monster', C: 'monster', D: 'weapon', H: 'potion' };

  const RANK_LABELS = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RANK_NAMES = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };

  function createCard(suit, rank) {
    return { id: suit + rank, suit, rank, type: TYPE_BY_SUIT[suit] };
  }

  /**
   * The 44-card dungeon: a standard deck minus jokers, red face cards and red aces.
   *   26 monsters  ♠/♣ 2–A   (2–14)
   *    9 weapons   ♦ 2–10
   *    9 potions   ♥ 2–10
   */
  function buildDungeon() {
    const cards = [];
    ['S', 'C'].forEach((suit) => {
      for (let rank = 2; rank <= 14; rank++) cards.push(createCard(suit, rank));
    });
    ['D', 'H'].forEach((suit) => {
      for (let rank = 2; rank <= 10; rank++) cards.push(createCard(suit, rank));
    });
    return cards;
  }

  function value(card) {
    return card.rank;
  }

  function rankLabel(card) {
    return RANK_LABELS[card.rank] || String(card.rank);
  }

  function symbol(card) {
    return SUITS[card.suit].symbol;
  }

  /** Card art in assets/, chosen by suit and rank band. */
  function art(card) {
    const r = card.rank;
    switch (card.suit) {
      case 'H': return 'assets/heart.jpg';
      case 'D': return 'assets/diamond-' + (r <= 4 ? 1 : r <= 7 ? 2 : 3) + '.jpg';
      case 'C': return 'assets/club-' + (r <= 5 ? 1 : r <= 10 ? 2 : 3) + '.jpg';
      case 'S': return 'assets/spade-' + (r <= 5 ? 1 : r <= 10 ? 2 : 3) + '.jpg';
    }
    return null;
  }

  /** Short label used in the log and HUD, e.g. "♦7", "♠Q". */
  function label(card) {
    return symbol(card) + rankLabel(card);
  }

  /** Spoken name for screen readers, e.g. "Queen of Spades". */
  function spokenName(card) {
    const rank = RANK_NAMES[card.rank] || String(card.rank);
    return rank + ' of ' + SUITS[card.suit].name;
  }

  Scoundrel.deck = {
    SUITS,
    buildDungeon,
    createCard,
    value,
    rankLabel,
    symbol,
    art,
    label,
    spokenName
  };
})(window.Scoundrel = window.Scoundrel || {});
