

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { transcribeAudio, translateText, textToSpeech } from './aiService';
import { LanguageCode, AudioBuffer as AudioBufferType } from '../types';

interface TranslationSession {
  ws: WebSocket;
  participantId: string;
  roomName: string;
  targetLanguage: LanguageCode;  // Language THIS participant wants to HEAR
  audioBuffer: Buffer[];
  isProcessing: boolean;
  lastProcessTime: number;
  sampleRate: number;
  channels: number;
}

// Active translation sessions - indexed by WebSocket
const sessions = new Map<WebSocket, TranslationSession>();

// Room index - track all participants in each room for routing
const roomParticipants = new Map<string, Set<WebSocket>>();

// Audio chunk settings
const CHUNK_DURATION_MS = 3000; // Process every 3 seconds of audio to keep RPM low
const MIN_AUDIO_SIZE = 96000; // ~3 seconds at 16kHz mono 16-bit (16000 * 2 bytes * 3s)
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;

/**
 * Initialize WebSocket server for translation
 */
export function initTranslationWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({
    server,
    path: '/ws/translate'
  });

  console.log('[TranslationService] WebSocket server initialized at /ws/translate');

  wss.on('connection', (ws: WebSocket) => {
    console.log('[TranslationService] New WebSocket connection');

    ws.on('message', async (data: Buffer | string) => {
      try {
        // Check if it's a control message (JSON) or audio data (binary)
        if (typeof data === 'string') {
          const message = JSON.parse(data);
          handleControlMessage(ws, message);
        } else if (Buffer.isBuffer(data)) {
          // Check if it starts with '{' (JSON)
          if (data[0] === 0x7b) {
            const message = JSON.parse(data.toString());
            handleControlMessage(ws, message);
          } else {
            // Binary audio data
            handleAudioData(ws, data);
          }
        }
      } catch (error) {
        console.error('[TranslationService] Error processing message:', error);
        sendError(ws, 'Failed to process message');
      }
    });

    ws.on('close', () => {
      removeSessionFromRoom(ws);
    });

    ws.on('error', (error) => {
      console.error('[TranslationService] WebSocket error:', error);
      removeSessionFromRoom(ws);
    });
  });

  return wss;
}

/**
 * Handle control messages (start, stop, configure)
 */
function handleControlMessage(ws: WebSocket, message: any): void {
  switch (message.type) {
    case 'start':
      // Start a new translation session
      const session: TranslationSession = {
        ws,
        participantId: message.participantId || `user-${Date.now()}`,
        roomName: message.roomName || 'default',
        targetLanguage: message.targetLanguage || 'en',
        audioBuffer: [],
        isProcessing: false,
        lastProcessTime: Date.now(),
        sampleRate: message.sampleRate || DEFAULT_SAMPLE_RATE,
        channels: message.channels || DEFAULT_CHANNELS,
      };
      sessions.set(ws, session);

      // Add to room participants index
      if (!roomParticipants.has(session.roomName)) {
        roomParticipants.set(session.roomName, new Set());
      }
      roomParticipants.get(session.roomName)!.add(ws);

      const roomSize = roomParticipants.get(session.roomName)!.size;
      console.log(
        `[TranslationService] Started session for ${session.participantId}\n` +
        `  Room: ${session.roomName} (${roomSize} participant${roomSize > 1 ? 's' : ''})\n` +
        `  Wants to HEAR: ${session.targetLanguage}\n` +
        `  Sample rate: ${session.sampleRate}Hz`
      );

      sendMessage(ws, {
        type: 'started',
        participantId: session.participantId,
        targetLanguage: session.targetLanguage,
        roomParticipants: roomSize,
      });
      break;

    case 'stop':
      // Stop and cleanup session
      removeSessionFromRoom(ws);
      sendMessage(ws, { type: 'stopped' });
      break;

    case 'configure':
      // Update session configuration
      const sessionToUpdate = sessions.get(ws);
      if (sessionToUpdate) {
        if (message.targetLanguage) {
          sessionToUpdate.targetLanguage = message.targetLanguage;
        }
        if (message.sampleRate) {
          sessionToUpdate.sampleRate = message.sampleRate;
        }
        console.log(`[TranslationService] Updated config for ${sessionToUpdate.participantId} to ${sessionToUpdate.targetLanguage}`);
        sendMessage(ws, {
          type: 'started',
          targetLanguage: sessionToUpdate.targetLanguage,
          message: 'Voice configuration updated'
        });
      }
      break;

    case 'finish':
      // Force immediate processing of remaining audio
      const finisher = sessions.get(ws);
      if (finisher && finisher.audioBuffer.length > 0) {
        console.log(`[TranslationService] Forced processing of ${finisher.audioBuffer.length} chunks via 'finish' command`);
        processAudioBuffer(finisher);
      }
      break;

    default:
      console.warn(`[TranslationService] Unknown message type: ${message.type}`);
  }
}

