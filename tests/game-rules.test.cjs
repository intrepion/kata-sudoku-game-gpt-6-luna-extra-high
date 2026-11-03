const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Execute the game's rule functions without initializing its browser UI.
const source = fs.readFileSync('game.js', 'utf8');
const start = source.indexOf('function shuffled(');
const end = source.indexOf('function setMessage(');
assert.ok(start >= 0 && end > start, 'Could not find the Sudoku rule functions');
const rules = vm.runInNewContext('const SIZE = 9;\n' + source.slice(start, end) +
  '\n({ candidatesFor, solveSudoku, makePuzzle, duplicateCells })');

test('solves a known puzzle and respects Sudoku candidates', () => {
  const board = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'.split('').map(Number);
  assert.deepEqual(Array.from(rules.candidatesFor(board, 2)), [1, 2, 4]);
  const result = rules.solveSudoku(board, 2);
  assert.equal(result.solutions.length, 1);
  assert.equal(result.solutions[0].join(''), '534678912672195348198342567859761423426853791713924856961537284287419635345286179');
});

test('detects conflicting digits and generates valid difficulty boards', () => {
  const board = Array(81).fill(0); board[0] = 4; board[8] = 4;
  assert.deepEqual(Array.from(rules.duplicateCells(board)).sort((a, b) => a - b), [0, 8]);
  for (const [difficulty, clues] of [['easy', 40], ['medium', 33], ['hard', 28]]) {
    const { puzzle, solution } = rules.makePuzzle(difficulty);
    assert.equal(puzzle.filter(Boolean).length, clues);
    assert.equal(rules.duplicateCells(solution).size, 0);
    assert.ok(puzzle.every((value, index) => !value || value === solution[index]));
  }
});
