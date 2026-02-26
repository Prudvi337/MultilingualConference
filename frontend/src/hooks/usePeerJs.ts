import { useState, useEffect, useCallback, useRef } from 'react';
import Peer, { DataConnection, MediaConnection } from 'peerjs';
import { getAccessToken, getRoomParticipants } from '../services/api';
import { RoomConfig, ParticipantInfo } from '../types';

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
  lastTranslation: string | null;     // Translation of what YOU said
  incomingMessage: IncomingMessage | null;  // Message from OTHER participant
  localStream: MediaStream | null;  // Local audio/video stream
  remotePeers: RemotePeerInfo[];  // Remote peers
  uniqueRoomId: string | null;  // Unique room ID for sharing
  disconnect: () => Promise<void>;
  startTalking: () => void;  // Push-to-Talk: start
  stopTalking: () => void;   // Push-to-Talk: stop
  toggleVideo: () => void;   // Toggle video on/off
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

// Translation WebSocket URL
const WS_URL = 'ws://localhost:3001/ws/translate';

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
  const [participants, setParticipants] = useState<ParticipantInfo[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isTalking, setIsTalking] = useState(false);  // Push-to-Talk state
  const [lastTranscription, setLastTranscription] = useState<string | null>(null);
  const [lastTranslation] = useState<string | null>(null);
  const [incomingMessage, setIncomingMessage] = useState<IncomingMessage | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remotePeers, setRemotePeers] = useState<RemotePeerInfo[]>([]);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [uniqueRoomId, setUniqueRoomId] = useState<string | null>(null);

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
  }, [remotePeers]);

  /**
   * Handle incoming media from remote peer
   */
  const handleRemoteMediaStream = useCallback((stream: MediaStream, peerId: string, peerName: string) => {
    console.log(`[PeerJS] Received media stream from ${peerName} (${peerId})`);
    
    setRemotePeers(prev => {
      const updated = prev.map(p => {
        if (p.peerId === peerId) {
          return { ...p, audioStream: stream };
        }
        return p;
      });
      
      if (!updated.find(p => p.peerId === peerId)) {
        updated.push({
          peerId,
          participantName: peerName,
          mediaConnection: null,
          dataConnection: null,
          audioStream: stream
        });
      }
      
      return updated;
    });
  }, []);

  /**
   * Poll for newly joined participants and call them
   */
  const pollForNewParticipants = useCallback(async (roomId: string, myPeerId: string, stream: MediaStream, peer: Peer) => {
    if (!isMountedRef.current) {
      return;
    }

    try {
      const participants = await getRoomParticipants(roomId);
      
      // For each participant, if we haven't called them yet, try to call
      for (const participant of participants) {
        // Skip self
        if (participant.id === myPeerId) {
          continue;
        }

        // Skip if we've already tried to connect to this peer
        if (knownPeersRef.current.has(participant.id)) {
          continue;
        }

        // Skip if we already have a media connection with this peer
        if (remoteMediaConnectionsRef.current.has(participant.id)) {
          knownPeersRef.current.add(participant.id);
          continue;
        }

        // Mark as known before attempting call
        knownPeersRef.current.add(participant.id);
        console.log(`[PeerJS] Discovered new participant: ${participant.name} (${participant.id}), calling them...`);
        
        try {
          // Set a timeout for the connection attempt
          const callTimeout = setTimeout(() => {
            console.warn(`[PeerJS] Connection to ${participant.id} timed out, removing from known peers`);
            remoteMediaConnectionsRef.current.delete(participant.id);
            knownPeersRef.current.delete(participant.id);
          }, 10000);  // 10 second timeout per call

          const mediaConnection = peer.call(participant.id, stream);
          
          mediaConnection.on('stream', (remoteStream: MediaStream) => {
            clearTimeout(callTimeout);
            console.log(`[PeerJS] ✓ Connected to ${participant.id}`);
            handleRemoteMediaStream(remoteStream, participant.id, participant.name);
          });

          mediaConnection.on('close', () => {
            clearTimeout(callTimeout);
            console.log(`[PeerJS] Media connection closed with ${participant.id}`);
            remoteMediaConnectionsRef.current.delete(participant.id);
            setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
          });

          mediaConnection.on('error', (err: any) => {
            clearTimeout(callTimeout);
            console.warn(`[PeerJS] Media connection error with ${participant.id}:`, err);
            // Remove from known peers so we retry if they reconnect
            remoteMediaConnectionsRef.current.delete(participant.id);
            knownPeersRef.current.delete(participant.id);
            setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
          });

          remoteMediaConnectionsRef.current.set(participant.id, mediaConnection);
        } catch (err) {
          console.warn(`[PeerJS] Failed to call ${participant.id}:`, err);
          // Remove from known peers if call failed
          remoteMediaConnectionsRef.current.delete(participant.id);
          knownPeersRef.current.delete(participant.id);
        }
      }
    } catch (err) {
      console.error('[PeerJS] Error polling for new participants:', err);
    }
  }, [handleRemoteMediaStream]);

  /**
   * Connect to translation WebSocket
   */
  const connectTranslation = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    console.log('[Translation] Connecting to WebSocket...');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[Translation] WebSocket connected');
      setIsTranslating(true);
      
      // Send start message
      ws.send(JSON.stringify({
        type: 'start',
        roomName: config.roomName,
        participantId: config.participantName,
        targetLanguage: config.targetLanguage,
        sampleRate: 16000,
        channels: 1,
      }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary data = translated audio (MP3)
        console.log(`[Translation] Received audio: ${event.data.byteLength} bytes`);
        playTranslatedAudio(event.data);
      } else {
        // JSON message
        try {
          const message = JSON.parse(event.data);
          handleTranslationMessage(message);
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
  }, [config]);

  /**
   * Handle translation messages
   */
  const handleTranslationMessage = useCallback((message: any) => {
    console.log('[Translation] Message:', message.type, message);

    switch (message.type) {
      case 'started':
        console.log(`[Translation] Session started (${message.roomParticipants} in room)`);
        break;

      case 'processing':
        console.log(`[Translation] Processing ${message.audioSize} bytes...`);
        break;

      case 'transcription':
        setLastTranscription(message.text);
        console.log(`[Translation] Your transcription: "${message.text}"`);
        break;

      case 'incoming_message':
        console.log(`[Translation] 📥 Message from ${message.from}: "${message.translatedText}"`);
        setIncomingMessage({
          from: message.from,
          originalText: message.originalText,
          translatedText: message.translatedText,
          sourceLanguage: message.sourceLanguage,
          targetLanguage: message.targetLanguage,
          wasTranslated: message.wasTranslated,
          timestamp: Date.now(),
        });
        break;

      case 'no_speech':
        console.log('[Translation] No speech detected');
        break;

      case 'error':
        console.error('[Translation] Error:', message.error);
        break;
    }
  }, []);

  /**
   * Play translated audio (MP3)
   */
  const playTranslatedAudio = useCallback(async (audioData: ArrayBuffer) => {
    try {
      if (!playbackContextRef.current || playbackContextRef.current.state === 'closed') {
        playbackContextRef.current = new AudioContext();
        console.log('[Translation] Created new playback AudioContext');
      }

      const audioContext = playbackContextRef.current;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));
      
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
      
      console.log('[Translation] 🔊 Playing translated audio');
    } catch (error) {
      console.error('[Translation] Failed to play audio:', error);
    }
  }, []);

  /**
   * Start capturing audio directly from microphone for translation
   */
  const startAudioCapture = useCallback(async () => {
    if (micStreamRef.current || processorRef.current) {
      console.log('[Translation] Audio capture already active, skipping');
      return;
    }

    console.log('[Translation] Starting audio capture directly from microphone...');

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      });
      micStreamRef.current = micStream;
      
      const audioTracks = micStream.getAudioTracks();
      console.log(`[Translation] Got microphone: ${audioTracks.length} track(s)`);

      if (audioTracks.length === 0 || audioTracks[0].readyState !== 'live') {
        console.error('[Translation] Microphone track not active!');
        return;
      }

      const audioContext = new AudioContext();
      captureContextRef.current = audioContext;
      
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      const nativeSampleRate = audioContext.sampleRate;
      const targetSampleRate = 16000;
      console.log(`[Translation] Native sample rate: ${nativeSampleRate}Hz, target: ${targetSampleRate}Hz`);

      const source = audioContext.createMediaStreamSource(micStream);
      const processor = audioContext.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      let frameCount = 0;
      let lastLogTime = Date.now();

      processor.onaudioprocess = (event) => {
        frameCount++;
        
        const now = Date.now();
        if (now - lastLogTime > 2000) {
          const inputData = event.inputBuffer.getChannelData(0);
          let max = 0, min = 0, sum = 0;
          for (let i = 0; i < inputData.length; i++) {
            const v = inputData[i];
            if (v > max) max = v;
            if (v < min) min = v;
            sum += Math.abs(v);
          }
          const avg = sum / inputData.length;
          console.log(`[Translation] Audio flowing: ${frameCount} frames, range=[${min.toFixed(4)}, ${max.toFixed(4)}], avg=${avg.toFixed(4)}, talking=${isTalkingRef.current}`);
          lastLogTime = now;
          frameCount = 0;
        }

        if (!isTalkingRef.current || wsRef.current?.readyState !== WebSocket.OPEN) {
          return;
        }

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

        wsRef.current.send(int16Data.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);

      console.log('[Translation] ✅ Audio capture started successfully');
    } catch (err) {
      console.error('[Translation] Failed to get microphone access:', err);
    }
  }, []);

  /**
   * Connect to PeerJS room
   */
  useEffect(() => {
    isMountedRef.current = true;
    
    console.log('[PeerJS] Effect run - Starting connection...');

    async function connect() {
      if (isConnectingRef.current) {
        return;
      }

      isConnectingRef.current = true;

      try {
        // Step 1: Get access token and unique room ID from backend
        console.log('[PeerJS] Getting access token...');
        const tokenResponse = await getAccessToken(config);
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
            console.log('[PeerJS] ✓ Local media stream obtained');

            // Step 4: Connect to existing peers
            if (tokenResponse.roomParticipants && tokenResponse.roomParticipants.length > 0) {
              console.log(`[PeerJS] Connecting to ${tokenResponse.roomParticipants.length} existing participants...`);
              
              for (const participant of tokenResponse.roomParticipants) {
                if (participant.id !== id) {
                  knownPeersRef.current.add(participant.id);
                  console.log(`[PeerJS] Calling peer: ${participant.id}`);
                  
                  try {
                    const mediaConnection = peer.call(participant.id, stream);
                    
                    remoteMediaConnectionsRef.current.set(participant.id, mediaConnection);
                    
                    mediaConnection.on('stream', (remoteStream: MediaStream) => {
                      handleRemoteMediaStream(remoteStream, participant.id, participant.name);
                    });

                    mediaConnection.on('close', () => {
                      console.log(`[PeerJS] Media connection closed with ${participant.id}`);
                      remoteMediaConnectionsRef.current.delete(participant.id);
                      setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                    });

                    mediaConnection.on('error', (err: any) => {
                      console.warn(`[PeerJS] Media connection error with ${participant.id}:`, err);
                      remoteMediaConnectionsRef.current.delete(participant.id);
                      knownPeersRef.current.delete(participant.id);
                      setRemotePeers(prev => prev.filter(p => p.peerId !== participant.id));
                    });
                  } catch (callErr) {
                    console.warn(`[PeerJS] Failed to call peer ${participant.id}:`, callErr);
                    remoteMediaConnectionsRef.current.delete(participant.id);
                    knownPeersRef.current.delete(participant.id);
                  }
                }
              }
            }

            // Step 5: Start polling for newly joined participants
            if (tokenResponse.uniqueRoomId && !pollIntervalRef.current) {
              console.log('[PeerJS] Starting peer discovery polling...');
              pollIntervalRef.current = setInterval(() => {
                pollForNewParticipants(tokenResponse.uniqueRoomId!, id, stream, peer);
              }, 3000);  // Poll every 3 seconds
            }

            // Step 6: Listen for incoming calls from new peers
            peer.on('call', (mediaConnection: MediaConnection) => {
              console.log(`[PeerJS] Incoming call from ${mediaConnection.peer}`);
              
              // Answer with our stream
              mediaConnection.answer(stream);
              remoteMediaConnectionsRef.current.set(mediaConnection.peer, mediaConnection);
              
              mediaConnection.on('stream', (remoteStream: MediaStream) => {
                handleRemoteMediaStream(remoteStream, mediaConnection.peer, mediaConnection.peer);
              });

              mediaConnection.on('close', () => {
                console.log(`[PeerJS] Media connection closed with ${mediaConnection.peer}`);
                remoteMediaConnectionsRef.current.delete(mediaConnection.peer);
                setRemotePeers(prev => prev.filter(p => p.peerId !== mediaConnection.peer));
              });

              mediaConnection.on('error', (err: any) => {
                console.error(`[PeerJS] Media connection error:`, err);
              });
            });

            // Step 7: Start translation
            connectTranslation();

            setTimeout(() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                startAudioCapture();
              }
            }, 1000);

            // Step 8: Update state
            if (isMountedRef.current) {
              setIsConnected(true);
              setIsConnecting(false);
              updateParticipants();
              console.log('[PeerJS] ✓ Setup complete');
            }

            isConnectingRef.current = false;
          } catch (err: any) {
            console.error('[PeerJS] Error getting media:', err);
            if (isMountedRef.current) {
              setError(err.message);
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
          }
        });
      } catch (err: any) {
        console.error('[PeerJS] Connection error:', err);
        if (isMountedRef.current) {
          setError(err.message || 'Failed to connect');
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

      if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
      }

      if (peerRef.current) {
        peerRef.current.destroy();
      }

      remoteMediaConnectionsRef.current.clear();
    };
  }, [config, connectTranslation, startAudioCapture, handleRemoteMediaStream, updateParticipants, pollForNewParticipants]);

  /**
   * Disconnect
   */
  const disconnect = useCallback(async () => {
    console.log('[PeerJS] Disconnecting...');
    
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
    setParticipants([]);
    setRemotePeers([]);
  }, [localStream]);

  /**
   * Push-to-Talk: Start
   */
  const startTalking = useCallback(() => {
    console.log('[PTT] Started talking');
    isTalkingRef.current = true;
    setIsTalking(true);
  }, []);

  /**
   * Push-to-Talk: Stop
   */
  const stopTalking = useCallback(() => {
    console.log('[PTT] Stopped talking');
    isTalkingRef.current = false;
    setIsTalking(false);
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
    lastTranslation,
    incomingMessage,
    localStream,
    remotePeers,
    uniqueRoomId,
    disconnect,
    startTalking,
    stopTalking,
    toggleVideo
  };
}

export default usePeerJs;
