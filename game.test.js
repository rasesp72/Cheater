'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isLegalBid, resolveChallenge, applyDiscards, createPlayer, rollDice } = require('./game');

test('isLegalBid: first bid of a round is always legal (given valid shape)', () => {
  assert.equal(isLegalBid(null, { quantity: 1, face: 1 }), true);
  assert.equal(isLegalBid(null, { quantity: 10, face: 6 }), true);
  assert.equal(isLegalBid(null, { quantity: 0, face: 3 }), false);
  assert.equal(isLegalBid(null, { quantity: 3, face: 7 }), false);
});

test('isLegalBid: same face requires strictly higher quantity', () => {
  const prev = { quantity: 3, face: 4, playerId: 'a' };
  assert.equal(isLegalBid(prev, { quantity: 4, face: 4 }), true);
  assert.equal(isLegalBid(prev, { quantity: 3, face: 4 }), false);
  assert.equal(isLegalBid(prev, { quantity: 2, face: 4 }), false);
});

test('isLegalBid: same quantity requires strictly higher face', () => {
  const prev = { quantity: 3, face: 4, playerId: 'a' };
  assert.equal(isLegalBid(prev, { quantity: 3, face: 5 }), true);
  assert.equal(isLegalBid(prev, { quantity: 3, face: 4 }), false);
  assert.equal(isLegalBid(prev, { quantity: 3, face: 3 }), false);
});

test('isLegalBid: higher quantity on a lower face is legal', () => {
  const prev = { quantity: 3, face: 4, playerId: 'a' };
  assert.equal(isLegalBid(prev, { quantity: 4, face: 2 }), true);
});

test('isLegalBid: moving onto/off face 1 follows the same general rule', () => {
  // "3 fours" -> "4 ones": higher quantity, any face -> legal
  assert.equal(isLegalBid({ quantity: 3, face: 4 }, { quantity: 4, face: 1 }), true);
  // "3 fours" -> "3 ones": same quantity, lower face -> illegal
  assert.equal(isLegalBid({ quantity: 3, face: 4 }, { quantity: 3, face: 1 }), false);
  // "5 ones" -> "5 twos": same quantity, higher face -> legal
  assert.equal(isLegalBid({ quantity: 5, face: 1 }, { quantity: 5, face: 2 }), true);
  // "5 ones" -> "6 twos": higher quantity -> legal
  assert.equal(isLegalBid({ quantity: 5, face: 1 }, { quantity: 6, face: 2 }), true);
});

test('resolveChallenge: wild 1s count toward non-1 bids', () => {
  const bid = { quantity: 4, face: 4, playerId: 'bidder' };
  const dice = {
    bidder: [4, 4, 1, 6],
    challenger: [4, 1, 2, 3],
  }; // actual 4s = 3, actual 1s = 2 -> wild count for face 4 = 5
  const result = resolveChallenge(bid, 'challenger', dice);
  assert.equal(result.actualCount, 5);
  assert.equal(result.challengerWasRight, false); // 5 >= 4, bid held up
  assert.deepEqual(result.discardIds, ['bidder']); // everyone except the wrong challenger
  assert.equal(result.nextRoundStarterId, 'challenger');
});

test('resolveChallenge: bids on face 1 do not get an extra wild bonus', () => {
  const bid = { quantity: 3, face: 1, playerId: 'bidder' };
  const dice = {
    bidder: [1, 1, 4, 6],
    challenger: [1, 2, 3, 5],
  }; // actual 1s = 3, no wild-of-wild bonus
  const result = resolveChallenge(bid, 'challenger', dice);
  assert.equal(result.actualCount, 3);
  assert.equal(result.challengerWasRight, false);
});

test('resolveChallenge: challenger right when actual count is below the bid', () => {
  const bid = { quantity: 5, face: 5, playerId: 'bidder' };
  const dice = {
    bidder: [5, 5, 1, 3],
    challenger: [2, 3, 4, 6],
  }; // actual 5s = 2, wild 1s = 1 -> total 3 < 5
  const result = resolveChallenge(bid, 'challenger', dice);
  assert.equal(result.actualCount, 3);
  assert.equal(result.challengerWasRight, true);
  assert.deepEqual(result.discardIds, ['challenger']);
  assert.equal(result.nextRoundStarterId, 'bidder');
});

test('resolveChallenge: everyone but the wrong challenger discards, in a 3-player room', () => {
  const bid = { quantity: 2, face: 6, playerId: 'p1' };
  const dice = { p1: [6, 6], p2: [1, 2], p3: [3, 4] }; // actual 6s = 2 -> bid holds
  const result = resolveChallenge(bid, 'p2', dice);
  assert.equal(result.challengerWasRight, false);
  assert.deepEqual(result.discardIds.sort(), ['p1', 'p3'].sort());
  assert.equal(result.nextRoundStarterId, 'p2');
});

test('applyDiscards: clamps at 0 and reports zeroed players', () => {
  const players = new Map([
    ['a', createPlayer('a', 'Alice', null)],
    ['b', createPlayer('b', 'Bob', null)],
  ]);
  players.get('a').diceCount = 1;
  players.get('b').diceCount = 2;

  const zeroed = applyDiscards(players, ['a', 'b']);
  assert.equal(players.get('a').diceCount, 0);
  assert.equal(players.get('b').diceCount, 1);
  assert.deepEqual(zeroed, ['a']);
});

test('applyDiscards: can produce joint winners when two players both had 1 die', () => {
  const players = new Map([
    ['a', createPlayer('a', 'Alice', null)],
    ['b', createPlayer('b', 'Bob', null)],
    ['c', createPlayer('c', 'Carol', null)],
  ]);
  players.get('a').diceCount = 1;
  players.get('b').diceCount = 1;
  players.get('c').diceCount = 3;

  // wrong-challenge case: everyone but the challenger discards
  const zeroed = applyDiscards(players, ['a', 'b']);
  assert.deepEqual(zeroed.sort(), ['a', 'b']);
});

test('rollDice: produces the requested count, all values 1-6', () => {
  const dice = rollDice(4);
  assert.equal(dice.length, 4);
  for (const d of dice) {
    assert.ok(d >= 1 && d <= 6);
  }
});