/**
 * Remove a session from room tracking
 */
function removeSessionFromRoom(ws: WebSocket): void {
  const session = sessions.get(ws);
  if (session) {
    console.log(`[TranslationService] Removing ${session.participantId} from room ${session.roomName}`);

    // Remove from room participants
    const roomSet = roomParticipants.get(session.roomName);
    if (roomSet) {
      roomSet.delete(ws);
      if (roomSet.size === 0) {
        roomParticipants.delete(session.roomName);
      }
    }

    sessions.delete(ws);
  }
}

/**
 * Get all OTHER participants in the same room (excluding the speaker)
 */
function getOtherParticipantsInRoom(speakerWs: WebSocket, roomName: string): TranslationSession[] {
  const roomSet = roomParticipants.get(roomName);
  if (!roomSet) return [];

  const others: TranslationSession[] = [];
  roomSet.forEach(ws => {
    if (ws !== speakerWs) {
      const session = sessions.get(ws);
      if (session && ws.readyState === WebSocket.OPEN) {
        others.push(session);
      }
    }
  });

  return others;
}

/**
 * Handle incoming audio data
 */
function handleAudioData(ws: WebSocket, audioData: Buffer): void {
  const session = sessions.get(ws);
  if (!session) {
    console.warn('[TranslationService] Received audio for unknown session');
    return;
  }

  // Add to buffer
  session.audioBuffer.push(audioData);

  // Calculate total buffer size
  const totalSize = session.audioBuffer.reduce((sum, buf) => sum + buf.length, 0);
  const timeSinceLastProcess = Date.now() - session.lastProcessTime;

  // Log periodically
  if (session.audioBuffer.length % 10 === 0) {
    console.log(`[TranslationService] Buffered ${totalSize} bytes (${session.audioBuffer.length} chunks)`);
  }

  // Process if we have enough audio and enough time has passed
  if (
    !session.isProcessing &&
    totalSize >= MIN_AUDIO_SIZE &&
    timeSinceLastProcess >= CHUNK_DURATION_MS
  ) {
    processAudioBuffer(session);
  }
}

/**
 * Process accumulated audio buffer through AI pipeline
 * 
 * IMPORTANT: Translations are sent to OTHER participants, not back to the speaker!
 */
async function processAudioBuffer(session: TranslationSession): Promise<void> {
  if (session.isProcessing || session.audioBuffer.length === 0) {
    return;
  }

  session.isProcessing = true;
  session.lastProcessTime = Date.now();

  // Combine all buffered audio
  const combinedAudio = Buffer.concat(session.audioBuffer);
  session.audioBuffer = []; // Clear buffer

  // Get other participants in the room
  const otherParticipants = getOtherParticipantsInRoom(session.ws, session.roomName);

  console.log(
    `[TranslationService] Processing ${combinedAudio.length} bytes from ${session.participantId}\n` +
    `  Other participants in room: ${otherParticipants.map(p => `${p.participantId}(${p.targetLanguage})`).join(', ') || 'none'}`
  );

  // Notify speaker that their audio is being processed
  sendMessage(session.ws, {
    type: 'processing',
    audioSize: combinedAudio.length
  });

  // If no other participants, still transcribe for the speaker's reference
  if (otherParticipants.length === 0) {
    console.log(`[TranslationService] No other participants to send translation to`);
  }

  try {
    // Convert Buffer to Int16Array for the AI pipeline
    // IMPORTANT: Create a proper copy to avoid buffer alignment issues
    const int16Length = Math.floor(combinedAudio.length / 2);

    if (int16Length === 0) {
      console.warn(`[TranslationService] Received empty audio buffer from ${session.participantId}, skipping`);
      session.isProcessing = false;
      return;
    }

    const samples = new Int16Array(int16Length);
    let minSample = 0, maxSample = 0, sumAbsSample = 0;

    for (let i = 0; i < int16Length; i++) {
      // Read as little-endian Int16
      try {
        samples[i] = combinedAudio.readInt16LE(i * 2);
        minSample = Math.min(minSample, samples[i]);
        maxSample = Math.max(maxSample, samples[i]);
        sumAbsSample += Math.abs(samples[i]);
      } catch (e) {
        console.error(`[TranslationService] Error reading audio at index ${i}:`, e);
        break;
      }
    }

    const avgLevel = sumAbsSample / int16Length;
    const durationMs = (int16Length / session.sampleRate) * 1000;

    console.log(
      `[TranslationService] Audio stats for ${session.participantId}:\n` +
      `  Samples: ${int16Length}, Duration: ${durationMs.toFixed(0)}ms\n` +
      `  Range: [${minSample}, ${maxSample}], Avg level: ${avgLevel.toFixed(0)}`
    );

    // Skip if audio is too quiet (likely silence) or NaN
    if (isNaN(avgLevel) || avgLevel < 100) {
      console.log(`[TranslationService] Audio for ${session.participantId} too quiet (avg: ${avgLevel || 0}), skipping`);
      sendMessage(session.ws, { type: 'no_speech', message: 'Audio too quiet' });
      session.isProcessing = false;
      return;
    }

    // Create AudioBuffer for the AI service
    const audioBuffer: AudioBufferType = {
      participantId: session.participantId,
      participantName: session.participantId,
      roomName: session.roomName,
      samples,
      sampleRate: session.sampleRate,
      channels: session.channels,
      timestamp: Date.now(),
      // We assume the user speaks the language they have selected to listen to.
      // E.g., if targetLanguage is 'te', we hint Whisper that the audio is Telugu.
      language: session.targetLanguage,
    };

    // Step 1: Speech-to-Text (same for everyone)
    console.log(`[TranslationService] Step 1: Transcribing audio from ${session.participantId}...`);
    const transcription = await transcribeAudio(audioBuffer);

    if (!transcription.text || transcription.text.length < 2) {
      console.log(`[TranslationService] No speech detected, skipping`);
      sendMessage(session.ws, {
        type: 'no_speech',
        message: 'No speech detected in audio',
      });
      session.isProcessing = false;
      return;
    }

    console.log(`[TranslationService] Transcribed: "${transcription.text}" (${transcription.detectedLanguage})`);

    // Notify speaker of their transcription
    sendMessage(session.ws, {
      type: 'transcription',
      text: transcription.text,
      language: transcription.detectedLanguage,
    });

    // Step 2 & 3: For EACH other participant, translate and send to THEM
    for (const recipient of otherParticipants) {
      await sendTranslationToRecipient(
        session.participantId,
        transcription.text,
        transcription.detectedLanguage,
        recipient
      );
    }

    console.log(`[TranslationService] ✓ Sent translations to ${otherParticipants.length} recipient(s)`);

  } catch (error: any) {
    console.error('[TranslationService] Processing error:', error);
    sendError(session.ws, `Translation failed: ${error.message}`);
  } finally {
    session.isProcessing = false;
  }
}

