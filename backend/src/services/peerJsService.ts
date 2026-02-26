/**
 * PeerJS Service
 * 
 * Handles peer-to-peer connection management using PeerJS
 * Manages rooms, participants, and signaling for WebRTC connections
 */

import { v4 as uuidv4 } from 'uuid';
import { TokenRequest, TokenResponse, ParticipantMetadata } from '../types';

/**
 * Represents a participant in a room
 */
interface Participant {
  id: string;
  peerId: string;
  name: string;
  metadata: ParticipantMetadata;
  joinedAt: Date;
}

/**
 * Represents a room (conference session)
 */
interface Room {
  roomId: string; // Unique room identifier
  roomName: string; // User-provided room name (original)
  normalizedRoomName: string; // Normalized room name for matching
  participants: Map<string, Participant>;
  createdAt: Date;
  emptyTimeout: NodeJS.Timeout | null;
}

/**
 * In-memory store of active rooms
 * In production, this would be a database
 */
const activeRooms = new Map<string, Room>();

/**
 * Normalize room name for consistent matching
 * - Converts to lowercase
 * - Trims whitespace
 * - Replaces special characters with hyphens
 * 
 * @param roomBaseName - Room name to normalize
 * @returns Normalized room name
 */
export function normalizeRoomName(roomBaseName: string): string {
  return roomBaseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '-')  // Replace special chars with hyphens
    .replace(/-+/g, '-')  // Collapse multiple hyphens
    .replace(/^-|-$/g, '');  // Remove leading/trailing hyphens
}

/**
 * Generate unique room ID from user-provided room name
 * Combines user name with a unique identifier to prevent conflicts
 * 
 * @param roomBaseName - Base name provided by user (e.g., "daily-standup")
 * @returns Unique room ID (e.g., "daily-standup_1a2b3c4d")
 */
export function generateUniqueRoomId(roomBaseName: string): string {
  const normalizedName = normalizeRoomName(roomBaseName);
  const uniqueSuffix = uuidv4().substring(0, 8);
  return `${normalizedName}_${uniqueSuffix}`;
}

/**
 * Generate access token for a participant to join a PeerJS room
 * 
 * @param request - Token request with room name, participant name, and target language
 * @returns Token response with connection details
 */
export async function generateAccessToken(
  request: TokenRequest
): Promise<TokenResponse> {
  const { roomName, participantName, targetLanguage } = request;
  
  // Normalize room name for consistent matching
  const normalizedRoomName = normalizeRoomName(roomName);

  // Generate unique peer ID
  const peerId = `${participantName}_${Date.now()}`;
  
  let uniqueRoomId: string | undefined;
  let room: Room | undefined;
  
  // Check if the roomName looks like a unique room ID (contains underscore and was already generated)
  // If it does, treat it as a join request and search for exact match
  // If it doesn't, treat it as a create request
  if (roomName.includes('_')) {
    // Join mode - user provided full unique room ID
    uniqueRoomId = roomName;
    room = activeRooms.get(uniqueRoomId);
    
    if (!room) {
      throw new Error(`Room with ID "${uniqueRoomId}" not found. Please check the room ID and try again.`);
    }
    
    console.log(`[PeerJS] Joining existing room: ${uniqueRoomId}`);
  } else {
    // Create mode - user provided base room name, generate unique ID
    
    // Check if room with this normalized base name already exists
    for (const [roomId, existingRoom] of activeRooms.entries()) {
      if (existingRoom.normalizedRoomName === normalizedRoomName) {
        // Found existing room with same base name
        uniqueRoomId = roomId;
        room = existingRoom;
        console.log(`[PeerJS] Found existing room with base name: "${roomName}" (normalized: "${normalizedRoomName}") -> ${uniqueRoomId}`);
        break;
      }
    }
    
    // If no existing room found, create new unique ID
    if (!room) {
      uniqueRoomId = generateUniqueRoomId(roomName);
      console.log(`[PeerJS] Creating new room: "${roomName}" (normalized: "${normalizedRoomName}") -> ${uniqueRoomId}`);
    }
  }

  // Create room if it doesn't exist (for create mode)
  if (!room && uniqueRoomId) {
    room = {
      roomId: uniqueRoomId,
      roomName: roomName,
      normalizedRoomName: normalizedRoomName,
      participants: new Map(),
      createdAt: new Date(),
      emptyTimeout: null
    };
    activeRooms.set(uniqueRoomId, room);
    console.log(`[PeerJS] New room created: ${uniqueRoomId}`);
  }
  
  // Ensure we have a room and uniqueRoomId
  if (!room || !uniqueRoomId) {
    throw new Error('Failed to create or retrieve room');
  }

  // Create participant metadata
  const metadata: ParticipantMetadata = {
    targetLanguage,
    isTranslatedTrack: false
  };

  // Add participant to room
  const participant: Participant = {
    id: peerId,
    peerId: peerId,
    name: participantName,
    metadata: metadata,
    joinedAt: new Date()
  };

  room.participants.set(peerId, participant);

  // Clear any empty timeout since room now has a participant
  if (room.emptyTimeout) {
    clearTimeout(room.emptyTimeout);
    room.emptyTimeout = null;
  }

  console.log(`[PeerJS] Participant joined: ${participantName} (${peerId}) in room ${uniqueRoomId}`);
  console.log(`[PeerJS] Room participants: ${room.participants.size}`);

  // Return OTHER participants (exclude self) so they can connect
  const otherParticipants = Array.from(room.participants.values())
    .filter(p => p.peerId !== peerId)  // Exclude the current participant
    .map(p => ({
      id: p.peerId,
      name: p.name,
      createdAt: p.joinedAt
    }));

  return {
    token: peerId, // PeerJS uses ID directly, not JWT
    url: 'peerjs', // Indicator that this uses PeerJS instead of LiveKit
    roomName: roomName, // Original room name for UI display
    uniqueRoomId: uniqueRoomId, // Unique room ID for sharing
    peerId: peerId, // Client needs this to establish connections
    roomParticipants: otherParticipants  // OTHER participants (self excluded)
  };
}

