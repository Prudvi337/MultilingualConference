

import { useState, useRef, useCallback, useEffect } from 'react';
import { LanguageCode } from '../types';

interface TranslationState {
  isConnected: boolean;
  isProcessing: boolean;
  lastTranscription: string | null;
  lastTranslation: string | null;
  detectedLanguage: LanguageCode | null;
  error: string | null;
}

interface TranslationMessage {
  type: string;
  [key: string]: any;
}

interface UseTranslationOptions {
  roomName: string;
  participantId: string;
  targetLanguage: LanguageCode;
  onTranslatedAudio?: (audioData: ArrayBuffer) => void;
  onTranscription?: (text: string, language: LanguageCode) => void;
  onTranslation?: (originalText: string, translatedText: string, language: LanguageCode) => void;
}

export function useTranslation(options: UseTranslationOptions) {
  const {
    roomName,
    participantId,
    targetLanguage,
    onTranslatedAudio,
    onTranscription,
    onTranslation,
  } = options;

  const [state, setState] = useState<TranslationState>({
    isConnected: false,
    isProcessing: false,
    lastTranscription: null,
    lastTranslation: null,
    detectedLanguage: null,
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  /**
   * Connect to the translation WebSocket
   */
  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[Translation] Already connected');
      return;
    }

    // Get WebSocket URL from environment or derive from backend URL
    const rawBackendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
    // Remove trailing slash if present
    const backendUrl = rawBackendUrl.replace(/\/+$/, '');
    const wsProtocol = backendUrl.startsWith('https') ? 'wss' : 'ws';
    const wsHost = backendUrl.replace(/^https?:\/\//, '');
    const wsUrl = `${wsProtocol}://${wsHost}/ws/translate`;

    console.log(`[Translation] Connecting to ${wsUrl}...`);

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      console.log('[Translation] WebSocket connected');
      setState(prev => ({ ...prev, isConnected: true, error: null }));

      // Send start message
      ws.send(JSON.stringify({
        type: 'start',
        roomName,
        participantId,
        targetLanguage,
      }));
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary data = translated audio
        console.log(`[Translation] Received audio: ${event.data.byteLength} bytes`);
        onTranslatedAudio?.(event.data);
        playAudio(event.data);
      } else {
        // JSON message
        try {
          const message: TranslationMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (error) {
          console.error('[Translation] Failed to parse message:', error);
        }
      }
    };

    ws.onclose = () => {
      console.log('[Translation] WebSocket closed');
      setState(prev => ({ ...prev, isConnected: false }));
      wsRef.current = null;
    };

    ws.onerror = (error) => {
      console.error('[Translation] WebSocket error:', error);
      setState(prev => ({ ...prev, error: 'WebSocket connection failed' }));
    };
  }, [roomName, participantId, targetLanguage, onTranslatedAudio]);

  /**
   * Handle incoming JSON messages
   */
  const handleMessage = useCallback((message: TranslationMessage) => {
    console.log('[Translation] Message:', message.type, message);

    switch (message.type) {
      case 'started':
        console.log('[Translation] Session started');
        break;

      case 'processing':
        setState(prev => ({ ...prev, isProcessing: true }));
        break;

      case 'transcription':
        setState(prev => ({
          ...prev,
          isProcessing: false,
          lastTranscription: message.text,
          detectedLanguage: message.language,
        }));
        onTranscription?.(message.text, message.language);
        break;

      case 'translation':
        setState(prev => ({
          ...prev,
          isProcessing: false,
          lastTranscription: message.originalText,
          lastTranslation: message.translatedText,
          detectedLanguage: message.detectedLanguage,
        }));
        onTranslation?.(message.originalText, message.translatedText, message.targetLanguage);
        break;

      case 'error':
        console.error('[Translation] Error:', message.error);
        setState(prev => ({ ...prev, isProcessing: false, error: message.error }));
        break;

      case 'shutdown':
        console.log('[Translation] Server shutting down');
        disconnect();
        break;
    }
  }, [onTranscription, onTranslation]);

  /**
   * Play translated audio
   */
  const playAudio = useCallback(async (audioData: ArrayBuffer) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext();
      }

      const audioContext = audioContextRef.current;

      // Decode the audio data (MP3 from OpenAI TTS)
      const audioBuffer = await audioContext.decodeAudioData(audioData.slice(0));

      // Create source and play
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);

      console.log('[Translation] Playing translated audio');
    } catch (error) {
      console.error('[Translation] Failed to play audio:', error);
    }
  }, []);

  /**
   * Send audio chunk for translation
   */
  const sendAudio = useCallback((audioData: ArrayBuffer | Int16Array | Float32Array) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      console.warn('[Translation] Cannot send audio: not connected');
      return;
    }

    let buffer: ArrayBuffer;

    if (audioData instanceof ArrayBuffer) {
      buffer = audioData;
    } else if (audioData instanceof Int16Array) {
      buffer = audioData.buffer as ArrayBuffer;
    } else if (audioData instanceof Float32Array) {
      // Convert Float32Array to Int16Array (PCM)
      const int16 = new Int16Array(audioData.length);
      for (let i = 0; i < audioData.length; i++) {
        const s = Math.max(-1, Math.min(1, audioData[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }
      buffer = int16.buffer as ArrayBuffer;
    } else {
      console.warn('[Translation] Unknown audio format');
      return;
    }

    wsRef.current.send(buffer);
  }, []);

  /**
   * Disconnect from the translation service
   */
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      console.log('[Translation] Disconnecting...');

      // Send stop message
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'stop' }));
      }

      wsRef.current.close();
      wsRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setState({
      isConnected: false,
      isProcessing: false,
      lastTranscription: null,
      lastTranslation: null,
      detectedLanguage: null,
      error: null,
    });
  }, []);

  /**
   * Update target language
   */
  const setTargetLanguage = useCallback((language: LanguageCode) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'configure',
        targetLanguage: language,
      }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      disconnect();
    };
  }, [disconnect]);

  return {
    ...state,
    connect,
    disconnect,
    sendAudio,
    setTargetLanguage,
  };
}

export default useTranslation;

