/**
 * TypeScript Type Definitions
 * 
 * Central location for all type definitions used across the backend.
 */

/**
 * Supported language codes (ISO 639-1)
 */
export type LanguageCode = 'en' | 'hi' | 'es' | 'fr' | 'de' | 'ja' | 'ko' | 'zh' | 'te' | 'ta' | 'kn' | 'ml';

/**
 * Language information
 */
export interface Language {
  code: LanguageCode;
  name: string;
}

/**
 * Request to generate a LiveKit access token
 */
export interface TokenRequest {
  roomName: string;
  participantName: string;
  targetLanguage: LanguageCode;
}

/**
 * Response containing access token and connection details
 */
export interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
  uniqueRoomId?: string; // Unique room ID for cloud sharing
  peerId?: string; // PeerJS participant ID
  participantName?: string; // Participant's display name for frontend tracking
  roomParticipants?: Array<{
    id: string;
    name: string;
    createdAt: Date;
  }>; // List of current room participants
}

/**
 * Audio buffer for processing
 */
export interface AudioBuffer {
  participantId: string;
  participantName: string;
  roomName: string;
  samples: Int16Array;
  sampleRate: number;
  channels: number;
  timestamp: number;
  language?: LanguageCode; // Optional hint for transcription
}

/**
 * Result from Speech-to-Text (Whisper)
 */
export interface TranscriptionResult {
  text: string;
  detectedLanguage: LanguageCode;
  confidence?: number;
}

/**
 * Result from translation (GPT)
 */
export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: LanguageCode;
  targetLanguage: LanguageCode;
}

/**
 * Result from Text-to-Speech
 */
export interface TTSResult {
  audioBuffer: Buffer;
  format: 'mp3' | 'opus' | 'aac' | 'flac';
  duration?: number;
}

/**
 * Complete AI pipeline result
 */
export interface TranslationPipelineResult {
  success: boolean;
  transcription?: TranscriptionResult;
  translation?: TranslationResult;
  tts?: TTSResult;
  error?: string;
  processingTimeMs: number;
}

/**
 * Participant metadata stored in LiveKit
 */
export interface ParticipantMetadata {
  targetLanguage: LanguageCode;
  originalParticipantId?: string; // For translated audio tracks
  isTranslatedTrack?: boolean;
}

/**
 * Room state tracking
 */
export interface RoomState {
  roomName: string;
  participants: Map<string, ParticipantInfo>;
  activeWorkers: Set<string>; // Track active translation workers
}

/**
 * Participant information
 */
export interface ParticipantInfo {
  id: string;
  name: string;
  targetLanguage: LanguageCode;
  joinedAt: Date;
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

/**
 * Health check response
 */
export interface HealthResponse {
  status: 'ok' | 'error';
  timestamp: string;
  services: {
    livekit: boolean;
    openai: boolean;
  };
  version: string;
}

