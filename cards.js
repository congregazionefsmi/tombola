/**
 * cards.js
 * Deterministic generator for Fixed Tombola Cards #1 to #100.
 * - Number pool: 1 to 90
 * - Card layout: 2 rows x 5 columns (10 unique numbers per card)
 * - Fixed seed ensures Card #1..#100 are identical across all devices and modes.
 */

(function (global) {
  "use strict";

  const TOTAL_CARDS = 100;
  const MIN_NUMBER = 1;
  const MAX_NUMBER = 90;
  const ROWS_PER_CARD = 2;
  const COLS_PER_CARD = 5;
  const NUMBERS_PER_CARD = ROWS_PER_CARD * COLS_PER_CARD; // 10

  // Fixed seed for "Tombola Studentato 1 - Christmas Edition"
  const DECK_SEED = 20261124;

  /**
   * Deterministic PRNG (Mulberry32)
   * @param {number} seed
   * @returns {function(): number} float in [0, 1)
   */
  function createSeededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Fisher-Yates shuffle using a seeded RNG
   * @param {Array} arr
   * @param {function(): number} rng
   * @returns {Array}
   */
  function seededShuffle(arr, rng) {
    const copy = arr.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * Builds a single fixed card (id: 1..100) with 2 rows of 5 sorted numbers (1..90).
   * @param {number} cardId
   * @param {function(): number} rng
   */
  function buildSingleCard(cardId, rng) {
    const pool = [];
    for (let n = MIN_NUMBER; n <= MAX_NUMBER; n++) {
      pool.push(n);
    }

    const picked = seededShuffle(pool, rng)
      .slice(0, NUMBERS_PER_CARD)
      .sort((a, b) => a - b);

    // Split 10 sorted numbers cleanly into 2 rows of 5 while keeping balanced spread
    const row1 = [picked[0], picked[2], picked[4], picked[6], picked[8]].sort((a, b) => a - b);
    const row2 = [picked[1], picked[3], picked[5], picked[7], picked[9]].sort((a, b) => a - b);

    return {
      id: cardId,
      rows: [row1, row2],
      numbers: picked
    };
  }

  /**
   * Generates and caches the immutable 100-card deck (#1 to #100).
   */
  function generateFixedDeck() {
    const rng = createSeededRng(DECK_SEED);
    const deck = [];
    for (let id = 1; id <= TOTAL_CARDS; id++) {
      deck.push(buildSingleCard(id, rng));
    }
    return Object.freeze(deck);
  }

  const FIXED_CARDS = generateFixedDeck();

  /**
   * Look up a fixed card by ID (1..100).
   * @param {number|string} cardId
   * @returns {object|null}
   */
  function getCardById(cardId) {
    const numId = Number(cardId);
    if (!Number.isInteger(numId) || numId < 1 || numId > TOTAL_CARDS) {
      return null;
    }
    return FIXED_CARDS[numId - 1] || null;
  }

  global.TombolaCards = {
    TOTAL_CARDS,
    MIN_NUMBER,
    MAX_NUMBER,
    ROWS_PER_CARD,
    COLS_PER_CARD,
    FIXED_CARDS,
    getCardById
  };
})(window);
