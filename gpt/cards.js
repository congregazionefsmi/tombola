
/* =========================================================
   TOMBOLA STUDENTATO 1 — CHRISTMAS EDITION
   cards.js

   FIXED DECK: 100 ITALIAN TOMBO​LA CARDS

   Card format:
   - 3 rows × 9 columns
   - Exactly 15 numbers per card
   - Exactly 5 numbers per row
   - 4 empty cells per row
   - Numbers from 1 to 90
   - Correct Italian Tombola column ranges
   - Numbers increase from top to bottom in each column
   - Deterministic generation: same card number = same card
========================================================= */

"use strict";


/* =========================================================
   1. CONFIGURATION
========================================================= */

const CARD_CONFIG = Object.freeze({
    TOTAL_CARDS: 100,
    ROWS: 3,
    COLUMNS: 9,
    NUMBERS_PER_CARD: 15,
    NUMBERS_PER_ROW: 5,
    MIN_NUMBER: 1,
    MAX_NUMBER: 90
});


/* =========================================================
   2. COLUMN NUMBER RANGES
========================================================= */

const CARD_COLUMN_RANGES = Object.freeze([
    [1, 9],
    [10, 19],
    [20, 29],
    [30, 39],
    [40, 49],
    [50, 59],
    [60, 69],
    [70, 79],
    [80, 90]
]);


/* =========================================================
   3. SEEDED RANDOM NUMBER GENERATOR

   Mulberry32:
   - Produces repeatable pseudo-random numbers.
   - Does not depend on the browser's random state.
========================================================= */

function seededRandom(seed) {
    let state = seed >>> 0;

    return function () {
        state += 0x6D2B79F5;

        let value = state;

        value = Math.imul(
            value ^ (value >>> 15),
            value | 1
        );

        value ^= value + Math.imul(
            value ^ (value >>> 7),
            value | 61
        );

        return (
            ((value ^ (value >>> 14)) >>> 0) /
            4294967296
        );
    };
}


/* =========================================================
   4. SHUFFLE ARRAY
========================================================= */

function shuffleArray(array, random) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));

        [result[i], result[j]] = [
            result[j],
            result[i]
        ];
    }

    return result;
}


/* =========================================================
   5. GENERATE COLUMN NUMBER POOLS

   Each column contains only numbers from its correct range.
========================================================= */

function createColumnPools() {
    return CARD_COLUMN_RANGES.map(([min, max]) => {
        const numbers = [];

        for (let number = min; number <= max; number++) {
            numbers.push(number);
        }

        return numbers;
    });
}


/* =========================================================
   6. GENERATE VALID COLUMN COUNTS

   Every column must contain at least one number.

   There are 15 numbers distributed across 9 columns.
   Each column may contain 1, 2, or 3 numbers.

   The total must equal 15.
========================================================= */

function generateColumnCounts(random) {
    const counts = Array(9).fill(1);

    let remaining = 15 - 9;

    while (remaining > 0) {
        const availableColumns = [];

        for (let col = 0; col < 9; col++) {
            if (counts[col] < 3) {
                availableColumns.push(col);
            }
        }

        if (availableColumns.length === 0) {
            throw new Error(
                "Unable to distribute numbers across columns."
            );
        }

        const chosenColumn =
            availableColumns[
                Math.floor(random() * availableColumns.length)
            ];

        counts[chosenColumn]++;
        remaining--;
    }

    return counts;
}


/* =========================================================
   7. GENERATE ROW DISTRIBUTION

   Each row must contain exactly 5 numbers.

   Every column must contain its assigned number count.
========================================================= */

