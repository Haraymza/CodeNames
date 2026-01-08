import { RAW_WORD_LIST, GRID_SIZE } from './constants';
import { Card, CardType, Team } from './types';

export const generateBoard = (): { cards: Card[], startingTeam: Team } => {
  const allWords = RAW_WORD_LIST.split('\n').map(w => w.trim()).filter(w => w.length > 0);
  
  // Shuffle words
  for (let i = allWords.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allWords[i], allWords[j]] = [allWords[j], allWords[i]];
  }

  const selectedWords = allWords.slice(0, GRID_SIZE);
  
  // Determine starting team (9 cards vs 8 cards)
  const startingTeam: Team = Math.random() < 0.5 ? 'red' : 'blue';
  const secondTeam: Team = startingTeam === 'red' ? 'blue' : 'red';

  const types: CardType[] = [
    ...Array(9).fill(startingTeam),
    ...Array(8).fill(secondTeam),
    ...Array(1).fill('assassin'),
    ...Array(7).fill('neutral'),
  ];

  // Shuffle types
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }

  const cards: Card[] = selectedWords.map((word, index) => ({
    word,
    type: types[index],
    revealed: false
  }));

  return { cards, startingTeam };
};

export const getWinner = (cards: Card[], currentTurn: Team): Team | null => {
  const redCardsLeft = cards.filter(c => c.type === 'red' && !c.revealed).length;
  const blueCardsLeft = cards.filter(c => c.type === 'blue' && !c.revealed).length;
  const assassinRevealed = cards.some(c => c.type === 'assassin' && c.revealed);

  if (assassinRevealed) {
    // If current turn revealed assassin, the OTHER team wins
    return currentTurn === 'red' ? 'blue' : 'red';
  }

  if (redCardsLeft === 0) return 'red';
  if (blueCardsLeft === 0) return 'blue';

  return null;
};
