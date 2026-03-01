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
import { RoomConfig, LanguageCode } from '../types';
import { LANGUAGES } from '../constants';

interface ConferenceProps {
  config: RoomConfig;
  onDisconnect: () => void;
}

export default function Conference({ config, onDisconnect }: ConferenceProps) {
  const {
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
    targetLanguage,
    disconnect,
    startTalking,
    stopTalking,
    toggleVideo,
    setTargetLanguage,
    setSpeakerLanguage
  } = usePeerJs(config);

  // Message history for better UX
  const [messageHistory, setMessageHistory] = useState<Array<{
    id: string;
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
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
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
        <div className="text-center p-4">
          <div className="relative mx-auto w-24 h-24">
            <div className="w-24 h-24 border-4 border-purple-500/30 rounded-full animate-spin border-t-purple-500"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-3xl">🎤</span>
            </div>
          </div>
          <h2 className="mt-6 text-xl md:text-2xl font-bold text-white">Joining Room...</h2>
          <p className="mt-2 text-purple-300 break-all">{config.roomName}</p>
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
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-red-900/50 to-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800/80 backdrop-blur-xl rounded-2xl p-6 md:p-8 max-w-md w-full border border-red-500/30 shadow-2xl">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">❌</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Connection Failed</h2>
            <p className="text-gray-400 mb-6 text-sm">{error}</p>
            <button
              onClick={onDisconnect}
              className="w-full px-6 py-3 bg-gradient-to-r from-red-600 to-pink-600 text-white rounded-xl font-medium hover:from-red-700 hover:to-pink-700 transition-all shadow-lg"
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
    <div className="fixed inset-0 bg-slate-900 flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 right-0 z-30 bg-gradient-to-b from-slate-900/95 via-slate-900/80 to-transparent p-3 md:p-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg md:rounded-xl flex items-center justify-center shadow-lg flex-shrink-0">
              <span className="text-lg md:text-xl">🌐</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-white font-bold text-sm md:text-base truncate">{config.roomName}</h1>
              <p className="text-[10px] md:text-xs text-gray-400">
                {participants.length + 1} participant{participants.length !== 0 ? 's' : ''} total
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 sm:pb-0">
            {/* Status Indicator */}
            <div className="flex items-center gap-2 bg-slate-800/60 backdrop-blur-sm px-2 md:px-3 py-1 md:py-1.5 rounded-full flex-shrink-0">
              {isTranslating && (
                <span className="flex items-center gap-1.5 text-[10px] md:text-xs text-emerald-400 whitespace-nowrap">
                  <span className="w-1.5 h-1.5 md:w-2 md:h-2 bg-emerald-400 rounded-full animate-pulse"></span>
                  AI Active
                </span>
              )}
            </div>

            {/* Language Selection mid-meeting */}
            <div className="flex items-center gap-1.5 bg-slate-800/60 backdrop-blur-sm px-2 md:px-3 py-1 md:py-1.5 rounded-full flex-shrink-0 border border-purple-500/20">
              <span className="text-[10px] md:text-xs text-gray-400 hidden xs:inline">My Language:</span>
              <select
                value={targetLanguage}
                onChange={(e) => {
                  const lang = e.target.value as LanguageCode;
                  setTargetLanguage(lang);
                  setSpeakerLanguage(lang);
                }}
                className="bg-transparent text-[10px] md:text-xs text-purple-400 font-medium outline-none cursor-pointer appearance-none text-center"
              >
                {LANGUAGES.map(lang => (
                  <option key={lang.code} value={lang.code} className="bg-slate-800 text-white">
                    {lang.flag} {lang.name}
                  </option>
                ))}
              </select>
              <span className="text-[8px] text-purple-400/50">▼</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Video Area */}
      <div className="flex-1 relative bg-slate-900 overflow-hidden flex flex-col">
        {/* Remote Video (Full Screen) */}
        <div className="absolute inset-0 z-0">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover transition-opacity duration-700 ${remotePeers.some(p => p.audioStream) ? 'opacity-100' : 'opacity-0'
              }`}
          />
        </div>

        {/* Waiting State - Show when no remote video */}
        <div className={`absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-900 to-slate-800 flex items-center justify-center p-6 z-0 transition-opacity duration-700 pointer-events-none ${!remotePeers.some(p => p.audioStream) ? 'opacity-100' : 'opacity-0'
          }`}>
          <div className="text-center max-w-xs w-full pointer-events-auto">
            <div className="w-24 h-24 md:w-32 md:h-32 bg-slate-700/50 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-dashed border-slate-600">
              <span className="text-4xl md:text-5xl opacity-50">👥</span>
            </div>
            <h3 className="text-lg md:text-xl font-medium text-gray-300 mb-2">Waiting for others...</h3>
            <p className="text-gray-500 text-xs md:text-sm mb-4">Share Room ID to invite:</p>
            <div className="flex items-center gap-2 bg-slate-800 px-3 py-2 rounded-xl border border-white/5">
              <span className="text-purple-400 font-mono text-[10px] md:text-xs truncate flex-1">{uniqueRoomId || config.roomName}</span>
              <button
                onClick={() => navigator.clipboard.writeText(uniqueRoomId || config.roomName)}
                className="text-gray-400 hover:text-white transition p-1"
              >
                📋
              </button>
            </div>
            {participants.length > 0 && (
              <div className="mt-4 text-[10px] md:text-xs text-gray-400">
                {participants.length} joined (connecting audio...)
              </div>
            )}
          </div>
        </div>

        {/* Remote Participant Names Overlay */}
        <div className="absolute left-3 top-24 md:left-4 md:top-28 space-y-2 z-10 max-h-[40vh] overflow-y-auto no-scrollbar pointer-events-none">
          {participants.map((participant) => {
            const remotePeer = remotePeers.find(p => p.peerId === participant.id);
            const hasStream = remotePeer?.audioStream;

            if (!hasStream) return null;

            return (
              <div
                key={participant.id}
                className="bg-black/40 backdrop-blur-sm px-2 py-1 md:px-3 md:py-1.5 rounded-lg border border-white/5 pointer-events-auto"
              >
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 md:w-8 md:h-8 bg-gradient-to-br from-blue-500 to-cyan-500 rounded-full flex items-center justify-center text-white font-bold text-xs">
                    {participant.name[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-medium text-[10px] md:text-sm">{participant.name}</p>
                    <p className="text-gray-400 text-[8px] md:text-xs">
                      {participant.isSpeaking ? '🎙️ Speaking' : '🔇 Silent'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Local Video (PiP) - Repositioned and resized for mobile */}
        <div className={`absolute bottom-28 right-3 md:right-4 w-28 md:w-48 aspect-video rounded-lg md:rounded-xl overflow-hidden shadow-2xl border-2 transition-all duration-300 z-20 ${isTalking ? 'border-red-500 ring-2 md:ring-4 ring-red-500/30' : 'border-slate-600/50'
          }`}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${localStream ? '' : 'hidden'}`}
            style={{ transform: 'scaleX(-1)' }}
          />

          {!isVideoEnabled && (
            <div className="absolute inset-0 bg-slate-800 flex items-center justify-center z-10">
              <div className="text-center">
                <div className="w-12 h-12 md:w-16 md:h-16 bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-xl md:text-3xl text-white font-bold">
                    {config.participantName[0].toUpperCase()}
                  </span>
                </div>
                <p className="text-[10px] md:text-xs text-gray-400">Camera Off</p>
              </div>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5 md:p-3 z-20 pointer-events-none">
            <div className="flex items-center justify-between">
              <span className="text-white text-[8px] md:text-xs font-medium">You</span>
              {isTalking && (
                <span className="bg-red-500 text-white text-[6px] md:text-[10px] px-1 md:px-2 py-0.5 rounded-full animate-pulse">
                  LIVE
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Translation Messages Overlay - Improved mobile sizing */}
        <div className="absolute bottom-28 left-3 md:left-4 w-[calc(100%-120px)] md:w-80 max-h-[30vh] md:max-h-64 overflow-hidden z-20 pointer-events-none">
          {messageHistory.length > 0 && (
            <div className="space-y-1.5 md:space-y-2">
              {messageHistory.slice(0, 3).map((msg, i) => (
                <div
                  key={msg.id}
                  className={`bg-black/60 backdrop-blur-sm rounded-lg md:rounded-xl p-2 md:p-3 border border-white/10 transition-all duration-500 pointer-events-auto shadow-lg ${i === 0 ? 'opacity-100 scale-100' : i === 1 ? 'opacity-70 scale-95' : 'opacity-40 scale-90'
                    }`}
                >
                  <div className="flex items-center gap-2 mb-0.5 md:mb-1">
                    <div className="w-4 h-4 md:w-5 md:h-5 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-full flex items-center justify-center text-white text-[8px] md:text-[10px] font-bold flex-shrink-0">
                      {msg.from[0]}
                    </div>
                    <span className="text-emerald-400 text-[10px] md:text-xs font-medium truncate">{msg.from}</span>
                    <span className="text-gray-500 text-[8px] md:text-[10px] ml-auto">
                      {msg.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-white text-[11px] md:text-sm leading-relaxed">{msg.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Controls - Optimized for touch and mobile height */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-900 via-slate-900/95 to-transparent pb-6 md:pb-8 pt-12 px-4 z-30 pointer-events-none">
        <div className="max-w-3xl mx-auto flex flex-col items-center pointer-events-auto">
          {/* Your Transcription - Wrapped in a fixed-height container to prevent layout shift */}
          <div className="w-full h-12 md:h-16 flex items-center justify-center mb-1">
            {lastTranscription && (
              <div className="w-full text-center">
                <div className="inline-flex items-center gap-2 bg-purple-500/10 border border-purple-500/20 px-3 py-1.5 md:px-4 md:py-2 rounded-xl max-w-[90%] transition-all animate-in fade-in slide-in-from-bottom-2">
                  <span className="text-[12px] md:text-base">🎤</span>
                  <span className="text-purple-200 text-[10px] md:text-sm italic truncate">"{lastTranscription}"</span>
                </div>
              </div>
            )}
          </div>

          {/* Controls Row */}
          <div className="flex items-center justify-center gap-3 md:gap-6">
            {/* Video Toggle Button */}
            <button
              onClick={toggleVideo}
              className={`w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center transition-all shadow-lg border border-white/5 ${isVideoEnabled
                ? 'bg-slate-800 hover:bg-slate-700'
                : 'bg-red-600 hover:bg-red-700'
                }`}
              title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isVideoEnabled ? "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" : "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z M3 3l18 18"} />
              </svg>
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
              <div className={`absolute inset-0 rounded-full blur-xl transition-all duration-300 ${isTalking
                ? 'bg-red-500/50 animate-pulse'
                : 'bg-purple-500/10 group-hover:bg-purple-500/30'
                }`}></div>

              <div className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-200 border-2 border-white/10 ${isTalking
                ? 'bg-gradient-to-br from-red-500 to-pink-600 shadow-lg shadow-red-500/50'
                : 'bg-gradient-to-br from-purple-600 to-blue-600 shadow-lg shadow-purple-500/30'
                }`}>
                {isTalking ? (
                  <div className="flex gap-1 justify-center items-center">
                    {[1, 2, 3].map((v) => (
                      <div key={v} className="w-1 bg-white rounded-full animate-bounce" style={{ height: '14px', animationDelay: `${v * 0.1}s` }}></div>
                    ))}
                  </div>
                ) : (
                  <svg className="w-7 h-7 md:w-8 md:h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                  </svg>
                )}
              </div>
              <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap">
                <span className={`text-[10px] font-medium uppercase tracking-wider ${isTalking ? 'text-red-400' : 'text-gray-500'}`}>
                  {isTalking ? 'Active' : 'Hold'}
                </span>
              </div>
            </button>

            {/* End Call Button */}
            <button
              onClick={handleDisconnect}
              className="w-12 h-12 md:w-14 md:h-14 bg-red-600/90 hover:bg-red-700 rounded-full flex items-center justify-center transition-all shadow-lg"
              title="Leave Room"
            >
              <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 8l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.28 3H5z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


