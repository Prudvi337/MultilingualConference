

import { createServer } from 'http';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { config } from './config/config';
import { generateAccessToken, listRooms, deleteAllRooms, getRoomParticipants, removeParticipant } from './services/peerJsService';
import { initTranslationWebSocket, getActiveSessionCount, cleanupAllSessions } from './services/translationService';
import { TokenRequest, ErrorResponse } from './types';

// Initialize Express app
const app = express();

// Create HTTP server (required for WebSocket)
const server = createServer(app);

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Enable CORS for frontend
const allowedOrigins = config.server.isDevelopment
  ? ['http://localhost:5173', 'http://localhost:3000'] // Vite and Next.js defaults
  : [
      process.env.FRONTEND_URL, // Primary production frontend
      'https://*.vercel.app',   // Any Vercel deployment
    ].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Check if origin is allowed
    const isAllowed = config.server.isDevelopment 
      ? allowedOrigins.includes(origin)
      : allowedOrigins.some(allowed => {
          if (allowed.includes('*')) {
            const pattern = allowed.replace('*.', '.*\\.');
            return new RegExp(pattern).test(origin);
          }
          return allowed === origin;
        });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parse JSON request bodies
app.use(express.json());

// Request logging middleware
app.use((req: Request, _res: Response, next: NextFunction) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * POST /api/token
 * 
 * Generate a PeerJS access token for a participant to join a room.
 * 
 * REQUEST BODY:
 * {
 *   "roomName": "conference-123",
 *   "participantName": "Alice",
 *   "targetLanguage": "en"
 * }
 * 
 * RESPONSE:
 * {
 *   "token": "alice_1234567890",
 *   "peerId": "alice_1234567890",
 *   "roomName": "conference-123_a1b2c3d4",
 *   "roomParticipants": [
 *     { "id": "alice_1234567890", "name": "Alice", "createdAt": "2024-01-01T00:00:00Z" }
 *   ]
 * }
 * 
 * This token:
 * - Authenticates the participant with PeerJS
 * - Returns the unique room ID to prevent conflicts
 * - Contains metadata (like target language)
 * - Lists current participants in the room
 */
app.post('/api/token', async (req: Request, res: Response) => {
  try {
    const { roomName, participantName, targetLanguage } = req.body as TokenRequest;

    // Validate required fields
    if (!roomName || !participantName) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required fields: roomName and participantName',
        statusCode: 400
      } as ErrorResponse);
    }

    // Generate access token with unique room ID
    const tokenResponse = await generateAccessToken({
      roomName,
      participantName,
      targetLanguage: targetLanguage || 'en'
    });

    console.log(`[API] ✓ Token generated for ${participantName} in room ${roomName}`);

    return res.json(tokenResponse);
  } catch (error: any) {
    console.error('[API] ✗ Error generating token:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to generate token',
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * POST /api/room/:roomId/leave
 * 
 * Handle participant leaving a room
 * Cleans up participant data and manages room lifecycle
 * 
 * PATH PARAMETERS:
 * - roomId: The unique room ID
 * 
 * REQUEST BODY:
 * {
 *   "peerId": "alice_1234567890"
 * }
 */
app.post('/api/room/:roomId/leave', (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;
    const { peerId } = req.body;

    if (!roomId || !peerId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameters: roomId and peerId',
        statusCode: 400
      } as ErrorResponse);
    }

    // Remove participant from room
    removeParticipant(roomId, peerId);

    console.log(`[API] ✓ Participant ${peerId} left room ${roomId}`);

    return res.json({
      success: true,
      message: 'Participant successfully left room'
    });
  } catch (error: any) {
    console.error('[API] ✗ Error handling participant leave:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to handle participant leave',
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * GET /api/room/:roomId/participants
 * 
 * Get the current list of participants in a room.
 * Used by clients to discover newly joined peers.
 * 
 * PATH PARAMETERS:
 * - roomId: The unique room ID (e.g., "conference-room_a1b2c3d4")
 * 
 * RESPONSE:
 * {
 *   "participants": [
 *     { "id": "alice_1234567890", "name": "Alice", "createdAt": "2024-01-01T00:00:00Z" }
 *   ]
 * }
 */
app.get('/api/room/:roomId/participants', (req: Request, res: Response) => {
  try {
    const { roomId } = req.params;

    if (!roomId) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required parameter: roomId',
        statusCode: 400
      } as ErrorResponse);
    }

    const participants = getRoomParticipants(roomId);
    console.log(`[API] ✓ Retrieved ${participants.length} participants for room ${roomId}`);

    return res.json({
      participants: participants.map(p => ({
        id: p.id,
        name: p.name,
        createdAt: p.joinedAt
      }))
    });
  } catch (error: any) {
    console.error('[API] ✗ Error getting room participants:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to get participants',
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * POST /api/worker/start
 * 
 * Legacy endpoint - translation now happens via WebSocket.
 * Kept for backward compatibility, returns success immediately.
 * 
 * The frontend should connect to ws://localhost:3001/ws/translate instead.
 */
app.post('/api/worker/start', async (req: Request, res: Response) => {
  try {
    const { roomName } = req.body;

    if (!roomName) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Missing required field: roomName',
        statusCode: 400
      } as ErrorResponse);
    }

    // Just return success - actual translation happens via WebSocket
    console.log(`[API] ✓ Translation enabled for room: ${roomName} (via WebSocket)`);

    // Build dynamic WebSocket URL based on request
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const host = req.headers.host || `localhost:${config.server.port}`;
    const wsEndpoint = `${protocol}://${host}/ws/translate`;

    return res.json({
      success: true,
      message: `Translation enabled for room: ${roomName}`,
      wsEndpoint,
      note: 'Connect to WebSocket endpoint to start translation'
    });
  } catch (error: any) {
    console.error('[API] ✗ Error:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * POST /api/worker/stop
 * 
 * Legacy endpoint - kept for backward compatibility.
 */
app.post('/api/worker/stop', async (req: Request, res: Response) => {
  const { roomName } = req.body;
  console.log(`[API] Worker stop requested for room: ${roomName}`);
  res.json({
    success: true,
    message: `Translation disabled for room: ${roomName}`
  });
});

/**
 * GET /api/translation/status
 * 
 * Get status of the WebSocket translation service.
 */
app.get('/api/translation/status', (req: Request, res: Response) => {
  // Build dynamic WebSocket URL based on request
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const host = req.headers.host || `localhost:${config.server.port}`;
  const wsEndpoint = `${protocol}://${host}/ws/translate`;
  
  res.json({
    activeSessions: getActiveSessionCount(),
    wsEndpoint
  });
});

/**
 * GET /api/rooms
 * 
 * List all active PeerJS rooms.
 * Useful for debugging and monitoring.
 */
app.get('/api/rooms', async (_req: Request, res: Response) => {
  try {
    const rooms = listRooms();
    res.json({
      rooms,
      totalRooms: rooms.length
    });
  } catch (error: any) {
    console.error('[API] ✗ Error listing rooms:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message || 'Failed to list rooms',
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * GET /api/health
 * 
 * Health check endpoint for monitoring.
 * Returns server status and uptime.
 */
app.get('/api/health', (req: Request, res: Response) => {
  // Build dynamic WebSocket URL based on request
  const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
  const host = req.headers.host || `localhost:${config.server.port}`;
  const wsEndpoint = `${protocol}://${host}/ws/translate`;
  
  res.json({
    status: 'healthy',
    service: 'multilingual-conferencing-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    translationSessions: getActiveSessionCount(),
    config: {
      webrtcEngine: 'peerjs',
      wsEndpoint
    }
  });
});

/**
 * POST /api/signaling/offer
 * 
 * Handle WebRTC signaling offers
 */
app.post('/api/signaling/offer', async (req: Request, res: Response) => {
  try {
    const { fromPeerId, toPeerId, roomName } = req.body;
    
    console.log(`[Signaling] Offer from ${fromPeerId} to ${toPeerId} in room ${roomName}`);
    
    // In a real implementation, you'd store this and deliver it to the target peer
    // For now, just acknowledge
    res.json({ success: true, message: 'Offer received' });
  } catch (error: any) {
    console.error('[Signaling] Error handling offer:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * POST /api/signaling/answer
 * 
 * Handle WebRTC signaling answers
 */
app.post('/api/signaling/answer', async (req: Request, res: Response) => {
  try {
    const { fromPeerId, toPeerId, roomName } = req.body;
    
    console.log(`[Signaling] Answer from ${fromPeerId} to ${toPeerId} in room ${roomName}`);
    
    res.json({ success: true, message: 'Answer received' });
  } catch (error: any) {
    console.error('[Signaling] Error handling answer:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      statusCode: 500
    } as ErrorResponse);
  }
});

/**
 * POST /api/signaling/ice-candidate
 * 
 * Handle ICE candidates
 */
app.post('/api/signaling/ice-candidate', async (req: Request, res: Response) => {
  try {
    const { fromPeerId, toPeerId, roomName } = req.body;
    
    console.log(`[Signaling] ICE candidate from ${fromPeerId} to ${toPeerId} in room ${roomName}`);
    
    res.json({ success: true, message: 'ICE candidate received' });
  } catch (error: any) {
    console.error('[Signaling] Error handling ICE candidate:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error.message,
      statusCode: 500
    } as ErrorResponse);
  }
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// ... (rest of the code remains the same)
app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
    statusCode: 404
  } as ErrorResponse);
});

/**
 * Global error handler
 */
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API] Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: config.server.isDevelopment ? err.message : 'An unexpected error occurred',
    statusCode: 500
  } as ErrorResponse);
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

/**
 * Start the Express server with WebSocket support
 */
async function startServer() {
  try {
    // Validate configuration
    console.log('\n=== Multilingual Conferencing Backend ===\n');
    console.log('Configuration:');
    console.log(`  Node Environment: ${config.server.nodeEnv}`);
    console.log(`  Server Port: ${config.server.port}`);
    console.log(`  WebRTC Engine: PeerJS`);
    console.log(`  OpenAI API Key: ${config.openai.apiKey.substring(0, 10)}...`);
    console.log(`  Audio Buffer: ${config.audio.bufferDurationMs}ms`);
    console.log('');

    // Initialize WebSocket translation service
    initTranslationWebSocket(server);

    // Start listening
    server.listen(config.server.port, () => {
      console.log(`✓ Server running on http://localhost:${config.server.port}`);
      console.log(`✓ WebSocket: ws://localhost:${config.server.port}/ws/translate`);
      console.log(`✓ Health check: http://localhost:${config.server.port}/api/health`);
      console.log('');
      console.log('Ready to accept connections!\n');
    });
  } catch (error) {
    console.error('✗ Failed to start server:', error);
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * Stops all workers and closes connections
 */
async function gracefulShutdown(signal: string) {
  console.log(`\n[Server] Received ${signal}, shutting down gracefully...`);

  try {
    // Cleanup WebSocket sessions
    cleanupAllSessions();
    
    // Cleanup PeerJS rooms
    deleteAllRooms();
    
    // Close HTTP server
    server.close(() => {
      console.log('[Server] ✓ HTTP server closed');
    });

    console.log('[Server] ✓ Shutdown complete');
    process.exit(0);
  } catch (error) {
    console.error('[Server] ✗ Error during shutdown:', error);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Server] Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Server] Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server
startServer();
