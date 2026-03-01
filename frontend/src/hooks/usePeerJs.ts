import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { getAccessToken, getRoomParticipants, leaveRoom } from '../services/api';
import { RoomConfig, ParticipantInfo, LanguageCode } from '../types';

// Remote peer info
export interface RemotePeerInfo {
  peerId: string;
  participantName: string;
  mediaConnection: MediaConnection | null;
  dataConnection: DataConnection | null;
  audioStream: MediaStream | null;
}

export interface UsePeerJsResult {
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
  participants: ParticipantInfo[];
  isTranslating: boolean;
  isTalking: boolean;  // Push-to-Talk state
  isVideoEnabled: boolean;  // Video toggle state
  lastTranscription: string | null;   // What YOU said
  incomingMessage: IncomingMessage | null;  // Message from OTHER participant
  localStream: MediaStream | null;  // Local audio/video stream
  remotePeers: RemotePeerInfo[];  // Remote peers
  uniqueRoomId: string | null;  // Unique room ID for sharing
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'reconnecting';  // Detailed connection status
  targetLanguage: LanguageCode; // Current listening language
  disconnect: () => Promise<void>;
  startTalking: () => void;  // Push-to-Talk: start
  stopTalking: () => void;   // Push-to-Talk: stop
  toggleVideo: () => void;   // Toggle video on/off
  setTargetLanguage: (lang: LanguageCode) => void; // Update listening language mid-meeting
}

// Message received from another participant
export interface IncomingMessage {
  from: string;
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  wasTranslated: boolean;
  timestamp: number;
}

// Translation WebSocket URL - derived dynamically from environment
function getWsUrl(): string {
  const rawBackendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
  // Remove trailing slash if present
  const backendUrl = rawBackendUrl.replace(/\/+$/, '');
  const wsProtocol = backendUrl.startsWith('https') ? 'wss' : 'ws';
  const wsHost = backendUrl.replace(/^https?:\/\//, '');
  return `${wsProtocol}://${wsHost}/ws/translate`;
}

/**
 * Resample audio from one sample rate to another
 * Uses linear interpolation for simplicity
 */
function resampleAudio(
  inputSamples: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return inputSamples;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(inputSamples.length / ratio);
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputSamples.length - 1);
    const fraction = srcIndex - srcIndexFloor;

    // Linear interpolation
    output[i] = inputSamples[srcIndexFloor] * (1 - fraction) +
      inputSamples[srcIndexCeil] * fraction;
  }

  return output;
}

/**
 * usePeerJs Hook
 * 
 * Manages WebRTC peer-to-peer connections using PeerJS
 * Handles audio/video streaming and translation via WebSocket
 * 
 * @param config - Room configuration (name, participant name, target language)
 * @returns PeerJS connection state and controls
 */