function generateRowDistribution(columnCounts, random) {
    const rows = [
        Array(9).fill(false),
        Array(9).fill(false),
        Array(9).fill(false)
    ];

    const rowTotals = [0, 0, 0];

    const columns = columnCounts
        .map((count, col) => ({
            col,
            count
        }))
        .sort((a, b) => b.count - a.count);

    function placeColumn(index) {
        if (index >= columns.length) {
            return rowTotals.every(total => total === 5);
        }

        const { col, count } = columns[index];

        const possibleRows = [];

        for (let row = 0; row < 3; row++) {
            if (rowTotals[row] < 5) {
                possibleRows.push(row);
            }
        }

        const combinations = [];

        for (let a = 0; a < 3; a++) {
            for (let b = a + 1; b < 3; b++) {
                for (let c = b + 1; c < 3; c++) {
                    combinations.push([a, b, c]);
                }
            }
        }

        let rowCombinations = [];

        if (count === 1) {
            rowCombinations = possibleRows.map(row => [row]);
        }

        if (count === 2) {
            for (let a = 0; a < 3; a++) {
                for (let b = a + 1; b < 3; b++) {
                    rowCombinations.push([a, b]);
                }
            }
        }

        if (count === 3) {
            rowCombinations = combinations;
        }

        rowCombinations = shuffleArray(
            rowCombinations,
            random
        );

        for (const selectedRows of rowCombinations) {
            if (
                selectedRows.some(
                    row => rowTotals[row] >= 5
                )
            ) {
                continue;
            }

            selectedRows.forEach(row => {
                rows[row][col] = true;
                rowTotals[row]++;
            });

            if (placeColumn(index + 1)) {
                return true;
            }

            selectedRows.forEach(row => {
                rows[row][col] = false;
                rowTotals[row]--;
            });
        }

        return false;
    }

    if (!placeColumn(0)) {
        return null;
    }

    return rows;
}


/* =========================================================
   8. GENERATE CARD NUMBERS

   Numbers are assigned to occupied cells.

   The numbers in each column are sorted from top to bottom.
========================================================= */

function fillCardNumbers(rowDistribution, random) {
    const card = [
        Array(9).fill(null),
        Array(9).fill(null),
        Array(9).fill(null)
    ];

    const columnPools = createColumnPools();

    for (let col = 0; col < 9; col++) {
        const occupiedRows = [];

        for (let row = 0; row < 3; row++) {
            if (rowDistribution[row][col]) {
                occupiedRows.push(row);
            }
        }

        if (occupiedRows.length === 0) {
            throw new Error(
                "A Tombola card cannot have an empty column."
            );
        }

        const [min, max] = CARD_COLUMN_RANGES[col];

        const availableNumbers = columnPools[col].filter(
            number => number >= min && number <= max
        );

        const selectedNumbers = shuffleArray(
            availableNumbers,
            random
        ).slice(0, occupiedRows.length);

        selectedNumbers.sort((a, b) => a - b);

        occupiedRows.forEach((row, index) => {
            card[row][col] = selectedNumbers[index];
        });
    }

    return card;
}


/* =========================================================
   9. GENERATE ONE CARD
========================================================= */

function generateTombolaCard(cardNumber) {
    if (
        !Number.isInteger(cardNumber) ||
        cardNumber < 1 ||
        cardNumber > CARD_CONFIG.TOTAL_CARDS
    ) {
        throw new Error(
            "Card number must be between 1 and 100."
        );
    }

    /*
       Each card receives its own seed.
       This guarantees that its layout does not depend
       on which other cards were generated first.
    */

    const seed =
        (0x9E3779B9 ^ Math.imul(cardNumber, 0x85EBCA6B)) >>> 0;

    const random = seededRandom(seed);

    for (let attempt = 0; attempt < 1000; attempt++) {
        const columnCounts = generateColumnCounts(random);

        const rowDistribution = generateRowDistribution(
            columnCounts,
            random
        );

        if (!rowDistribution) {
            continue;
        }

        const card = fillCardNumbers(
            rowDistribution,
            random
        );

        const result = {
            id: cardNumber,
            rows: card,
            numbers: card
                .flat()
                .filter(number => number !== null)
                .sort((a, b) => a - b)
        };

        if (validateTombolaCard(result)) {
            return result;
        }
    }

    throw new Error(
        `Could not generate a valid card #${cardNumber}.`
    );
}


/* =========================================================
   10. VALIDATE ONE CARD
========================================================= */