/**
 * Translate and send audio to a specific recipient
 */
async function sendTranslationToRecipient(
  speakerId: string,
  originalText: string,
  sourceLanguage: LanguageCode,
  recipient: TranslationSession
): Promise<void> {
  const targetLanguage = recipient.targetLanguage;

  console.log(
    `[TranslationService] Translating for ${recipient.participantId}: ` +
    `${sourceLanguage} → ${targetLanguage}`
  );

  try {
    // Check if translation is needed (same language)
    if (sourceLanguage === targetLanguage) {
      console.log(`[TranslationService] Same language, sending original text to ${recipient.participantId}`);
      sendMessage(recipient.ws, {
        type: 'incoming_message',
        from: speakerId,
        originalText: originalText,
        translatedText: originalText,
        sourceLanguage,
        targetLanguage,
        wasTranslated: false,
      });
      return;
    }

    // Step 2: Translate to recipient's language
    const translation = await translateText(originalText, sourceLanguage, targetLanguage);
    console.log(`[TranslationService] Translated for ${recipient.participantId}: "${translation.translatedText}"`);

    // Step 3: Text-to-Speech in recipient's language
    const tts = await textToSpeech(translation.translatedText, targetLanguage);
    console.log(`[TranslationService] TTS for ${recipient.participantId}: ${tts.audioBuffer.length} bytes`);

    // Send translation info (JSON)
    sendMessage(recipient.ws, {
      type: 'incoming_message',
      from: speakerId,
      originalText: originalText,
      translatedText: translation.translatedText,
      sourceLanguage,
      targetLanguage,
      wasTranslated: true,
    });

    // Send translated audio (binary MP3)
    if (recipient.ws.readyState === WebSocket.OPEN) {
      recipient.ws.send(tts.audioBuffer);
      console.log(`[TranslationService] ✓ Sent audio to ${recipient.participantId}`);
    }

  } catch (error: any) {
    console.error(`[TranslationService] Error sending to ${recipient.participantId}:`, error);
    sendMessage(recipient.ws, {
      type: 'error',
      error: `Translation from ${speakerId} failed: ${error.message}`,
    });
  }
}

/**
 * Send JSON message to client
 */
function sendMessage(ws: WebSocket, message: object): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Send error message to client
 */
function sendError(ws: WebSocket, error: string): void {
  sendMessage(ws, { type: 'error', error });
}

/**
 * Get active session count
 */
export function getActiveSessionCount(): number {
  return sessions.size;
}

/**
 * Cleanup all sessions (for graceful shutdown)
 */
export function cleanupAllSessions(): void {
  console.log(`[TranslationService] Cleaning up ${sessions.size} sessions`);
  sessions.forEach((_, ws) => {
    try {
      sendMessage(ws, { type: 'shutdown' });
      ws.close();
    } catch (e) {
      // Ignore close errors
    }
  });
  sessions.clear();
}
