'use strict';

const STARTING_DICE = 4;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

function randomRoomCode(length = 4) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  }
  return code;
}

function rollDice(count) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    dice.push(1 + Math.floor(Math.random() * 6));
  }
  return dice.sort((a, b) => a - b);
}

function createPlayer(id, name, ws) {
  return {
    id,
    name,
    ws,
    dice: [],
    diceCount: STARTING_DICE,
    connected: true,
  };
}

function createSpectator(id, name, ws) {
  return {
    id,
    name,
    ws,
    connected: true,
  };
}

function createRoom(code, hostId) {
  return {
    code,
    players: new Map(),
    spectators: new Map(),
    turnOrder: [],
    currentTurnIndex: 0,
    currentBid: null,
    phase: 'lobby',
    hostId,
    winnerIds: null,
  };
}

// A bid is { quantity, face, playerId }. face is 1-6.
function isLegalBid(prevBid, newBid) {
  if (!Number.isInteger(newBid.face) || newBid.face < 1 || newBid.face > 6) return false;
  if (!Number.isInteger(newBid.quantity) || newBid.quantity < 1) return false;
  if (prevBid === null) return true;
  if (newBid.quantity > prevBid.quantity) return true;
  if (newBid.quantity === prevBid.quantity) return newBid.face > prevBid.face;
  return false;
}

// allPlayersDice: { playerId: [n, n, ...] }
// Returns { actualCount, challengerWasRight, discardIds, nextRoundStarterId }
function resolveChallenge(bid, challengerId, allPlayersDice) {
  const allDice = Object.values(allPlayersDice).flat();
  const actualCount = bid.face === 1
    ? allDice.filter((d) => d === 1).length
    : allDice.filter((d) => d === bid.face || d === 1).length;

  const challengerWasRight = actualCount < bid.quantity;

  const discardIds = challengerWasRight
    ? Object.keys(allPlayersDice).filter((id) => id !== bid.playerId)
    : Object.keys(allPlayersDice).filter((id) => id !== challengerId);

  const nextRoundStarterId = challengerWasRight ? bid.playerId : challengerId;

  return { actualCount, challengerWasRight, discardIds, nextRoundStarterId };
}

// Applies discards to players (Map<id, Player>), clamped at 0.
// Returns array of playerIds that are at exactly 0 dice after this resolution.
function applyDiscards(players, discardIds) {
  const zeroed = [];
  for (const id of discardIds) {
    const player = players.get(id);
    if (!player) continue;
    player.diceCount = Math.max(0, player.diceCount - 1);
    if (player.diceCount === 0) zeroed.push(id);
  }
  return zeroed;
}

module.exports = {
  STARTING_DICE,
  randomRoomCode,
  rollDice,
  createPlayer,
  createSpectator,
  createRoom,
  isLegalBid,
  resolveChallenge,
  applyDiscards,
};
