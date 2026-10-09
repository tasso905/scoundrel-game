/*
 * rng.js — seedable randomness and the Fisher–Yates shuffle.
 *
 * Every dungeon is generated from a single 32-bit seed, so the same seed
 * always produces the same deck order. That is what makes "Restart" replay
 * the exact same dungeon and lets players share a seed code.
 */
(function (Scoundrel) {
  'use strict';

  const UINT32_MAX = 0xffffffff;

  /**
   * mulberry32: a tiny, fast PRNG with good distribution for games.
   * Returns a function producing floats in [0, 1).
   */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** A fresh, unpredictable seed (crypto when available). */
  function randomSeed() {
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      return window.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * UINT32_MAX) >>> 0;
  }

  /**
   * Fisher–Yates (Durstenfeld) shuffle. Returns a new array; input is untouched.
   *
   * Walk from the end; swap each position i with a random position j in [0, i].
   * Every permutation is equally likely, provided rand() is uniform.
   */
  function shuffle(items, rand) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }

  /** Seeds are shown as short base-36 codes, e.g. 2147483647 → "ZIK0ZJ". */
  function formatSeed(seed) {
    return (seed >>> 0).toString(36).toUpperCase();
  }

  /**
   * Accepts a seed code ("ZIK0ZJ"), a decimal number, or any other text.
   * Codes round-trip with formatSeed; other text is hashed (FNV-1a) so a
   * phrase like "goblin king" is also a valid, repeatable seed.
   * Returns null for empty input.
   */
  function parseSeed(input) {
    const text = String(input == null ? '' : input).trim();
    if (!text) return null;

    if (/^[0-9a-z]{1,7}$/i.test(text)) {
      const n = parseInt(text, 36);
      if (Number.isFinite(n) && n <= UINT32_MAX) return n >>> 0;
    }

    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  Scoundrel.rng = { mulberry32, randomSeed, shuffle, formatSeed, parseSeed };
})(window.Scoundrel = window.Scoundrel || {});