/**
 * Get all participants in a room
 * 
 * @param roomId - Unique room identifier
 * @returns Array of participant information
 */
export function getRoomParticipants(roomId: string) {
  const room = activeRooms.get(roomId);
  
  if (!room) {
    console.warn(`[PeerJS] Room not found: ${roomId}`);
    return [];
  }

  return Array.from(room.participants.values()).map(p => ({
    id: p.peerId,
    name: p.name,
    metadata: p.metadata,
    joinedAt: p.joinedAt
  }));
}

/**
 * Remove participant from room
 * If room becomes empty, schedule deletion
 * 
 * @param roomId - Unique room identifier
 * @param peerId - Participant peer ID
 */
export function removeParticipant(roomId: string, peerId: string): void {
  const room = activeRooms.get(roomId);
  
  if (!room) {
    console.warn(`[PeerJS] Room not found: ${roomId}`);
    return;
  }

  room.participants.delete(peerId);
  console.log(`[PeerJS] Participant left: ${peerId} from room ${roomId}`);
  console.log(`[PeerJS] Room participants remaining: ${room.participants.size}`);

  // If room is empty, schedule deletion
  if (room.participants.size === 0) {
    console.log(`[PeerJS] Room empty: ${roomId} (will delete in 5 minutes)`);
    
    room.emptyTimeout = setTimeout(() => {
      activeRooms.delete(roomId);
      console.log(`[PeerJS] Room deleted: ${roomId}`);
    }, 5 * 60 * 1000); // 5 minutes
  }
}

/**
 * List all active rooms
 * Useful for debugging and monitoring
 * 
 * @returns Array of room information
 */
export function listRooms(): Array<{roomId: string; roomName: string; participantCount: number; createdAt: Date}> {
  return Array.from(activeRooms.values()).map(room => ({
    roomId: room.roomId,
    roomName: room.roomName,
    participantCount: room.participants.size,
    createdAt: room.createdAt
  }));
}

/**
 * Get information about a specific room
 * 
 * @param roomId - Unique room identifier
 * @returns Room information or null if not found
 */
export function getRoom(roomId: string): Room | null {
  return activeRooms.get(roomId) || null;
}

/**
 * Delete a room (cleanup)
 * 
 * @param roomId - Unique room identifier
 */
export function deleteRoom(roomId: string): void {
  const room = activeRooms.get(roomId);
  
  if (room && room.emptyTimeout) {
    clearTimeout(room.emptyTimeout);
  }
  
  activeRooms.delete(roomId);
  console.log(`[PeerJS] Room deleted: ${roomId}`);
}

/**
 * Get total number of active participants across all rooms
 */
export function getTotalParticipants(): number {
  let total = 0;
  activeRooms.forEach(room => {
    total += room.participants.size;
  });
  return total;
}

/**
 * Cleanup: Delete all rooms
 * Called during server shutdown
 */
export function deleteAllRooms(): void {
  activeRooms.forEach((room, roomId) => {
    if (room.emptyTimeout) {
      clearTimeout(room.emptyTimeout);
    }
    deleteRoom(roomId);
  });
  console.log('[PeerJS] All rooms cleaned up');
}

export type { Room, Participant };