function validateTombolaCard(card) {
    if (!card || !Array.isArray(card.rows)) {
        return false;
    }

    if (card.rows.length !== 3) {
        return false;
    }

    if (!card.rows.every(row => row.length === 9)) {
        return false;
    }

    const allNumbers = [];

    /* Each row must contain exactly 5 numbers. */

    for (let row = 0; row < 3; row++) {
        const rowNumbers = card.rows[row].filter(
            number => number !== null
        );

        if (rowNumbers.length !== 5) {
            return false;
        }

        allNumbers.push(...rowNumbers);
    }

    /* Exactly 15 numbers per card. */

    if (allNumbers.length !== 15) {
        return false;
    }

    /* No duplicate numbers. */

    if (new Set(allNumbers).size !== 15) {
        return false;
    }

    /* All numbers must be between 1 and 90. */

    if (
        allNumbers.some(
            number =>
                !Number.isInteger(number) ||
                number < 1 ||
                number > 90
        )
    ) {
        return false;
    }

    /* Validate each column. */

    for (let col = 0; col < 9; col++) {
        const columnNumbers = [];

        for (let row = 0; row < 3; row++) {
            const number = card.rows[row][col];

            if (number !== null) {
                const [min, max] = CARD_COLUMN_RANGES[col];

                if (number < min || number > max) {
                    return false;
                }

                columnNumbers.push(number);
            }
        }

        /* Every column must contain at least one number. */

        if (columnNumbers.length === 0) {
            return false;
        }

        /* Numbers must increase from top to bottom. */

        for (let i = 1; i < columnNumbers.length; i++) {
            if (columnNumbers[i] <= columnNumbers[i - 1]) {
                return false;
            }
        }
    }

    return true;
}


/* =========================================================
   11. GENERATE COMPLETE DECK
========================================================= */

function generateTombolaDeck() {
    const deck = [];

    for (
        let cardNumber = 1;
        cardNumber <= CARD_CONFIG.TOTAL_CARDS;
        cardNumber++
    ) {
        deck.push(
            generateTombolaCard(cardNumber)
        );
    }

    return deck;
}


/* =========================================================
   12. CREATE THE FIXED DECK

   Available globally as:
   TOM​BOLA_CARDS
========================================================= */

const TOMBOLA_CARDS = Object.freeze(
    generateTombolaDeck().map(card =>
        Object.freeze({
            id: card.id,

            rows: Object.freeze(
                card.rows.map(row =>
                    Object.freeze([...row])
                )
            ),

            numbers: Object.freeze([...card.numbers])
        })
    )
);


/* =========================================================
   13. GET CARD BY NUMBER

   Example:
   getTombolaCard(1)
========================================================= */

function getTombolaCard(cardNumber) {
    if (
        !Number.isInteger(cardNumber) ||
        cardNumber < 1 ||
        cardNumber > TOMBOLA_CARDS.length
    ) {
        return null;
    }

    return TOMBOLA_CARDS[cardNumber - 1];
}


/* =========================================================
   14. GET ALL CARD NUMBERS
========================================================= */

function getTombolaCardNumbers() {
    return TOMBOLA_CARDS.map(card => card.id);
}


/* =========================================================
   15. GET NUMBERS IN ONE ROW
========================================================= */

function getTombolaRowNumbers(cardNumber, rowIndex) {
    const card = getTombolaCard(cardNumber);

    if (!card || rowIndex < 0 || rowIndex > 2) {
        return [];
    }

    return card.rows[rowIndex].filter(
        number => number !== null
    );
}


/* =========================================================
   16. GET NUMBERS IN ONE COLUMN
========================================================= */

function getTombolaColumnNumbers(cardNumber, columnIndex) {
    const card = getTombolaCard(cardNumber);

    if (!card || columnIndex < 0 || columnIndex > 8) {
        return [];
    }

    return card.rows
        .map(row => row[columnIndex])
        .filter(number => number !== null);
}


/* =========================================================
   17. CHECK IF A NUMBER BELONGS TO A CARD
========================================================= */

function tombolaCardContainsNumber(cardNumber, number) {
    const card = getTombolaCard(cardNumber);

    if (!card) {
        return false;
    }

    return card.numbers.includes(number);
}


/* =========================================================
   18. DECK VALIDATION
========================================================= */

function validateTombolaDeck() {
    if (TOMBOLA_CARDS.length !== 100) {
        return {
            valid: false,
            message: "The deck must contain exactly 100 cards."
        };
    }

    for (const card of TOMBOLA_CARDS) {
        if (!validateTombolaCard(card)) {
            return {
                valid: false,
                message: `Card #${card.id} is invalid.`
            };
        }
    }

    return {
        valid: true,
        message: "All 100 Tombola cards are valid."
    };
}


/* =========================================================
   19. STARTUP VALIDATION
========================================================= */

const TOMBOLA_DECK_VALIDATION = validateTombolaDeck();

if (!TOMBOLA_DECK_VALIDATION.valid) {
    console.error(
        "TOMBOLA DECK ERROR:",
        TOMBOLA_DECK_VALIDATION.message
    );
} else {
    console.info(
        "TOMBOLA:",
        TOMBOLA_DECK_VALIDATION.message
    );
}
