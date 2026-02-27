/**
 * Conference Component
 * 
 * Modern conference room interface with real-time translation.
 * Features:
 * - Full-screen video layout
 * - Picture-in-picture local video
 * - Real-time translation overlay
 * - Elegant push-to-talk interface
 * - Video toggle controls
 * - Clean, professional design
 */

import { useEffect, useRef, useState } from 'react';
import { usePeerJs } from '../hooks/usePeerJs';
import { RoomConfig } from '../types';

interface ConferenceProps {
  config: RoomConfig;
  onDisconnect: () => void;
}

export default function Conference({ config, onDisconnect }: ConferenceProps) {
  const {
    isConnected,
    isConnecting,
    error,
    participants,
    isTranslating,
    isTalking,
    isVideoEnabled,
    lastTranscription,
    incomingMessage,
    localStream,
    remotePeers,
    uniqueRoomId,
    disconnect,
    startTalking,
    stopTalking,
    toggleVideo
  } = usePeerJs(config);

  // Message history for better UX
  const [messageHistory, setMessageHistory] = useState<Array<{
    from: string;
    text: string;
    original: string;
    time: Date;
  }>>([]);

  // Video attachment
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);

  // Attach local stream to video element
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      console.log('[Video] Local stream attached');
    }
  }, [localStream]);

  // Attach remote stream to video element
  useEffect(() => {
    if (remoteVideoRef.current && remotePeers.length > 0) {
      // Find the first peer with an active audio stream
      const activePeer = remotePeers.find(p => p.audioStream);
      if (activePeer) {
        remoteVideoRef.current.srcObject = activePeer.audioStream;
        console.log(`[Video] Remote stream attached from ${activePeer.participantName}`);
      }
    }
  }, [remotePeers]);

  // Add incoming messages to history
  useEffect(() => {
    if (incomingMessage) {
      setMessageHistory(prev => [{
        from: incomingMessage.from,
        text: incomingMessage.translatedText,
        original: incomingMessage.originalText,
        time: new Date()
      }, ...prev].slice(0, 10));
    }
  }, [incomingMessage]);

  /**
   * Handle disconnect
   */
  const handleDisconnect = async () => {
    await disconnect();
    onDisconnect();
  };

  // Show loading state
  if (isConnecting) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-24 h-24 border-4 border-purple-500/30 rounded-full animate-spin border-t-purple-500"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">🎤</span>
            </div>
          </div>
          <h2 className="mt-6 text-2xl font-bold text-white">Joining Room...</h2>
          <p className="mt-2 text-purple-300">{config.roomName}</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-purple-400">
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
            Connecting as {config.participantName}
          </div>
        </div>
      </div>
    );
  }

  // Show error state
  if (error) {
    return (
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-red-900/50 to-slate-900 flex items-center justify-center">
        <div className="bg-slate-800/80 backdrop-blur-xl rounded-2xl p-8 max-w-md mx-4 border border-red-500/30 shadow-2xl">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Connection Failed</h2>
            <p className="text-gray-400 mb-6">{error}</p>
            <button
              onClick={onDisconnect}
              className="px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl font-medium hover:from-red-700 hover:to-pink-700 transition-all shadow-lg"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Remote participant info for display

  return (
    <div className="fixed inset-0 bg-slate-900 flex flex-col">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-20 bg-gradient-to-b from-slate-900/90 to-transparent p-4">
        <div className="flex items-center justify-between max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <span className="text-xl">🌐</span>
            </div>
            <div>
              <h1 className="text-white font-bold">{config.roomName}</h1>
              <p className="text-xs text-gray-400">
                {participants.length + 1} participant{participants.length !== 0 ? 's' : ''} total
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Indicators */}
            <div className="flex items-center gap-2 bg-slate-800/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              {isTranslating && (
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                  AI Active
                </span>
              )}
              {isConnected && (
                <span className="flex items-center gap-1.5 text-xs text-blue-400">
                  <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></span>
                  Connected
                </span>
              )}
            </div>

            {/* Language Badge */}
            <div className="bg-slate-800/60 backdrop-blur-sm px-3 py-1.5 rounded-full">
              <span className="text-xs text-gray-300">
                Listening in: <span className="text-purple-400 font-medium">{getLanguageName(config.targetLanguage)}</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Video Area */}
      <div className="flex-1 relative">
        {/* Remote Video (Full Screen) - Show first active participant */}
        {remotePeers.some(p => p.audioStream) && (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
            onLoadedData={() => {
              // Find the first peer with audio stream and attach it
              const activePeer = remotePeers.find(p => p.audioStream);
              if (activePeer && remoteVideoRef.current) {
                remoteVideoRef.current.srcObject = activePeer.audioStream;
                console.log('[Video] Attached active peer stream to main video');
              }
            }}
          />
        )}

        {/* Waiting State - Show when no remote video */}
        {(!remotePeers.length || !remotePeers.some(p => p.audioStream)) && (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 flex items-center justify-center">
            <div className="text-center">
              <div className="w-32 h-32 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-dashed border-slate-600">
                <span className="text-5xl opacity-50">�</span>
              </div>
              <h3 className="text-xl font-medium text-gray-300 mb-2">Waiting for participants...</h3>
              <p className="text-gray-500 text-sm mb-4">Share this unique room ID to invite participants:</p>
              <div className="inline-flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-xl">
                <span className="text-purple-400 font-mono text-sm">{uniqueRoomId || config.roomName}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(uniqueRoomId || config.roomName)}
                  className="text-gray-400 hover:text-white transition"
                >
                  📋
                </button>
              </div>
              {participants.length > 0 && (
                <div className="mt-4 text-sm text-gray-400">
                  {participants.length} participant{participants.length !== 1 ? 's' : ''} joined (connecting audio/video...)
                </div>
              )}
            </div>
          </div>
        )}

        {/* Remote Participant Names Overlay - Show all participants */}
        {participants.map((participant, index) => {
          const remotePeer = remotePeers.find(p => p.peerId === participant.id);
          const hasStream = remotePeer?.audioStream;

          if (!hasStream) return null;

          return (
            <div
              key={participant.id}
              className="absolute top-50 left-4 bg-black/40 backdrop-blur-sm px-3 py-1.5 rounded-lg"
              style={{ top: `${20 + index * 60}px` }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-sm">
                  {participant.name[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{participant.name}</p>
                  <p className="text-gray-400 text-xs">
                    {participant.isSpeaking ? '🎙️ Speaking' : '🔇 Silent'}
                  </p>
                </div>
              </div>
            </div>
          );
        })}

        {/* Local Video (PiP) */}
        <div className={`absolute bottom-28 right-4 w-48 aspect-video rounded-xl overflow-hidden shadow-2xl border-2 transition-all duration-300 ${isTalking ? 'border-red-500 ring-4 ring-red-500/30' : 'border-slate-600'
          }`}>
          {/* Video element */}
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${localStream ? '' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }}
          />

          {/* Placeholder when video is off */}
          {!localStream && (
            <div className="w-full h-full bg-slate-800 flex items-center justify-center">
              <div className="text-center">
                <div className="w-12 h-12 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-xl text-white">
                    {config.participantName[0].toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-gray-400">Starting camera...</p>
              </div>
            </div>
          )}

          {/* Local Video Overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent pointer-events-none"></div>
          <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between">
            <span className="text-white text-xs font-medium">You</span>
            {isTalking && (
              <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full animate-pulse">
                LIVE
              </span>
            )}
          </div>
        </div>

        {/* Translation Messages Overlay */}
        <div className="absolute bottom-28 left-4 w-80 max-h-64 overflow-hidden">
          {messageHistory.length > 0 && (
            <div className="space-y-2">
              {messageHistory.slice(0, 3).map((msg, i) => (
                <div
                  key={i}
                  className={`bg-black/60 backdrop-blur-sm rounded-xl p-3 border border-white/10 transition-all duration-500 ${i === 0 ? 'opacity-100' : i === 1 ? 'opacity-70' : 'opacity-40'
                    }`}
                  style={{ transform: `translateY(${i * 4}px)` }}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-5 h-5 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                      {msg.from[0]}
                    </div>
                    <span className="text-emerald-400 text-xs font-medium">{msg.from}</span>
                    <span className="text-gray-500 text-xs">
                      {msg.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-white text-sm leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900 via-slate-900/95 to-transparent pt-8 pb-6 px-4">
        <div className="max-w-3xl mx-auto">
          {/* Your Transcription */}
          {lastTranscription && (
            <div className="text-center mb-4">
              <div className="inline-flex items-center gap-2 bg-purple-500/20 border border-purple-500/30 px-4 py-2 rounded-xl">
                <span className="text-purple-400">🎤</span>
                <span className="text-purple-200 text-sm">{lastTranscription}</span>
              </div>
            </div>
          )}

          {/* Controls Row */}
          <div className="flex items-center justify-center gap-4">
            {/* Video Toggle Button */}
            <button
              onClick={toggleVideo}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-lg ${isVideoEnabled
                  ? 'bg-slate-700 hover:bg-slate-600'
                  : 'bg-red-600 hover:bg-red-700'
                }`}
              title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {isVideoEnabled ? (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              ) : (
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3l18 18" />
                </svg>
              )}
            </button>

            {/* Push-to-Talk Button */}
            <button
              onMouseDown={startTalking}
              onMouseUp={stopTalking}
              onMouseLeave={stopTalking}
              onTouchStart={(e) => { e.preventDefault(); startTalking(); }}
              onTouchEnd={(e) => { e.preventDefault(); stopTalking(); }}
              className={`relative group transition-all duration-200 select-none touch-none ${isTalking ? 'scale-110' : 'hover:scale-105'
                }`}
            >
              {/* Glow Effect */}
              <div className={`absolute inset-0 rounded-full blur-xl transition-all duration-300 ${isTalking
                  ? 'bg-red-500/50 animate-pulse'
                  : 'bg-purple-500/20 group-hover:bg-purple-500/40'
                }`}></div>

              {/* Button */}
              <div className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-200 ${isTalking
                  ? 'bg-gradient-to-br from-red-500 to-pink-600 shadow-lg shadow-red-500/50'
                  : 'bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/30 group-hover:shadow-purple-500/50'
                }`}>
                {isTalking ? (
                  <div className="flex items-center justify-center">
                    <div className="flex gap-1">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="w-1 bg-white rounded-full animate-pulse"
                          style={{
                            height: `${12 + Math.random() * 12}px`,
                            animationDelay: `${i * 0.1}s`
                          }}
                        />
                      ))}
                    </div>
                  </div>
                ) : (
                  <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                )}
              </div>

              {/* Label */}
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className={`text-xs font-medium ${isTalking ? 'text-red-400' : 'text-gray-400'}`}>
                  {isTalking ? 'Release to Send' : 'Hold to Talk'}
                </span>
              </div>
            </button>

            {/* End Call Button */}
            <button
              onClick={handleDisconnect}
              className="w-14 h-14 bg-red-600 hover:bg-red-700 rounded-full flex items-center justify-center transition-all shadow-lg hover:shadow-red-500/30"
              title="Leave Room"
            >
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Helper function to get language display name
 */
function getLanguageName(code: string): string {
  const languages: Record<string, string> = {
    en: 'English',
    hi: 'Hindi',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ja: 'Japanese',
    ko: 'Korean',
    zh: 'Chinese'
  };
  return languages[code] || code;
}
