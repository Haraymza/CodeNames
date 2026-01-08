import React from 'react';
import { Card, CardType } from '../types';
import { clsx } from 'clsx';
import { Eye, EyeOff, Skull } from 'lucide-react';

interface GameCardProps {
  card: Card;
  isSpymaster: boolean;
  canInteract: boolean;
  onClick: () => void;
}

const getCardStyle = (type: CardType, revealed: boolean, isSpymaster: boolean) => {
  // Base style
  if (revealed) {
    switch (type) {
      case 'red': return 'bg-red-600 border-red-800 text-white';
      case 'blue': return 'bg-blue-600 border-blue-800 text-white';
      case 'assassin': return 'bg-slate-900 border-black text-white';
      case 'neutral': return 'bg-yellow-200 border-yellow-400 text-yellow-900 opacity-70';
    }
  }

  // Spymaster view (unrevealed)
  if (isSpymaster) {
    switch (type) {
      case 'red': return 'bg-slate-800 border-slate-700 text-red-400 border-l-4 border-l-red-500';
      case 'blue': return 'bg-slate-800 border-slate-700 text-blue-400 border-l-4 border-l-blue-500';
      case 'assassin': return 'bg-slate-800 border-slate-700 text-slate-400 border-l-4 border-l-slate-900';
      case 'neutral': return 'bg-slate-800 border-slate-700 text-yellow-100/50 border-l-4 border-l-yellow-200/30';
    }
  }

  // Operative view (unrevealed)
  return 'bg-slate-200 hover:bg-slate-300 text-slate-800 cursor-pointer shadow-sm border-b-4 border-slate-300 active:border-b-0 active:mt-1';
};

export const GameCard: React.FC<GameCardProps> = ({ card, isSpymaster, canInteract, onClick }) => {
  const style = getCardStyle(card.type, card.revealed, isSpymaster);

  return (
    <div
      onClick={!card.revealed && canInteract ? onClick : undefined}
      className={clsx(
        "relative flex items-center justify-center p-2 rounded h-20 md:h-24 text-xs md:text-sm font-bold uppercase transition-all select-none text-center leading-tight break-words",
        style,
        !card.revealed && canInteract ? "hover:-translate-y-0.5" : ""
      )}
    >
      {card.word}
      
      {/* Icon Overlay for revealed cards to be accessible/clearer */}
      {card.revealed && card.type === 'assassin' && (
        <Skull className="absolute top-1 right-1 w-4 h-4 opacity-50" />
      )}
      
      {/* Spymaster hint icon */}
      {isSpymaster && !card.revealed && (
        <div className="absolute top-1 right-1">
            {card.type === 'assassin' && <Skull className="w-3 h-3 text-slate-500" />}
        </div>
      )}
    </div>
  );
};
