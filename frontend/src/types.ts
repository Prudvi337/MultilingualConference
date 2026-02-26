/**
 * TypeScript Type Definitions for Frontend
 */

export type LanguageCode = 'en' | 'hi' | 'es' | 'fr' | 'de' | 'ja' | 'ko' | 'zh';

export interface Language {
  code: LanguageCode;
  name: string;
  flag: string;
}

export interface TokenResponse {
  token: string;
  url: string;
  roomName: string;
  uniqueRoomId?: string; // Unique room ID for cloud sharing
  peerId?: string; // PeerJS participant ID
  roomParticipants?: Array<{
    id: string;
    name: string;
    createdAt: string;
  }>; // List of current room participants
}

export interface RoomConfig {
  roomName: string;
  participantName: string;
  targetLanguage: LanguageCode;
}

export interface ParticipantInfo {
  id: string;
  name: string;
  isSpeaking: boolean;
  audioLevel: number;
}

