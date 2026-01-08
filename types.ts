export type Team = 'red' | 'blue';
export type CardType = 'red' | 'blue' | 'neutral' | 'assassin';
export type GameStatus = 'lobby' | 'playing' | 'red_win' | 'blue_win';

export interface Player {
  id: string; // Peer ID
  name: string;
  team: Team | 'spectator';
  role: 'operative' | 'spymaster';
  isHost: boolean;
}

export interface Card {
  word: string;
  type: CardType;
  revealed: boolean;
}

export interface GameState {
  status: GameStatus;
  cards: Card[];
  currentTurn: Team;
  startingTeam: Team;
  winner: Team | null;
  lastUpdate: number;
}

// Network Message Types
export type MessageType = 
  | 'JOIN_REQUEST' 
  | 'SYNC_STATE' 
  | 'SYNC_PLAYERS'
  | 'ACTION_REVEAL'
  | 'ACTION_END_TURN'
  | 'ACTION_START_GAME'
  | 'ACTION_RESET'
  | 'ACTION_CHANGE_TEAM'
  | 'ACTION_CHANGE_ROLE';

export interface NetworkMessage {
  type: MessageType;
  payload?: any;
  senderId?: string;
}
