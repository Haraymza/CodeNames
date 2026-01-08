import React, { useState, useEffect, useRef, useCallback } from 'react';
import Peer, { DataConnection } from 'peerjs';
import { GameState, Player, MessageType, NetworkMessage, Team, GameStatus } from './types';
import { generateBoard, getWinner } from './utils';
import { PASSWORD } from './constants';
import { GameCard } from './components/GameCard';
import { Crown, Users, Copy, Check, ShieldAlert, Play, LogOut, ArrowRight, X } from 'lucide-react';
import { clsx } from 'clsx';

// Initial dummy state
const INITIAL_STATE: GameState = {
  status: 'lobby',
  cards: [],
  currentTurn: 'red',
  startingTeam: 'red',
  winner: null,
  lastUpdate: Date.now(),
};

export default function App() {
  // -- Route State --
  const [route, setRoute] = useState<'home' | 'lobby' | 'game'>('home');
  const [roomId, setRoomId] = useState<string>('');
  
  // -- PeerJS / Network State --
  const [peer, setPeer] = useState<Peer | null>(null);
  const [myId, setMyId] = useState<string>('');
  const [connections, setConnections] = useState<DataConnection[]>([]);
  const [isHost, setIsHost] = useState<boolean>(false);
  const [connectionError, setConnectionError] = useState<string>('');

  // -- Game State --
  const [gameState, setGameState] = useState<GameState>(INITIAL_STATE);
  const [players, setPlayers] = useState<Player[]>([]);
  const [myPlayerName, setMyPlayerName] = useState<string>('');

  // -- UI State --
  const [inputRoomId, setInputRoomId] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Refs for callbacks
  const gameStateRef = useRef(gameState);
  const playersRef = useRef(players);
  gameStateRef.current = gameState;
  playersRef.current = players;

  // --- Network Logic ---

  // Initialize Peer
  const initializePeer = (hostMode: boolean) => {
    const newPeer = new Peer();

    newPeer.on('open', (id) => {
      setMyId(id);
      setPeer(newPeer);
      
      if (hostMode) {
        setIsHost(true);
        setRoomId(id);
        setPlayers([{
          id,
          name: myPlayerName || 'Host',
          team: 'spectator',
          role: 'operative',
          isHost: true
        }]);
        setRoute('lobby');
      } else {
        // Client mode: Connect to host
        connectToHost(newPeer, inputRoomId);
      }
    });

    newPeer.on('connection', (conn) => {
      // Logic for HOST receiving connections
      handleConnection(conn, true);
    });

    newPeer.on('error', (err) => {
      console.error('Peer error:', err);
      setConnectionError('Connection error. Please try again.');
    });

    return newPeer;
  };

  const connectToHost = (currentPeer: Peer, hostId: string) => {
    const conn = currentPeer.connect(hostId);
    handleConnection(conn, false);
  };

  const handleConnection = (conn: DataConnection, amIHost: boolean) => {
    conn.on('open', () => {
      setConnections(prev => [...prev, conn]);
      setConnectionError('');

      if (!amIHost) {
        // I am client, I just connected to host. Send join request.
        conn.send({
          type: 'JOIN_REQUEST',
          payload: { name: myPlayerName },
          senderId: conn.peer // My ID from peerjs perspective
        } as NetworkMessage);
        setRoomId(conn.peer); // The remote peer is the room ID
        setRoute('lobby');
      }
    });

    conn.on('data', (data: any) => {
      const msg = data as NetworkMessage;
      handleMessage(msg, conn, amIHost);
    });

    conn.on('close', () => {
      setConnections(prev => prev.filter(c => c !== conn));
      if (!amIHost) {
        setConnectionError('Host disconnected');
        setRoute('home');
      } else {
        // Host logic: remove player
        // We can't easily map connection to player ID without tracking it.
        // For simplicity, we sync active players periodically or handle clean disconnects if possible.
        // In a simple p2p, we might just re-sync.
        // Let's implement a heartbeat or just lazy removal if strictness needed.
        // For this demo: we won't auto-remove to prevent accidental drops, 
        // but normally we would filter `players` based on active connections.
      }
    });
  };

  const handleMessage = (msg: NetworkMessage, conn: DataConnection, amIHost: boolean) => {
    if (amIHost) {
      // --- HOST LOGIC ---
      switch (msg.type) {
        case 'JOIN_REQUEST':
          const newPlayer: Player = {
            id: msg.senderId || conn.peer,
            name: msg.payload.name,
            team: 'spectator',
            role: 'operative',
            isHost: false
          };
          // Check if already exists
          if (!playersRef.current.find(p => p.id === newPlayer.id)) {
            const newPlayers = [...playersRef.current, newPlayer];
            setPlayers(newPlayers);
            broadcast(newPlayers, gameStateRef.current);
          } else {
             // Re-sync just in case
             broadcast(playersRef.current, gameStateRef.current);
          }
          break;

        case 'ACTION_CHANGE_TEAM':
          // Locked if game started
          if (gameStateRef.current.status !== 'lobby') return;
          updatePlayer(msg.senderId!, { team: msg.payload.team, role: 'operative' });
          break;

        case 'ACTION_CHANGE_ROLE':
           // Locked if game started
           if (gameStateRef.current.status !== 'lobby') return;
           // Ensure only one spymaster per team
           const teamPlayers = playersRef.current.filter(p => p.team === msg.payload.team);
           const hasSpymaster = teamPlayers.some(p => p.role === 'spymaster');
           if (msg.payload.role === 'spymaster' && hasSpymaster) return; // Deny
           
           updatePlayer(msg.senderId!, { role: msg.payload.role });
           break;
        
        case 'ACTION_START_GAME':
           startGame();
           break;

        case 'ACTION_REVEAL':
           if (gameStateRef.current.status !== 'playing') return;
           handleCardClickHost(msg.payload.index, msg.senderId!);
           break;

        case 'ACTION_END_TURN':
            if (gameStateRef.current.status !== 'playing') return;
            endTurnHost(msg.senderId!);
            break;
            
        case 'ACTION_RESET':
            resetGameHost();
            break;
      }
    } else {
      // --- CLIENT LOGIC ---
      switch (msg.type) {
        case 'SYNC_STATE':
          setGameState(msg.payload);
          break;
        case 'SYNC_PLAYERS':
          setPlayers(msg.payload);
          break;
      }
    }
  };

  // --- Host Helper Functions ---

  const broadcast = (currentPlayers: Player[], currentGameState: GameState) => {
    // Send to all connections
    connections.forEach(conn => {
      if (conn.open) {
        conn.send({ type: 'SYNC_PLAYERS', payload: currentPlayers });
        conn.send({ type: 'SYNC_STATE', payload: currentGameState });
      }
    });
    // Update local state (Host is also a player)
    setPlayers(currentPlayers);
    setGameState(currentGameState);
  };

  const updatePlayer = (playerId: string, updates: Partial<Player>) => {
    const newPlayers = playersRef.current.map(p => 
      p.id === playerId ? { ...p, ...updates } : p
    );
    broadcast(newPlayers, gameStateRef.current);
  };

  const startGame = () => {
    const { cards, startingTeam } = generateBoard();
    const newState: GameState = {
      ...INITIAL_STATE,
      status: 'playing',
      cards,
      startingTeam,
      currentTurn: startingTeam,
      winner: null
    };
    broadcast(playersRef.current, newState);
  };

  const resetGameHost = () => {
      broadcast(playersRef.current, INITIAL_STATE);
  };

  const handleCardClickHost = (index: number, playerId: string) => {
    const player = playersRef.current.find(p => p.id === playerId);
    const currentState = gameStateRef.current;
    
    // Validation
    if (!player || player.team !== currentState.currentTurn || player.role !== 'operative') return;
    if (currentState.cards[index].revealed) return;

    // Reveal Logic
    const newCards = [...currentState.cards];
    newCards[index] = { ...newCards[index], revealed: true };
    const revealedCard = newCards[index];

    let nextTurn = currentState.currentTurn;
    let winner = currentState.winner;

    // Check if turn ends
    if (revealedCard.type === 'assassin') {
        winner = currentState.currentTurn === 'red' ? 'blue' : 'red';
        nextTurn = currentState.currentTurn === 'red' ? 'blue' : 'red'; // Doesn't matter, game over
    } else if (revealedCard.type === 'neutral') {
        nextTurn = currentState.currentTurn === 'red' ? 'blue' : 'red';
    } else if (revealedCard.type !== currentState.currentTurn) {
        // Picked opponent's card
        nextTurn = currentState.currentTurn === 'red' ? 'blue' : 'red';
    } else {
        // Picked own card, turn continues unless they want to stop (handled by end turn button)
        // Check win condition immediately
        const potentialWinner = getWinner(newCards, currentState.currentTurn);
        if (potentialWinner) winner = potentialWinner;
    }

    // Check win condition (if revealed opponent's last card by mistake)
    if (!winner) {
         winner = getWinner(newCards, currentState.currentTurn);
    }

    const newState = {
        ...currentState,
        cards: newCards,
        currentTurn: nextTurn,
        winner: winner ? winner : null,
        status: winner ? (winner === 'red' ? 'red_win' : 'blue_win') as GameStatus : 'playing'
    };

    broadcast(playersRef.current, newState);
  };

  const endTurnHost = (playerId: string) => {
      const player = playersRef.current.find(p => p.id === playerId);
      const currentState = gameStateRef.current;
      if (!player || player.team !== currentState.currentTurn) return;

      const nextTurn = currentState.currentTurn === 'red' ? 'blue' : 'red';
      broadcast(playersRef.current, { ...currentState, currentTurn: nextTurn });
  };


  // --- Client Actions ---

  const sendAction = (type: MessageType, payload?: any) => {
    if (isHost) {
      // If I am host, route directly to handler (simulate network)
      handleMessage({ type, payload, senderId: myId }, null as any, true);
    } else {
       // Send to host
       // Find connection to host (usually the only one in client mode)
       const conn = connections[0];
       if (conn && conn.open) {
           conn.send({ type, payload });
       }
    }
  };

  // --- UI Handlers ---

  const handleCreateRoom = () => {
    if (passwordInput !== PASSWORD) {
      alert("Incorrect Password Code");
      return;
    }
    if (!myPlayerName) {
      alert("Please enter a nickname");
      return;
    }
    initializePeer(true);
    setShowPasswordModal(false);
  };

  const handleJoinRoom = () => {
    if (!myPlayerName || !inputRoomId) {
       alert("Please enter name and Room ID");
       return;
    }
    initializePeer(false);
  };

  const copyRoomLink = () => {
    // In a real deployed app, this would include the URL. 
    // Since this is likely a pasted file, we just copy the Room ID or a simulated link.
    // Let's assume hash routing for link sharing if we implemented reading hash on load.
    const link = `${window.location.origin}${window.location.pathname}#${roomId}`;
    navigator.clipboard.writeText(link);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Check URL hash on load for auto-join
  useEffect(() => {
    const hash = window.location.hash.substring(1);
    if (hash && hash.length > 0) {
       setInputRoomId(hash);
    }
  }, []);


  // --- Views ---

  const renderHome = () => (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-slate-900 text-slate-100 relative">
       <div className="max-w-md w-full space-y-8">
          <div className="text-center">
            <h1 className="text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-red-500 to-blue-500 mb-2">
              PAKcoRde names
            </h1>
            <div className="inline-flex items-center px-3 py-1 rounded-full border border-slate-700 bg-slate-800/50 text-xs text-slate-400">
               <ShieldAlert className="w-3 h-3 mr-2" /> Developed by xro
            </div>
          </div>

          <div className="bg-slate-800 p-8 rounded-2xl shadow-xl border border-slate-700 space-y-6">
             <div>
               <label className="block text-sm font-medium text-slate-400 mb-1">Codename</label>
               <input 
                  type="text" 
                  value={myPlayerName}
                  onChange={(e) => setMyPlayerName(e.target.value)}
                  placeholder="Enter your nickname"
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all"
               />
             </div>

             <div className="pt-4 border-t border-slate-700">
                <p className="text-xs text-center text-slate-500 mb-4 uppercase tracking-widest font-bold">Join Operations</p>
                <div className="flex gap-2">
                   <input 
                      type="text"
                      value={inputRoomId}
                      onChange={(e) => setInputRoomId(e.target.value)}
                      placeholder="Room ID / Link Code"
                      className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                   />
                   <button 
                     onClick={handleJoinRoom}
                     className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-bold transition-colors"
                   >
                     Join
                   </button>
                </div>
             </div>

             <div className="relative">
                <div className="absolute inset-0 flex items-center">
                   <div className="w-full border-t border-slate-700"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                   <span className="px-2 bg-slate-800 text-slate-500">OR</span>
                </div>
             </div>

             <button 
                onClick={() => setShowPasswordModal(true)}
                className="w-full bg-slate-700 hover:bg-slate-600 text-slate-200 py-3 rounded-lg font-bold border border-slate-600 transition-colors"
             >
                Create Secure Room
             </button>
          </div>

          {connectionError && (
            <div className="p-4 bg-red-900/50 border border-red-800 text-red-200 rounded-lg text-center text-sm">
               {connectionError}
            </div>
          )}
       </div>

       {/* Password Modal */}
       {showPasswordModal && (
         <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-600 w-full max-w-sm">
               <div className="flex justify-between items-center mb-4">
                  <h3 className="text-xl font-bold">Secure Access</h3>
                  <button onClick={() => setShowPasswordModal(false)}><X className="w-5 h-5 text-slate-400" /></button>
               </div>
               <p className="text-sm text-slate-400 mb-4">Enter the developer clearance code to create a room.</p>
               <input 
                  type="password"
                  value={passwordInput}
                  onChange={(e) => setPasswordInput(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 mb-4 text-white font-mono"
                  placeholder="Enter code..."
               />
               <button 
                  onClick={handleCreateRoom}
                  className="w-full bg-green-600 hover:bg-green-500 text-white py-3 rounded-lg font-bold"
               >
                  Initialize Room
               </button>
            </div>
         </div>
       )}
    </div>
  );

  const renderLobby = () => {
    const redTeam = players.filter(p => p.team === 'red');
    const blueTeam = players.filter(p => p.team === 'blue');
    const spectators = players.filter(p => p.team === 'spectator');

    const canStart = isHost && redTeam.length > 0 && blueTeam.length > 0;

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 p-4 md:p-8">
         <div className="max-w-6xl mx-auto">
            <header className="flex flex-col md:flex-row justify-between items-center mb-12 gap-4">
               <div>
                  <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-slate-200 to-slate-400">Mission Lobby</h2>
                  <div className="flex items-center gap-2 text-slate-400 text-sm mt-1">
                     <span className="font-mono bg-slate-800 px-2 py-1 rounded select-all">{roomId}</span>
                     <button onClick={copyRoomLink} className="hover:text-white transition-colors">
                        {copySuccess ? <Check className="w-4 h-4 text-green-400"/> : <Copy className="w-4 h-4" />}
                     </button>
                  </div>
               </div>
               
               {isHost && (
                 <button 
                   onClick={() => sendAction('ACTION_START_GAME')}
                   disabled={!canStart}
                   className={clsx(
                     "flex items-center gap-2 px-8 py-3 rounded-lg font-bold shadow-lg transition-all",
                     canStart ? "bg-green-600 hover:bg-green-500 text-white" : "bg-slate-700 text-slate-500 cursor-not-allowed"
                   )}
                 >
                   <Play className="w-5 h-5" /> Start Operation
                 </button>
               )}
            </header>

            <div className="grid md:grid-cols-2 gap-8 mb-8">
               {/* Red Team */}
               <div className="bg-slate-800/50 rounded-xl border border-red-900/30 overflow-hidden">
                  <div className="bg-red-900/20 p-4 border-b border-red-900/30 flex justify-between items-center">
                     <h3 className="text-red-400 font-bold text-xl uppercase tracking-wider">Red Team</h3>
                     <button 
                        onClick={() => sendAction('ACTION_CHANGE_TEAM', { team: 'red' })}
                        className="text-xs bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded"
                     >
                        Join Team
                     </button>
                  </div>
                  <div className="p-4 space-y-2 min-h-[200px]">
                     {redTeam.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-slate-900/50 p-3 rounded border border-slate-700/50">
                           <span className="font-medium">{p.name} {p.isHost && '👑'}</span>
                           <button 
                              onClick={() => sendAction('ACTION_CHANGE_ROLE', { team: 'red', role: p.role === 'spymaster' ? 'operative' : 'spymaster' })}
                              disabled={p.id !== myId}
                              className={clsx(
                                "text-xs px-2 py-1 rounded border",
                                p.role === 'spymaster' ? "bg-yellow-600/20 border-yellow-600 text-yellow-500" : "bg-slate-700 border-slate-600 text-slate-400",
                                p.id !== myId && "opacity-50 cursor-default"
                              )}
                           >
                              {p.role === 'spymaster' ? 'Spymaster' : 'Operative'}
                           </button>
                        </div>
                     ))}
                     {redTeam.length === 0 && <p className="text-slate-600 italic text-center py-8">No agents assigned</p>}
                  </div>
               </div>

               {/* Blue Team */}
               <div className="bg-slate-800/50 rounded-xl border border-blue-900/30 overflow-hidden">
                  <div className="bg-blue-900/20 p-4 border-b border-blue-900/30 flex justify-between items-center">
                     <h3 className="text-blue-400 font-bold text-xl uppercase tracking-wider">Blue Team</h3>
                     <button 
                        onClick={() => sendAction('ACTION_CHANGE_TEAM', { team: 'blue' })}
                        className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded"
                     >
                        Join Team
                     </button>
                  </div>
                  <div className="p-4 space-y-2 min-h-[200px]">
                     {blueTeam.map(p => (
                        <div key={p.id} className="flex justify-between items-center bg-slate-900/50 p-3 rounded border border-slate-700/50">
                           <span className="font-medium">{p.name} {p.isHost && '👑'}</span>
                           <button 
                              onClick={() => sendAction('ACTION_CHANGE_ROLE', { team: 'blue', role: p.role === 'spymaster' ? 'operative' : 'spymaster' })}
                              disabled={p.id !== myId}
                              className={clsx(
                                "text-xs px-2 py-1 rounded border",
                                p.role === 'spymaster' ? "bg-yellow-600/20 border-yellow-600 text-yellow-500" : "bg-slate-700 border-slate-600 text-slate-400",
                                p.id !== myId && "opacity-50 cursor-default"
                              )}
                           >
                              {p.role === 'spymaster' ? 'Spymaster' : 'Operative'}
                           </button>
                        </div>
                     ))}
                     {blueTeam.length === 0 && <p className="text-slate-600 italic text-center py-8">No agents assigned</p>}
                  </div>
               </div>
            </div>

            <div className="bg-slate-800/30 p-4 rounded-xl">
               <h4 className="text-slate-500 text-sm font-bold uppercase mb-2">Spectators / Unassigned</h4>
               <div className="flex flex-wrap gap-2">
                  {spectators.map(p => (
                     <span key={p.id} className="px-3 py-1 bg-slate-800 rounded text-slate-400 text-sm border border-slate-700">
                        {p.name}
                     </span>
                  ))}
               </div>
            </div>
         </div>
      </div>
    );
  };

  const renderGame = () => {
    const myPlayer = players.find(p => p.id === myId);
    if (!myPlayer) return <div>Loading...</div>; // Should not happen

    const redScore = gameState.cards.filter(c => c.type === 'red' && !c.revealed).length;
    const blueScore = gameState.cards.filter(c => c.type === 'blue' && !c.revealed).length;
    const isMyTurn = myPlayer.team === gameState.currentTurn;
    const isGameOver = gameState.status === 'red_win' || gameState.status === 'blue_win';

    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col">
         {/* Game Header */}
         <div className="bg-slate-800 border-b border-slate-700 p-4 shadow-md sticky top-0 z-20">
            <div className="max-w-6xl mx-auto flex justify-between items-center">
               <div className="flex items-center gap-6">
                  <div className={clsx("text-2xl font-black px-4 py-2 rounded-lg border-2 transition-all", 
                     gameState.currentTurn === 'red' ? "bg-red-600/20 border-red-600 text-red-500" : "border-transparent text-slate-500 opacity-50")}>
                     {redScore}
                  </div>
                  <div className="text-center">
                     <h1 className="font-bold tracking-tight text-slate-300">PAKcoRde names</h1>
                     <div className={clsx("text-xs font-bold uppercase tracking-widest mt-1 px-2 py-0.5 rounded",
                        gameState.currentTurn === 'red' ? "bg-red-600 text-white" : "bg-blue-600 text-white"
                     )}>
                        {gameState.currentTurn}'s Turn
                     </div>
                  </div>
                  <div className={clsx("text-2xl font-black px-4 py-2 rounded-lg border-2 transition-all", 
                     gameState.currentTurn === 'blue' ? "bg-blue-600/20 border-blue-600 text-blue-500" : "border-transparent text-slate-500 opacity-50")}>
                     {blueScore}
                  </div>
               </div>

               <div className="flex items-center gap-4">
                  <div className="hidden md:block text-right">
                     <div className="text-sm font-bold text-slate-200">{myPlayer.name}</div>
                     <div className="text-xs text-slate-500 uppercase">{myPlayer.team} • {myPlayer.role}</div>
                  </div>
                  {isHost && (
                     <button onClick={() => sendAction('ACTION_RESET')} className="p-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-300" title="Reset Game">
                        <LogOut className="w-4 h-4" />
                     </button>
                  )}
               </div>
            </div>
         </div>

         {/* Game Board */}
         <div className="flex-1 p-4 overflow-y-auto">
            <div className="max-w-6xl mx-auto">
               
               {/* Win Message */}
               {isGameOver && (
                  <div className="mb-8 p-6 bg-slate-800 border border-slate-700 rounded-xl text-center shadow-2xl animate-in fade-in zoom-in duration-500">
                     <Crown className={clsx("w-12 h-12 mx-auto mb-2", gameState.winner === 'red' ? "text-red-500" : "text-blue-500")} />
                     <h2 className="text-4xl font-black text-white mb-2">
                        {gameState.winner === 'red' ? 'RED' : 'BLUE'} TEAM WINS!
                     </h2>
                     <p className="text-slate-400">The operation was a success.</p>
                     {isHost && (
                        <button onClick={() => sendAction('ACTION_RESET')} className="mt-4 bg-white text-slate-900 px-6 py-2 rounded-full font-bold hover:bg-slate-200 transition-colors">
                           Play Again
                        </button>
                     )}
                  </div>
               )}

               <div className="grid grid-cols-5 gap-2 md:gap-4 mb-24">
                  {gameState.cards.map((card, idx) => (
                     <GameCard 
                        key={idx}
                        card={card}
                        isSpymaster={myPlayer.role === 'spymaster'}
                        canInteract={!isGameOver && isMyTurn && myPlayer.role === 'operative'}
                        onClick={() => sendAction('ACTION_REVEAL', { index: idx })}
                     />
                  ))}
               </div>
            </div>
         </div>

         {/* Bottom Action Bar */}
         {!isGameOver && (
            <div className="bg-slate-800 border-t border-slate-700 p-4 sticky bottom-0 z-30">
               <div className="max-w-6xl mx-auto flex justify-between items-center">
                  <div className="text-sm text-slate-400 hidden md:block">
                     Developed by xro
                  </div>
                  
                  <div className="flex-1 flex justify-center">
                     {myPlayer.role === 'spymaster' && isMyTurn ? (
                        <div className="text-yellow-500 font-bold animate-pulse">
                           Give a clue to your operatives!
                        </div>
                     ) : myPlayer.role === 'operative' && isMyTurn ? (
                        <button 
                           onClick={() => sendAction('ACTION_END_TURN')}
                           className="bg-slate-700 hover:bg-slate-600 text-white px-6 py-3 rounded-full font-bold flex items-center gap-2 transition-all hover:scale-105"
                        >
                           End Turn <ArrowRight className="w-4 h-4" />
                        </button>
                     ) : (
                        <div className="text-slate-500 italic">
                           Waiting for {gameState.currentTurn} team...
                        </div>
                     )}
                  </div>
               </div>
            </div>
         )}
      </div>
    );
  };

  // --- Main Render ---

  if (route === 'home') return renderHome();
  if (route === 'lobby') return renderLobby();
  return renderGame();
}