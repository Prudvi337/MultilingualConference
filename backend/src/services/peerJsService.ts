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
 * Map of normalized room names to unique room IDs
 * Used to quickly find existing rooms and prevent race condition duplicates
 */
const roomNameIndex = new Map<string, string>();

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

  console.log(`[PeerJS] ========== ROOM JOIN REQUEST ==========`)
  console.log(`[PeerJS] Request roomName: "${roomName}"`)
  console.log(`[PeerJS] Request participantName: "${participantName}"`)
  console.log(`[PeerJS] Request targetLanguage: "${targetLanguage}"`)
  console.log(`[PeerJS] RoomName contains underscore: ${roomName.includes('_')}`)

  // Normalize room name for consistent matching (language doesn't matter for room)
  const normalizedRoomName = normalizeRoomName(roomName);
  console.log(`[PeerJS] Normalized room name: "${normalizedRoomName}"`)

  // Generate unique peer ID using UUID (not just timestamp to avoid collisions when participants have same name)
  const peerId = `${participantName.replace(/[^a-z0-9]/gi, '')}_${uuidv4().substring(0, 12)}`;

  let uniqueRoomId: string | undefined;
  let room: Room | undefined;

  // CRITICAL FIX: Instead of checking for underscores (fragile), check if the
  // roomName is an exact key in activeRooms. This correctly handles room names
  // that naturally contain underscores (e.g., "my_meeting").
  if (activeRooms.has(roomName)) {
    // Join mode - user provided an exact unique room ID that exists
    uniqueRoomId = roomName;
    room = activeRooms.get(uniqueRoomId)!;

    console.log(`[PeerJS] JOIN MODE: Found exact room "${uniqueRoomId}"`)
    console.log(`[PeerJS] Active rooms: ${Array.from(activeRooms.keys()).join(', ')}`)
    console.log(`[PeerJS] ✓ Found existing room: ${uniqueRoomId} with ${room.participants.size} participants`);
  } else {
    // Create/Join mode - user provided base room name
    console.log(`[PeerJS] CREATE/JOIN MODE: Base room name "${roomName}"`)

    // CRITICAL: Check the index FIRST (prevents race condition)
    if (roomNameIndex.has(normalizedRoomName)) {
      // Room already exists, use its ID
      uniqueRoomId = roomNameIndex.get(normalizedRoomName)!;
      room = activeRooms.get(uniqueRoomId);

      console.log(`[PeerJS] Found existing room in index: "${normalizedRoomName}" -> "${uniqueRoomId}"`)

      if (room) {
        console.log(`[PeerJS] ✓ Found existing room: ${uniqueRoomId} with ${room.participants.size} participants`);
      } else {
        // Room index points to non-existent room, clean up index
        console.warn(`[PeerJS] Room index corrupted, removing reference: ${normalizedRoomName}`);
        roomNameIndex.delete(normalizedRoomName);
      }
    }

    // If still no room, check one more time in the actual map (in case of concurrent requests)
    // This double-check prevents race conditions where multiple rooms get created
    if (!room) {
      console.log(`[PeerJS] Room not found in index, scanning active rooms...`)
      for (const [roomId, existingRoom] of activeRooms.entries()) {
        if (existingRoom.normalizedRoomName === normalizedRoomName) {
          uniqueRoomId = roomId;
          room = existingRoom;
          console.log(`[PeerJS] Found existing room via map scan: "${roomName}" (normalized: "${normalizedRoomName}") -> ${uniqueRoomId}`);
          // Update index to prevent future lookups
          roomNameIndex.set(normalizedRoomName, uniqueRoomId);
          break;
        }
      }
    }

    // If room STILL doesn't exist, create it now
    if (!room) {
      uniqueRoomId = generateUniqueRoomId(roomName);
      console.log(`[PeerJS] CREATING NEW ROOM: "${roomName}" (normalized: "${normalizedRoomName}") -> ${uniqueRoomId}`);

      // Create room
      room = {
        roomId: uniqueRoomId,
        roomName: roomName,
        normalizedRoomName: normalizedRoomName,
        participants: new Map(),
        createdAt: new Date(),
        emptyTimeout: null
      };

      // Add to both maps atomically
      activeRooms.set(uniqueRoomId, room);
      roomNameIndex.set(normalizedRoomName, uniqueRoomId);

      console.log(`[PeerJS] ✓ Created new room: ${uniqueRoomId}`);
    }
  }

  // Ensure we have a room and uniqueRoomId (final safety check)
  if (!room || !uniqueRoomId) {
    throw new Error('Failed to create or retrieve room');
  }

  // Create participant metadata (language is just personal preference, not room membership)
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

  console.log(`[PeerJS] ✓ PARTICIPANT JOINED: ${participantName} (${peerId}) in room ${uniqueRoomId}`);
  console.log(`[PeerJS] Room now has ${room.participants.size} participant(s):`);
  Array.from(room.participants.values()).forEach(p => {
    console.log(`[PeerJS]   - ${p.name} (${p.id})`);
  });
  console.log(`[PeerJS] Active rooms total: ${activeRooms.size}`);

  // Return OTHER participants (exclude self) so they can connect
  const otherParticipants = Array.from(room.participants.values())
    .filter(p => p.peerId !== peerId)  // Exclude the current participant
    .map(p => ({
      id: p.peerId,
      name: p.name,
      createdAt: p.joinedAt
    }));

  console.log(`[PeerJS] Returning ${otherParticipants.length} other participants for ${participantName}:`);
  otherParticipants.forEach(p => {
    console.log(`[PeerJS]   - ${p.name} (${p.id})`);
  });

  const response = {
    token: peerId, // PeerJS uses ID directly, not JWT
    url: 'peerjs', // Indicator that this uses PeerJS instead of LiveKit
    roomName: roomName, // Original room name for UI display
    uniqueRoomId: uniqueRoomId, // Unique room ID for sharing
    peerId: peerId, // Client needs this to establish connections
    participantName: participantName, // Return the participant's name for tracking in frontend
    roomParticipants: otherParticipants  // OTHER participants (self excluded)
  };

  console.log(`[PeerJS] ========== RESPONSE ==========`)
  console.log(`[PeerJS] uniqueRoomId: ${response.uniqueRoomId}`)
  console.log(`[PeerJS] roomParticipants: ${response.roomParticipants.length} participants`)
  console.log(`[PeerJS] ======================================`)

  return response;
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
      roomNameIndex.delete(room.normalizedRoomName);
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
export function listRooms(): Array<{ roomId: string; roomName: string; participantCount: number; createdAt: Date }> {
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

  if (room) {
    if (room.emptyTimeout) {
      clearTimeout(room.emptyTimeout);
    }
    // Clean up room name index to prevent stale references
    roomNameIndex.delete(room.normalizedRoomName);
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
  roomNameIndex.clear();
  console.log('[PeerJS] All rooms cleaned up');
}

export type { Room, Participant };
