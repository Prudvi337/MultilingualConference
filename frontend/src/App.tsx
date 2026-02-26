/**
 * Main Application Component
 * 
 * Manages application state:
 * - Not connected: Show join room form
 * - Connected: Show conference room
 */

import { useState } from 'react';
import JoinRoom from './components/JoinRoom';
import Conference from './components/Conference';
import { RoomConfig } from './types';

function App() {
  const [roomConfig, setRoomConfig] = useState<RoomConfig | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  /**
   * Handle room join
   * Called when user submits the join form
   */
  const handleJoinRoom = (config: RoomConfig) => {
    setRoomConfig(config);
    setIsConnected(true);
  };

  /**
   * Handle disconnect
   * Called when user leaves the room
   */
  const handleDisconnect = () => {
    setRoomConfig(null);
    setIsConnected(false);
  };

  return (
    <>
      {!isConnected ? (
        <JoinRoom onJoin={handleJoinRoom} />
      ) : (
        <Conference 
          config={roomConfig!} 
          onDisconnect={handleDisconnect} 
        />
      )}
    </>
  );
}

export default App;

