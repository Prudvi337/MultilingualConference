/**
 * Backend API Service
 * 
 * Handles all HTTP requests to the backend server.
 */

import axios from 'axios';
import { TokenResponse, RoomConfig } from '../types';

// Get backend URL from environment variable
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

// Create axios instance with base configuration
const api = axios.create({
  baseURL: BACKEND_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  timeout: 10000 // 10 second timeout
});

/**
 * Get LiveKit access token
 * 
 * @param config - Room configuration (room name, participant name, target language)
 * @returns Token response with JWT and connection URL
 */
export async function getAccessToken(config: RoomConfig): Promise<TokenResponse> {
  try {
    const response = await api.post<TokenResponse>('/api/token', config);
    return response.data;
  } catch (error: any) {
    console.error('[API] Error getting access token:', error);
    throw new Error(
      error.response?.data?.message || 
      'Failed to get access token. Is the backend running?'
    );
  }
}

/**
 * Get current participants in a room
 * Called periodically to discover newly joined peers
 * 
 * @param roomId - The unique room ID
 * @returns List of participants in the room
 */
export async function getRoomParticipants(roomId: string): Promise<Array<{id: string; name: string; createdAt: string}>> {
  try {
    const response = await api.get<{participants: Array<{id: string; name: string; createdAt: string}>}>(`/api/room/${roomId}/participants`);
    return response.data.participants;
  } catch (error: any) {
    console.error('[API] Error getting room participants:', error);
    throw new Error(
      error.response?.data?.message || 
      'Failed to get room participants'
    );
  }
}

/**
 * Start translation worker for a room
 * 
 * @param roomName - Name of the room
 */
export async function startWorker(roomName: string): Promise<void> {
  try {
    await api.post('/api/worker/start', { roomName });
    console.log('[API] Translation worker started');
  } catch (error: any) {
    console.error('[API] Error starting worker:', error);
    // Don't throw - worker might already be running
  }
}

/**
 * Check backend health
 */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await api.get('/api/health');
    // Backend returns status: 'healthy'
    return response.data.status === 'healthy' || response.data.status === 'ok';
  } catch {
    return false;
  }
}

export default api;