export function usePeerJs(config: RoomConfig): UsePeerJsResult {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>('disconnected');
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTalking, setIsTalking] = useState(false);  // Push-to-Talk state
  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<IncomingMessage | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeerInfo[]>([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [uniqueRoomId, setUniqueRoomId] = useState<string | null>(null);
  const [targetLanguage, setTargetLanguageState] = useState<LanguageCode>(config.targetLanguage);

  // Function to update target language mid-meeting
  const setTargetLanguage = useCallback((newLang: LanguageCode) => {
    console.log(`[Translation] Switching target language to: ${newLang}`);
    setTargetLanguageState(newLang);

    // Update backend via WebSocket if connected
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'configure',
        targetLanguage: newLang
      }));
    }
  }, []);

  // CRITICAL FIX: Stable config key
  const configKey = useMemo(() => JSON.stringify(config), [config.roomName, config.participantName, config.targetLanguage]);

  // Refs
  const isMountedRef = useRef(true);
  const isConnectingRef = useRef(false);
  const peerRef = useRef<Peer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const captureContextRef = useRef<AudioContext | null>(null);
  const playbackContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const isTalkingRef = useRef(false);
  const remoteMediaConnectionsRef = useRef<Map<string, MediaConnection>>(new Map());
  const knownPeersRef = useRef<Set<string>>(new Set());  // Track peers we've already called
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);  // Polling interval for new participants
  const audioCaptureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const participantNamesRef = useRef<Map<string, string>>(new Map());  // Map peer IDs to display names
  const callInProgressRef = useRef<Set<string>>(new Set());  // Track calls currently in progress to avoid duplicates
  const localStreamRef = useRef<MediaStream | null>(null);  // Ref for cleanup access

  /**
   * Update participants list
   */
  const updateParticipants = useCallback(() => {
    const participantList: ParticipantInfo[] = remotePeers.map(peer => ({
      id: peer.peerId,
      name: peer.participantName,
      isSpeaking: false, // Would need audio level detection
      audioLevel: 0
    }));

    setParticipants(participantList);
    console.log(`[PeerJS] Updated participants list: ${participantList.length} remote participants`);
  }, [remotePeers]);

  // Auto-update participants when remotePeers changes
  useEffect(() => {
    updateParticipants();
  }, [updateParticipants]);

  /**



  /**
   * Connect to PeerJS room
   * CRITICAL FIX: Only depends on configKey (serialized config) to prevent
   * reconnection loops when callbacks change due to state updates.
   */
  useEffect(() => {
    isMountedRef.current = true;

    console.log('[PeerJS] Effect run - Starting connection...');
    const currentConfig: RoomConfig = JSON.parse(configKey);

    async function connect() {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;
      setConnectionStatus('connecting');

      try {
        // Step 1: Get access token and unique room ID from backend
        console.log('[PeerJS] ========== GETTING ACCESS TOKEN ==========')
        console.log('[PeerJS] Request config:', currentConfig);
        const tokenResponse = await getAccessToken(currentConfig);
        console.log('[PeerJS] Received token response:', tokenResponse);

        // Set unique room ID for sharing
        if (tokenResponse.uniqueRoomId) {
          setUniqueRoomId(tokenResponse.uniqueRoomId);
        }

        if (!isMountedRef.current) {
          isConnectingRef.current = false;
          return;
        }

        // Step 2: Create PeerJS peer
        console.log(`[PeerJS] Creating Peer instance with ID: ${tokenResponse.peerId}`);
        const peer = new Peer(tokenResponse.peerId!, {
          debug: 3,
          config: {
            iceServers: [
              { urls: 'stun:stun.l.google.com:19302' },
              { urls: 'stun:stun1.l.google.com:19302' },
              { urls: 'stun:stun2.l.google.com:19302' },
              { urls: 'stun:stun3.l.google.com:19302' },
              { urls: 'stun:stun4.l.google.com:19302' }
            ]
          }
        });

        peerRef.current = peer;

        // Handle peer open
        peer.on('open', async (id: string) => {
          console.log(`[PeerJS] Peer connection open: ${id}`);

          if (!isMountedRef.current) return;

          // Step 3: Get local media
          try {
            console.log('[PeerJS] Getting local media stream...');
            const stream = await navigator.mediaDevices.getUserMedia({
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            });

            if (!isMountedRef.current) {
              stream.getTracks().forEach(t => t.stop());
              return;
            }

            setLocalStream(stream);
            localStreamRef.current = stream;
            console.log('[PeerJS] ✓ Local media stream obtained');

            // Store participant names from token response
            if (tokenResponse.participantName) {
              participantNamesRef.current.set(id, tokenResponse.participantName);
            }
            if (tokenResponse.roomParticipants && tokenResponse.roomParticipants.length > 0) {
              for (const participant of tokenResponse.roomParticipants) {
                participantNamesRef.current.set(participant.id, participant.name);
              }
            }

            // IMPORTANT: Set up incoming call handler BEFORE trying to call existing peers
            // This ensures we're ready to receive calls while we're making outbound calls
            peer.on('call', (mediaConnection: MediaConnection) => {
              const callerPeerId = mediaConnection.peer;
              const callerName = participantNamesRef.current.get(callerPeerId) || callerPeerId;

              console.log(`[PeerJS] ✓ Incoming call from ${callerName} (${callerPeerId})`);

              // GLARE FIX: If we already have a SUCCESSFUL connection (stream received), reject
              if (knownPeersRef.current.has(callerPeerId)) {
                console.log(`[PeerJS] Already have active stream from ${callerName}, rejecting duplicate incoming call`);
                mediaConnection.close();
                return;
              }

              // GLARE FIX: If we have an outgoing call in progress (not yet connected),
              // use a tiebreaker to decide who wins. The peer with the lower ID keeps
              // its outgoing call; the other accepts the incoming call.
              if (remoteMediaConnectionsRef.current.has(callerPeerId)) {
                const weAreHigher = id > callerPeerId;
                if (weAreHigher) {
                  // We have higher ID → accept incoming call, close our outgoing one
                  console.log(`[PeerJS] GLARE: Both calling each other. Our ID (${id}) > caller (${callerPeerId}). Accepting incoming, closing outgoing.`);
                  const existingConn = remoteMediaConnectionsRef.current.get(callerPeerId);
                  if (existingConn) existingConn.close();
                  remoteMediaConnectionsRef.current.delete(callerPeerId);
                  callInProgressRef.current.delete(callerPeerId);
                } else {
                  // We have lower ID → keep our outgoing call, reject incoming
                  console.log(`[PeerJS] GLARE: Both calling each other. Our ID (${id}) < caller (${callerPeerId}). Keeping outgoing, rejecting incoming.`);
                  mediaConnection.close();
                  return;
                }
              }

              // Answer with our stream
              mediaConnection.answer(stream);
              remoteMediaConnectionsRef.current.set(callerPeerId, mediaConnection);

              mediaConnection.on('stream', (remoteStream: MediaStream) => {
                knownPeersRef.current.add(callerPeerId);
                callInProgressRef.current.delete(callerPeerId);
                console.log(`[PeerJS] ✓ Successfully received stream from ${callerName} (${callerPeerId})`);
                setRemotePeers(prev => {
                  const updated = prev.map(p => p.peerId === callerPeerId ? { ...p, audioStream: remoteStream } : p);
                  if (!updated.find(p => p.peerId === callerPeerId)) {
                    updated.push({ peerId: callerPeerId, participantName: callerName, mediaConnection: null, dataConnection: null, audioStream: remoteStream });
                  }
                  return updated;
                });
              });

              mediaConnection.on('close', () => {
                console.log(`[PeerJS] Incoming call closed from ${callerName} (${callerPeerId})`);
                remoteMediaConnectionsRef.current.delete(callerPeerId);
                setRemotePeers(prev => prev.filter(p => p.peerId !== callerPeerId));
                knownPeersRef.current.delete(callerPeerId);
              });

              mediaConnection.on('error', (err: any) => {
                console.warn(`[PeerJS] Incoming call error from ${callerName} (${callerPeerId}):`, err);
                remoteMediaConnectionsRef.current.delete(callerPeerId);
                knownPeersRef.current.delete(callerPeerId);
                setRemotePeers(prev => prev.filter(p => p.peerId !== callerPeerId));
              });
            });

            // Step 5: Connect to existing peers from token response
            if (tokenResponse.roomParticipants && tokenResponse.roomParticipants.length > 0) {
              console.log(`[PeerJS] ========== CONNECTING TO EXISTING PARTICIPANTS ==========`)
              console.log(`[PeerJS] Found ${tokenResponse.roomParticipants.length} existing participants:`);
              tokenResponse.roomParticipants.forEach(p => {
                console.log(`[PeerJS]   - ${p.name} (${p.id})`);
              });

              for (const participant of tokenResponse.roomParticipants) {
                if (participant.id !== id) {
                  callInProgressRef.current.add(participant.id);
                  // Inline peer call to avoid dependency on createPeerCall callback
                  try {
                    console.log(`[PeerJS] Initiating call to ${participant.name} (${participant.id})...`);
                    const callTimeout = setTimeout(() => {
                      console.warn(`[PeerJS] Call to ${participant.name} (${participant.id}) timed out after 20s`);
                      remoteMediaConnectionsRef.current.delete(participant.id);
                      callInProgressRef.current.delete(participant.id);
                    }, 20000);

                    const mc = peer.call(participant.id, stream);
                    mc.on('stream', (remoteStream: MediaStream) => {
                      clearTimeout(callTimeout);
                      callInProgressRef.current.delete(participant.id);
                      knownPeersRef.current.add(participant.id);
                      console.log(`[PeerJS] ✓ Successfully connected to ${participant.name} (${participant.id})`);
                      setRemotePeers(prev => {
                        const updated = prev.map(p => p.peerId === participant.id ? { ...p, audioStream: remoteStream } : p);
                        if (!updated.find(p => p.peerId === participant.id)) {
                          updated.push({ peerId: participant.id, participantName: participant.name, mediaConnection: null, dataConnection: null, audioStream: remoteStream });
                        }
                        return updated;
                      });
                    });
                    mc.on('close', () => {
                      clearTimeout(callTimeout);
                      callInProgressRef.current.delete(participant.id);
                      remoteMediaConnectionsRef.current.delete(participant.id);
                      knownPeersRef.current.delete(participant.id);
                      setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                    });
                    mc.on('error', (err: any) => {
                      clearTimeout(callTimeout);
                      callInProgressRef.current.delete(participant.id);
                      remoteMediaConnectionsRef.current.delete(participant.id);
                      knownPeersRef.current.delete(participant.id);
                      setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                      console.warn(`[PeerJS] Call error with ${participant.name} (${participant.id}):`, err);
                    });
                    remoteMediaConnectionsRef.current.set(participant.id, mc);
                  } catch (err) {
                    callInProgressRef.current.delete(participant.id);
                    console.error(`[PeerJS] Failed to initiate call to ${participant.name} (${participant.id}):`, err);
                  }
                }
              }
            } else {
              console.log('[PeerJS] No existing participants found - first to join');
            }

            // Step 6: Start polling for newly joined participants
            if (tokenResponse.uniqueRoomId && !pollIntervalRef.current) {
              console.log('[PeerJS] Starting peer discovery polling every 3 seconds...');
              const roomIdForPolling = tokenResponse.uniqueRoomId!;
              const myPeerId = id;
              const myStream = stream;
              const myPeer = peer;
              pollIntervalRef.current = setInterval(async () => {
                if (!isMountedRef.current) return;
                try {
                  const roomParticipants = await getRoomParticipants(roomIdForPolling);
                  for (const participant of roomParticipants) {
                    if (participant.id === myPeerId) continue;
                    if (knownPeersRef.current.has(participant.id)) continue;  // Already connected with stream
                    if (remoteMediaConnectionsRef.current.has(participant.id)) continue;
                    if (callInProgressRef.current.has(participant.id)) continue;
                    callInProgressRef.current.add(participant.id);
                    participantNamesRef.current.set(participant.id, participant.name);
                    console.log(`[PeerJS] Discovered new participant: ${participant.name} (${participant.id}), attempting to call...`);
                    try {
                      const callTimeout = setTimeout(() => {
                        remoteMediaConnectionsRef.current.delete(participant.id);
                        callInProgressRef.current.delete(participant.id);
                      }, 15000);
                      const mc = myPeer.call(participant.id, myStream);
                      mc.on('stream', (remoteStream: MediaStream) => {
                        clearTimeout(callTimeout);
                        callInProgressRef.current.delete(participant.id);
                        knownPeersRef.current.add(participant.id);
                        console.log(`[PeerJS] ✓ Connected to ${participant.name} (${participant.id})`);
                        setRemotePeers(prev => {
                          const updated = prev.map(p => p.peerId === participant.id ? { ...p, audioStream: remoteStream } : p);
                          if (!updated.find(p => p.peerId === participant.id)) {
                            updated.push({ peerId: participant.id, participantName: participant.name, mediaConnection: null, dataConnection: null, audioStream: remoteStream });
                          }
                          return updated;
                        });
                      });
                      mc.on('close', () => {
                        clearTimeout(callTimeout);
                        callInProgressRef.current.delete(participant.id);
                        remoteMediaConnectionsRef.current.delete(participant.id);
                        knownPeersRef.current.delete(participant.id);
                        setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                      });
                      mc.on('error', (_err: any) => {
                        clearTimeout(callTimeout);
                        callInProgressRef.current.delete(participant.id);
                        remoteMediaConnectionsRef.current.delete(participant.id);
                        knownPeersRef.current.delete(participant.id);
                        setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                      });
                      remoteMediaConnectionsRef.current.set(participant.id, mc);
                    } catch (err) {
                      callInProgressRef.current.delete(participant.id);
                      console.warn(`[PeerJS] Failed to call ${participant.id}:`, err);
                    }
                  }
                } catch (err) {
                  console.error('[PeerJS] Error polling for participants:', err);
                }
              }, 3000);
            }

            // Step 7: Start translation with unique room ID
            {
              const wsUrl = getWsUrl();
              if (wsRef.current?.readyState !== WebSocket.OPEN) {
                console.log(`[Translation] Connecting to WebSocket at ${wsUrl}...`);
                const ws = new WebSocket(wsUrl);
                wsRef.current = ws;
                ws.binaryType = 'arraybuffer';
                ws.onopen = () => {
                  console.log('[Translation] WebSocket connected');
                  setIsTranslating(true);
                  // CRITICAL: Always use uniqueRoomId for the translation service bucket
                  // to ensure all participants in the same PeerJS room can hear each other.
                  const roomForTranslation = tokenResponse.uniqueRoomId;
                  console.log(`[Translation] Connecting to room bucket: ${roomForTranslation}`);

                  ws.send(JSON.stringify({
                    type: 'start',
                    roomName: roomForTranslation,
                    participantId: currentConfig.participantName,
                    targetLanguage: currentConfig.targetLanguage,
                    sampleRate: 16000,
                    channels: 1,
                  }));
                };
                ws.onmessage = (event) => {
                  if (event.data instanceof ArrayBuffer) {
                    // Binary data = translated audio (MP3)
                    playTranslatedAudioInline(event.data);
                  } else {
                    try {
                      const message = JSON.parse(event.data);
                      handleTranslationMessageInline(message);
                    } catch (e) {
                      console.error('[Translation] Failed to parse message:', e);
                    }
                  }
                };
                ws.onclose = () => {
                  console.log('[Translation] WebSocket closed');
                  setIsTranslating(false);
                  wsRef.current = null;
                };
                ws.onerror = (error) => {
                  console.error('[Translation] WebSocket error:', error);
                  setIsTranslating(false);
                };
              }
            }

            // Inline translation message handler (avoids callback dependency)
            function handleTranslationMessageInline(message: any) {
              switch (message.type) {
                case 'started': console.log(`[Translation] Session started (${message.roomParticipants} in room)`); break;
                case 'processing': console.log(`[Translation] Processing ${message.audioSize} bytes...`); break;
                case 'transcription': setLastTranscription(message.text); break;
                case 'incoming_message':
                  setIncomingMessage({
                    from: message.from, originalText: message.originalText,
                    translatedText: message.translatedText, sourceLanguage: message.sourceLanguage,
                    targetLanguage: message.targetLanguage, wasTranslated: message.wasTranslated,
                    timestamp: Date.now(),
                  });
                  break;
                case 'no_speech': console.log('[Translation] No speech detected'); break;
                case 'error': console.error('[Translation] Error:', message.error); break;
              }
            }

            // Inline audio playback (avoids callback dependency)
            async function playTranslatedAudioInline(audioData: ArrayBuffer) {
              try {
                if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
                  console.log('[Audio] Initializing new playback context');
                  playbackContextRef.current = new AudioContext();
                }
                const ac = playbackContextRef.current;

                // Add interaction listener to resume if suspended (standard browser policy fix)
                if (ac.state === 'suspended') {
                  console.log('[Audio] Playback context suspended, waiting for interaction or resuming...');
                  const resume = async () => {
                    if (ac.state === 'suspended') {
                      await ac.resume();
                      console.log('[Audio] Playback context resumed via interaction');
                    }
                    window.removeEventListener('click', resume);
                    window.removeEventListener('keydown', resume);
                  };
                  window.addEventListener('click', resume);
                  window.addEventListener('keydown', resume);

                  // Try to resume immediately just in case
                  await ac.resume().catch(() => { });
                }

                console.log(`[Audio] Received binary data: ${audioData.byteLength} bytes. Decoding...`);
                const buf = await ac.decodeAudioData(audioData.slice(0));
                console.log(`[Audio] Decoded successfully: ${buf.duration.toFixed(2)}s. Playing...`);

                const source = ac.createBufferSource();
                source.buffer = buf;
                source.connect(ac.destination);
                source.start(0);
              } catch (error) {
                console.error('[Translation] Failed to play audio:', error);
              }
            }

            // Start audio capture after a short delay
            if (audioCaptureTimeoutRef.current) clearTimeout(audioCaptureTimeoutRef.current);
            audioCaptureTimeoutRef.current = setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                startAudioCaptureInline();
              }
            }, 1000);

            // Inline audio capture (avoids callback dependency)
            async function startAudioCaptureInline() {
              if (micStreamRef.current || processorRef.current) return;
              try {
                const micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
                micStreamRef.current = micStream;
                const audioContext = new AudioContext();
                captureContextRef.current = audioContext;
                if (audioContext.state === 'suspended') await audioContext.resume();
                const nativeSampleRate = audioContext.sampleRate;
                const targetSampleRate = 16000;
                const source = audioContext.createMediaStreamSource(micStream);
                const processor = audioContext.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;
                processor.onaudioprocess = (event) => {
                  if (!isTalkingRef.current || wsRef.current?.readyState !== WebSocket.OPEN) return;
                  const inputData = event.inputBuffer.getChannelData(0);
                  let samples: Float32Array;
                  if (nativeSampleRate !== targetSampleRate) {
                    samples = resampleAudio(inputData, nativeSampleRate, targetSampleRate);
                  } else {
                    samples = inputData;
                  }
                  const int16Data = new Int16Array(samples.length);
                  for (let i = 0; i < samples.length; i++) {
                    const s = Math.max(-1, Math.min(1, samples[i]));
                    int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                  }
                  wsRef.current!.send(int16Data.buffer);
                };
                source.connect(processor);
                processor.connect(audioContext.destination);
                console.log('[Translation] ✅ Audio capture started');
              } catch (err) {
                console.error('[Translation] Failed to get microphone access:', err);
              }
            }

            // Step 8: Update state
            if (isMountedRef.current) {
              setIsConnected(true);
              setConnectionStatus('connected');
              setIsConnecting(false);
              console.log('[PeerJS] ✓ Conference setup complete');
            }

            isConnectingRef.current = false;
          } catch (err: any) {
            console.error('[PeerJS] Error getting media or setting up peers:', err);
            if (isMountedRef.current) {
              setError(err.message);
              setConnectionStatus('disconnected');
              setIsConnecting(false);
            }
            isConnectingRef.current = false;
          }
        });

        // Handle errors - distinguish between fatal and non-fatal errors
        peer.on('error', (err: any) => {
          const errorMessage = err.message || err.toString();
          console.warn('[PeerJS] Peer error:', errorMessage);

          // Only treat certain errors as fatal
          const isFatalError =
            errorMessage.includes('Could not get local video stream') ||
            errorMessage.includes('Invalid key specified') ||
            errorMessage.includes('Permission denied');

          // "Could not connect to peer" errors are NOT fatal - they're just individual connection issues
          if (isFatalError && isMountedRef.current) {
            setError(errorMessage);
            setIsConnecting(false);
            isConnectingRef.current = false;
          } else {
            // Log non-fatal errors but don't crash the connection
            console.debug('[PeerJS] Non-fatal peer error (will retry):', errorMessage);
          }
        });

        // Handle disconnection
        peer.on('disconnected', () => {
          console.log('[PeerJS] Disconnected from signaling server');
          if (isMountedRef.current) {
            setIsConnected(false);
            setConnectionStatus('reconnecting');
          }
        });
      } catch (err: any) {
        console.error('[PeerJS] Connection error:', err);
        if (isMountedRef.current) {
          setError(err.message || 'Failed to connect');
          setConnectionStatus('disconnected');
          setIsConnecting(false);
        }
        isConnectingRef.current = false;
      }
    }

    connect();

    // Cleanup
    return () => {
      console.log('[PeerJS] Cleanup called');
      isMountedRef.current = false;

      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }

      if (wsRef.current) {
        wsRef.current.close();
      }

      if (processorRef.current) {
        processorRef.current.disconnect();
      }

      if (captureContextRef.current && captureContextRef.current.state !== 'closed') {
        captureContextRef.current.close();
      }

      if (playbackContextRef.current && playbackContextRef.current.state !== 'closed') {
        playbackContextRef.current.close();
      }

      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(t => t.stop());
      }

      if (peerRef.current) {
        peerRef.current.destroy();
      }

      remoteMediaConnectionsRef.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(async () => {
    console.log('[PeerJS] Disconnecting...');

    // Call leave room API if we have a unique room ID and peer ID
    if (uniqueRoomId && peerRef.current?.id) {
      try {
        await leaveRoom(uniqueRoomId, peerRef.current.id);
      } catch (error) {
        console.warn('[PeerJS] Failed to notify backend of leave:', error);
      }
    }

    if (wsRef.current) {
      wsRef.current.close();
    }

    if (peerRef.current) {
      peerRef.current.destroy();
    }

    if (localStream) {
      localStream.getTracks().forEach(t => t.stop());
    }

    setIsConnected(false);
    setIsTranslating(false);
    setConnectionStatus('disconnected');
    setParticipants([]);
    setRemotePeers([]);
  }, [localStream, uniqueRoomId]);

  /**
   * Push-to-Talk: Start
   */
  const startTalking = useCallback(() => {
    console.log('[PTT] Started talking');
    isTalkingRef.current = true;
    setIsTalking(true);

    // Resume audio contexts on user gesture to avoid browser blocking
    if (playbackContextRef.current?.state === 'suspended') {
      playbackContextRef.current.resume().catch(e => console.error('[Audio] Failed to resume playback context:', e));
    }
    if (captureContextRef.current?.state === 'suspended') {
      captureContextRef.current.resume().catch(e => console.error('[Audio] Failed to resume capture context:', e));
    }
  }, []);

  /**
   * Push-to-Talk: Stop
   */
  const stopTalking = useCallback(() => {
    console.log('[PTT] Stopped talking');
    isTalkingRef.current = false;
    setIsTalking(false);

    // Send a finish message to immediately flush the remaining audio for transcription
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'finish' }));
    }
  }, []);

  /**
   * Toggle video
   */
  const toggleVideo = useCallback(() => {
    if (localStream) {
      const videoTracks = localStream.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = !isVideoEnabled;
      });
      setIsVideoEnabled(!isVideoEnabled);
      console.log(`[PeerJS] Video ${!isVideoEnabled ? 'enabled' : 'disabled'}`);
    }
  }, [localStream, isVideoEnabled]);

  return {
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
    connectionStatus,
    targetLanguage,
    disconnect,
    startTalking,
    stopTalking,
    toggleVideo,
    setTargetLanguage
  };
}

export default usePeerJs;
