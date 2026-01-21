import React, { useState, useEffect, useRef, useReducer, useCallback, useMemo } from 'react';
import io from 'socket.io-client';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================

const CONFIG = {
  SOCKET_URL: process.env.REACT_APP_SOCKET_URL || 'http://localhost:3001',
  SESSION_DURATION: 20 * 60, // 40 minutes in seconds
  SESSION_WARNING_TIME: 5 * 60, // Show warning 5 minutes before end
  RECONNECT_ATTEMPTS: 3,
  RECONNECT_DELAY: 2000,
  MESSAGE_MAX_LENGTH: 500,
  ICE_SERVERS: {
    iceServers: [
      // Google's public STUN servers
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      
      // Public TURN servers (Metered.ca - Free tier available)
      // You can get free credentials at https://www.metered.ca/tools/openrelay/
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject',
      },
      
      // Twilio TURN servers (if you have Twilio account)
      // Uncomment and add your credentials from Twilio Console
      // {
      //   urls: 'turn:global.turn.twilio.com:3478?transport=udp',
      //   username: process.env.REACT_APP_TWILIO_USERNAME,
      //   credential: process.env.REACT_APP_TWILIO_CREDENTIAL,
      // },
      // {
      //   urls: 'turn:global.turn.twilio.com:3478?transport=tcp',
      //   username: process.env.REACT_APP_TWILIO_USERNAME,
      //   credential: process.env.REACT_APP_TWILIO_CREDENTIAL,
      // },
      // {
      //   urls: 'turn:global.turn.twilio.com:443?transport=tcp',
      //   username: process.env.REACT_APP_TWILIO_USERNAME,
      //   credential: process.env.REACT_APP_TWILIO_CREDENTIAL,
      // },
      
      // Xirsys TURN servers (if you have Xirsys account)
      // Uncomment and add your credentials from Xirsys
      // {
      //   urls: 'turn:YOUR_XIRSYS_SERVER:80?transport=udp',
      //   username: process.env.REACT_APP_XIRSYS_USERNAME,
      //   credential: process.env.REACT_APP_XIRSYS_CREDENTIAL,
      // },
      // {
      //   urls: 'turn:YOUR_XIRSYS_SERVER:3478?transport=tcp',
      //   username: process.env.REACT_APP_XIRSYS_USERNAME,
      //   credential: process.env.REACT_APP_XIRSYS_CREDENTIAL,
      // },
      
      // Your own TURN server (recommended for production)
      // Install coturn: https://github.com/coturn/coturn
      // {
      //   urls: 'turn:your-turn-server.com:3478',
      //   username: process.env.REACT_APP_TURN_USERNAME,
      //   credential: process.env.REACT_APP_TURN_CREDENTIAL,
      // },
      // {
      //   urls: 'turns:your-turn-server.com:5349',
      //   username: process.env.REACT_APP_TURN_USERNAME,
      //   credential: process.env.REACT_APP_TURN_CREDENTIAL,
      // },
    ],
    iceCandidatePoolSize: 10,
  },
  VIDEO_CONSTRAINTS: {
    width: { ideal: 1280, max: 1920 },
    height: { ideal: 720, max: 1080 },
    facingMode: 'user'
  },
  AUDIO_CONSTRAINTS: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true
  }
};

const ERROR_MESSAGES = {
  MEDIA_PERMISSION_DENIED: 'Camera/microphone access denied. Please allow permissions and refresh.',
  MEDIA_NOT_FOUND: 'No camera or microphone found. Please check your devices.',
  MEDIA_GENERIC: 'Could not access camera/microphone. Please check your settings.',
  CONNECTION_FAILED: 'Connection failed. Please try again.',
  PEER_CONNECTION_FAILED: 'Failed to connect to peer. Trying to reconnect...',
  NETWORK_ERROR: 'Network error. Please check your connection.',
  SOCKET_DISCONNECTED: 'Disconnected from server. Reconnecting...',
};

// Country mapping for display
const COUNTRIES = {
  US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
  DE: 'Germany', FR: 'France', JP: 'Japan', BR: 'Brazil', IN: 'India',
  MX: 'Mexico', ES: 'Spain', IT: 'Italy', NL: 'Netherlands', SE: 'Sweden',
  NO: 'Norway', TR: 'Turkey', KR: 'South Korea', SG: 'Singapore', RU: 'Russia',
  AR: 'Argentina', PL: 'Poland', TH: 'Thailand', ID: 'Indonesia', MY: 'Malaysia'
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

const sanitizeMessage = (message) => {
  if (!message || typeof message !== 'string') return '';
  return message
    .slice(0, CONFIG.MESSAGE_MAX_LENGTH)
    .replace(/[<>]/g, '') // Remove potential XSS characters
    .trim();
};

const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const getCountryFlag = (countryCode) => {
  if (!countryCode || typeof countryCode !== 'string') return '';
  try {
    const codePoints = countryCode
      .toUpperCase()
      .slice(0, 2)
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  } catch {
    return '🌍';
  }
};

const getCountryName = (code) => COUNTRIES[code] || code;

const logger = {
  info: (...args) => console.log('[INFO]', ...args),
  warn: (...args) => console.warn('[WARN]', ...args),
  error: (...args) => console.error('[ERROR]', ...args),
  debug: (...args) => process.env.NODE_ENV === 'development' && console.log('[DEBUG]', ...args)
};

// ============================================================================
// STATE REDUCER
// ============================================================================

const initialState = {
  // Connection state
  isConnected: false,
  isSearching: false,
  peerSocketId: null,
  connectionState: 'disconnected', // disconnected, connecting, connected, failed
  
  // UI state
  videoNeedsClick: false,
  showConnectionNotice: false,
  showSessionWarning: false,
  isMobile: window.innerWidth < 768,
  
  // Data
  chatMessages: [],
  messageInput: '',
  userCountry: '',
  strangerCountry: '',
  timeRemaining: CONFIG.SESSION_DURATION,
  onlineUsers: 0,
  
  // Error handling
  error: null,
  socketConnected: false,
  reconnectAttempts: 0,
};

const actionTypes = {
  SET_CONNECTED: 'SET_CONNECTED',
  SET_SEARCHING: 'SET_SEARCHING',
  SET_PEER_ID: 'SET_PEER_ID',
  SET_CONNECTION_STATE: 'SET_CONNECTION_STATE',
  SET_VIDEO_NEEDS_CLICK: 'SET_VIDEO_NEEDS_CLICK',
  SET_CONNECTION_NOTICE: 'SET_CONNECTION_NOTICE',
  SET_SESSION_WARNING: 'SET_SESSION_WARNING',
  SET_MOBILE: 'SET_MOBILE',
  ADD_MESSAGE: 'ADD_MESSAGE',
  SET_MESSAGE_INPUT: 'SET_MESSAGE_INPUT',
  CLEAR_MESSAGES: 'CLEAR_MESSAGES',
  SET_USER_COUNTRY: 'SET_USER_COUNTRY',
  SET_STRANGER_COUNTRY: 'SET_STRANGER_COUNTRY',
  SET_TIME_REMAINING: 'SET_TIME_REMAINING',
  DECREMENT_TIME: 'DECREMENT_TIME',
  SET_ONLINE_USERS: 'SET_ONLINE_USERS',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_SOCKET_CONNECTED: 'SET_SOCKET_CONNECTED',
  INCREMENT_RECONNECT: 'INCREMENT_RECONNECT',
  RESET_RECONNECT: 'RESET_RECONNECT',
  RESET_SESSION: 'RESET_SESSION',
};

const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.SET_CONNECTED:
      return { ...state, isConnected: action.payload };
    case actionTypes.SET_SEARCHING:
      return { ...state, isSearching: action.payload };
    case actionTypes.SET_PEER_ID:
      return { ...state, peerSocketId: action.payload };
    case actionTypes.SET_CONNECTION_STATE:
      return { ...state, connectionState: action.payload };
    case actionTypes.SET_VIDEO_NEEDS_CLICK:
      return { ...state, videoNeedsClick: action.payload };
    case actionTypes.SET_CONNECTION_NOTICE:
      return { ...state, showConnectionNotice: action.payload };
    case actionTypes.SET_SESSION_WARNING:
      return { ...state, showSessionWarning: action.payload };
    case actionTypes.SET_MOBILE:
      return { ...state, isMobile: action.payload };
    case actionTypes.ADD_MESSAGE:
      return { ...state, chatMessages: [...state.chatMessages, action.payload] };
    case actionTypes.SET_MESSAGE_INPUT:
      return { ...state, messageInput: action.payload };
    case actionTypes.CLEAR_MESSAGES:
      return { ...state, chatMessages: [] };
    case actionTypes.SET_USER_COUNTRY:
      return { ...state, userCountry: action.payload };
    case actionTypes.SET_STRANGER_COUNTRY:
      return { ...state, strangerCountry: action.payload };
    case actionTypes.SET_TIME_REMAINING:
      return { ...state, timeRemaining: action.payload };
    case actionTypes.DECREMENT_TIME:
      return { ...state, timeRemaining: state.timeRemaining - 1 };
    case actionTypes.SET_ONLINE_USERS:
      return { ...state, onlineUsers: action.payload };
    case actionTypes.SET_ERROR:
      return { ...state, error: action.payload };
    case actionTypes.CLEAR_ERROR:
      return { ...state, error: null };
    case actionTypes.SET_SOCKET_CONNECTED:
      return { ...state, socketConnected: action.payload };
    case actionTypes.INCREMENT_RECONNECT:
      return { ...state, reconnectAttempts: state.reconnectAttempts + 1 };
    case actionTypes.RESET_RECONNECT:
      return { ...state, reconnectAttempts: 0 };
    case actionTypes.RESET_SESSION:
      return {
        ...state,
        isConnected: false,
        isSearching: false,
        peerSocketId: null,
        connectionState: 'disconnected',
        videoNeedsClick: false,
        showConnectionNotice: false,
        showSessionWarning: false,
        chatMessages: [],
        messageInput: '',
        strangerCountry: '',
        timeRemaining: CONFIG.SESSION_DURATION,
        error: null,
      };
    default:
      return state;
  }
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const App = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  
  // Refs
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);

  // ============================================================================
  // MEDIA HANDLING
  // ============================================================================

  const initializeMedia = useCallback(async () => {
    try {
      logger.info('Requesting media permissions...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: CONFIG.VIDEO_CONSTRAINTS,
        audio: CONFIG.AUDIO_CONSTRAINTS
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      logger.info('Media initialized successfully');
      dispatch({ type: actionTypes.CLEAR_ERROR });
      return stream;
    } catch (err) {
      logger.error('Media initialization error:', err);
      
      let errorMessage = ERROR_MESSAGES.MEDIA_GENERIC;
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        errorMessage = ERROR_MESSAGES.MEDIA_PERMISSION_DENIED;
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        errorMessage = ERROR_MESSAGES.MEDIA_NOT_FOUND;
      }
      
      dispatch({ type: actionTypes.SET_ERROR, payload: errorMessage });
      return null;
    }
  }, []);

  const stopMediaTracks = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
        logger.debug('Stopped track:', track.kind);
      });
      localStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
  }, []);

  // ============================================================================
  // WEBRTC PEER CONNECTION
  // ============================================================================

  const createPeerConnection = useCallback(() => {
    try {
      const pc = new RTCPeerConnection(CONFIG.ICE_SERVERS);
      
      pc.onicecandidate = (event) => {
        if (event.candidate && peerConnectionRef.current && socketRef.current) {
          logger.debug('Sending ICE candidate to peer');
          const peerId = peerConnectionRef.current.peerId;
          if (peerId) {
            socketRef.current.emit('ice-candidate', {
              candidate: event.candidate,
              to: peerId
            });
          }
        }
      };

      pc.ontrack = (event) => {
        logger.info('Received remote track');
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          
          const playPromise = remoteVideoRef.current.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                dispatch({ type: actionTypes.SET_VIDEO_NEEDS_CLICK, payload: false });
              })
              .catch(() => {
                dispatch({ type: actionTypes.SET_VIDEO_NEEDS_CLICK, payload: true });
              });
          }
        }
        
        dispatch({ type: actionTypes.SET_CONNECTED, payload: true });
        dispatch({ type: actionTypes.SET_SEARCHING, payload: false });
        dispatch({ type: actionTypes.SET_CONNECTION_STATE, payload: 'connected' });
        dispatch({ type: actionTypes.RESET_RECONNECT });
        
        // Show connection notice
        dispatch({ type: actionTypes.SET_CONNECTION_NOTICE, payload: true });
        setTimeout(() => {
          dispatch({ type: actionTypes.SET_CONNECTION_NOTICE, payload: false });
        }, 4000);
      };

      pc.oniceconnectionstatechange = () => {
        logger.info('ICE connection state:', pc.iceConnectionState);
        
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          dispatch({ type: actionTypes.SET_CONNECTION_STATE, payload: 'failed' });
          logger.warn('Peer connection failed/disconnected');
        } else if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          dispatch({ type: actionTypes.SET_CONNECTION_STATE, payload: 'connected' });
          dispatch({ type: actionTypes.CLEAR_ERROR });
        }
      };

      pc.onconnectionstatechange = () => {
        logger.info('Connection state:', pc.connectionState);
        if (pc.connectionState === 'failed') {
          dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.CONNECTION_FAILED });
        }
      };

      return pc;
    } catch (err) {
      logger.error('Error creating peer connection:', err);
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.CONNECTION_FAILED });
      return null;
    }
  }, []);

  const createAndSendOffer = useCallback(async (peerId) => {
    try {
      logger.info('Creating offer for peer:', peerId);
      const pc = createPeerConnection();
      if (!pc) return;
      
      // Store peer ID on the connection object for ICE candidates
      pc.peerId = peerId;
      
      peerConnectionRef.current = pc;
      pendingIceCandidatesRef.current = [];

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(offer);
      
      logger.info('Sending offer to peer:', peerId);
      socketRef.current?.emit('offer', { offer, to: peerId });
      dispatch({ type: actionTypes.SET_CONNECTION_STATE, payload: 'connecting' });
    } catch (error) {
      logger.error('Error creating offer:', error);
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.CONNECTION_FAILED });
    }
  }, [createPeerConnection]);

  const handleOffer = useCallback(async (offer, from) => {
    try {
      logger.info('Handling offer from:', from);
      dispatch({ type: actionTypes.SET_PEER_ID, payload: from });
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      
      const pc = createPeerConnection();
      if (!pc) return;
      
      // Store peer ID on the connection object for ICE candidates
      pc.peerId = from;
      
      peerConnectionRef.current = pc;
      pendingIceCandidatesRef.current = [];

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      const answer = await pc.createAnswer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      });
      await pc.setLocalDescription(answer);

      logger.info('Sending answer to peer:', from);
      socketRef.current?.emit('answer', { answer, to: from });
      dispatch({ type: actionTypes.SET_CONNECTION_STATE, payload: 'connecting' });
      
      // Process pending ICE candidates after setting remote description
      for (const candidate of pendingIceCandidatesRef.current) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          logger.warn('Error adding queued ICE candidate:', err);
        }
      }
      pendingIceCandidatesRef.current = [];
    } catch (error) {
      logger.error('Error handling offer:', error);
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.CONNECTION_FAILED });
    }
  }, [createPeerConnection]);

  const handleAnswer = useCallback(async (answer) => {
    try {
      logger.info('Handling answer');
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'stable') {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
        
        // Process pending ICE candidates after setting remote description
        for (const candidate of pendingIceCandidatesRef.current) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (err) {
            logger.warn('Error adding queued ICE candidate:', err);
          }
        }
        pendingIceCandidatesRef.current = [];
      }
    } catch (error) {
      logger.error('Error handling answer:', error);
    }
  }, []);

  const handleIceCandidate = useCallback(async (candidate) => {
    try {
      if (peerConnectionRef.current?.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
        logger.debug('Added ICE candidate');
      } else {
        logger.debug('Queuing ICE candidate');
        pendingIceCandidatesRef.current.push(candidate);
      }
    } catch (error) {
      logger.error('Error adding ICE candidate:', error);
    }
  }, []);

  // ============================================================================
  // SOCKET HANDLING
  // ============================================================================

  const setupSocketListeners = useCallback((socket) => {
    socket.on('connect', () => {
      logger.info('Connected to signaling server');
      dispatch({ type: actionTypes.SET_SOCKET_CONNECTED, payload: true });
      dispatch({ type: actionTypes.RESET_RECONNECT });
      dispatch({ type: actionTypes.CLEAR_ERROR });
    });

    socket.on('disconnect', (reason) => {
      logger.warn('Disconnected from server:', reason);
      dispatch({ type: actionTypes.SET_SOCKET_CONNECTED, payload: false });
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.SOCKET_DISCONNECTED });
    });

    socket.on('connect_error', (error) => {
      logger.error('Socket connection error:', error);
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.NETWORK_ERROR });
    });

    socket.on('user-count', ({ count }) => {
      dispatch({ type: actionTypes.SET_ONLINE_USERS, payload: count || 0 });
    });

    socket.on('waiting', () => {
      logger.info('Waiting for peer...');
    });

    socket.on('peer-found', async ({ peerId }) => {
      logger.info('Peer found:', peerId);
      dispatch({ type: actionTypes.SET_PEER_ID, payload: peerId });
      
      // Set random stranger country (in production, this would come from server)
      const countryKeys = Object.keys(COUNTRIES);
      const randomCountry = countryKeys[Math.floor(Math.random() * countryKeys.length)];
      dispatch({ type: actionTypes.SET_STRANGER_COUNTRY, payload: randomCountry });
      
      await createAndSendOffer(peerId);
    });

    socket.on('offer', async ({ offer, from }) => {
      logger.info('Received offer from:', from);
      
      // Set random stranger country
      const countryKeys = Object.keys(COUNTRIES);
      const randomCountry = countryKeys[Math.floor(Math.random() * countryKeys.length)];
      dispatch({ type: actionTypes.SET_STRANGER_COUNTRY, payload: randomCountry });
      
      await handleOffer(offer, from);
    });

    socket.on('answer', async ({ answer }) => {
      logger.info('Received answer');
      await handleAnswer(answer);
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      logger.debug('Received ICE candidate');
      await handleIceCandidate(candidate);
    });

    socket.on('chat-message', ({ message, from }) => {
      const sanitized = sanitizeMessage(message);
      if (!sanitized) return;
      
      const newMsg = {
        sender: 'Stranger',
        text: sanitized,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      dispatch({ type: actionTypes.ADD_MESSAGE, payload: newMsg });
    });

    socket.on('peer-disconnected', () => {
      logger.info('Peer disconnected');
      handleDisconnect();
    });
  }, [createAndSendOffer, handleOffer, handleAnswer, handleIceCandidate]);

  // ============================================================================
  // USER ACTIONS
  // ============================================================================

  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    stopMediaTracks();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    pendingIceCandidatesRef.current = [];
    
    dispatch({ type: actionTypes.RESET_SESSION });
  }, [stopMediaTracks]);

  const handleDisconnect = useCallback(() => {
    logger.info('Disconnecting...');
    cleanup();
  }, [cleanup]);

  const handleStart = useCallback(async () => {
    if (state.isSearching) return;
    
    logger.info('Starting video chat...');
    dispatch({ type: actionTypes.SET_SEARCHING, payload: true });
    dispatch({ type: actionTypes.SET_VIDEO_NEEDS_CLICK, payload: false });
    dispatch({ type: actionTypes.CLEAR_ERROR });
    
    const stream = await initializeMedia();
    if (!stream) {
      dispatch({ type: actionTypes.SET_SEARCHING, payload: false });
      return;
    }

    if (socketRef.current?.connected) {
      logger.info('Emitting find-peer event');
      socketRef.current.emit('find-peer');
    } else {
      dispatch({ type: actionTypes.SET_ERROR, payload: ERROR_MESSAGES.SOCKET_DISCONNECTED });
      dispatch({ type: actionTypes.SET_SEARCHING, payload: false });
    }
  }, [state.isSearching, initializeMedia]);

  const handleSkip = useCallback(() => {
    logger.info('Skipping to next peer...');
    cleanup();
    setTimeout(() => {
      handleStart();
    }, 100);
  }, [cleanup, handleStart]);

  const handleStop = useCallback(() => {
    logger.info('Stopping chat...');
    cleanup();
  }, [cleanup]);

  const sendMessage = useCallback((e) => {
    if (e) e.preventDefault();
    
    const sanitized = sanitizeMessage(state.messageInput);
    if (!sanitized || !state.isConnected || !state.peerSocketId) return;
    
    const newMsg = {
      sender: 'You',
      text: sanitized,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    dispatch({ type: actionTypes.ADD_MESSAGE, payload: newMsg });
    
    socketRef.current?.emit('chat-message', {
      message: sanitized,
      to: state.peerSocketId
    });
    
    dispatch({ type: actionTypes.SET_MESSAGE_INPUT, payload: '' });
  }, [state.messageInput, state.isConnected, state.peerSocketId]);

  const playRemoteVideo = useCallback(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.play()
        .then(() => {
          dispatch({ type: actionTypes.SET_VIDEO_NEEDS_CLICK, payload: false });
        })
        .catch(err => {
          logger.error('Failed to play video:', err);
        });
    }
  }, []);

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Initialize socket connection
  useEffect(() => {
    logger.info('Initializing socket connection...');
    const socket = io(CONFIG.SOCKET_URL, {
      reconnection: true,
      reconnectionAttempts: CONFIG.RECONNECT_ATTEMPTS,
      reconnectionDelay: CONFIG.RECONNECT_DELAY,
    });
    
    socketRef.current = socket;
    setupSocketListeners(socket);

    return () => {
      logger.info('Cleaning up socket connection...');
      socket.disconnect();
    };
  }, [setupSocketListeners]);

  // Fetch user country
  useEffect(() => {
    const fetchCountry = async () => {
      try {
        const response = await fetch('https://ipapi.co/json/', {
          signal: AbortSignal.timeout(5000)
        });
        const data = await response.json();
        dispatch({ type: actionTypes.SET_USER_COUNTRY, payload: data.country_code || 'US' });
      } catch (err) {
        logger.warn('Failed to fetch country:', err);
        dispatch({ type: actionTypes.SET_USER_COUNTRY, payload: 'US' });
      }
    };
    fetchCountry();
  }, []);

  // Handle resize
  useEffect(() => {
    const handleResize = () => {
      dispatch({ type: actionTypes.SET_MOBILE, payload: window.innerWidth < 768 });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.chatMessages]);

  // Session timer
  useEffect(() => {
    if (state.isConnected) {
      timerRef.current = setInterval(() => {
        dispatch({ type: actionTypes.DECREMENT_TIME });
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      dispatch({ type: actionTypes.SET_TIME_REMAINING, payload: CONFIG.SESSION_DURATION });
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [state.isConnected]);

  // Handle timer warning and disconnect
  useEffect(() => {
    if (state.timeRemaining === CONFIG.SESSION_WARNING_TIME && !state.showSessionWarning && state.isConnected) {
      dispatch({ type: actionTypes.SET_SESSION_WARNING, payload: true });
    }
    
    if (state.timeRemaining <= 0 && state.isConnected) {
      handleDisconnect();
    }
  }, [state.timeRemaining, state.showSessionWarning, state.isConnected, handleDisconnect]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  // ============================================================================
  // STYLES
  // ============================================================================

  const styles = useMemo(() => state.isMobile ? mobileStyles : desktopStyles, [state.isMobile]);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div style={styles.container}>
      {/* Error Banner */}
      {state.error && (
        <div style={styles.errorBanner}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>{state.error}</span>
          <button 
            onClick={() => dispatch({ type: actionTypes.CLEAR_ERROR })}
            style={styles.errorClose}
          >
            ×
          </button>
        </div>
      )}

      {/* Header */}
      <Header 
        onlineUsers={state.onlineUsers}
        isConnected={state.isConnected}
        timeRemaining={state.timeRemaining}
        showSessionWarning={state.showSessionWarning}
        isMobile={state.isMobile}
        onSkip={handleSkip}
        onStop={handleStop}
      />

      {/* Main Content */}
      <div style={styles.mainContent}>
        {/* Video Section */}
        <VideoSection
          localVideoRef={localVideoRef}
          remoteVideoRef={remoteVideoRef}
          isConnected={state.isConnected}
          isSearching={state.isSearching}
          videoNeedsClick={state.videoNeedsClick}
          userCountry={state.userCountry}
          strangerCountry={state.strangerCountry}
          isMobile={state.isMobile}
          onStart={handleStart}
          onPlayVideo={playRemoteVideo}
        />

        {/* Chat Section */}
        <ChatSection
          messages={state.chatMessages}
          messageInput={state.messageInput}
          isConnected={state.isConnected}
          showConnectionNotice={state.showConnectionNotice}
          strangerCountry={state.strangerCountry}
          isMobile={state.isMobile}
          messagesEndRef={messagesEndRef}
          onMessageChange={(value) => dispatch({ type: actionTypes.SET_MESSAGE_INPUT, payload: value })}
          onSendMessage={sendMessage}
        />
      </div>
    </div>
  );
};

// ============================================================================
// CHILD COMPONENTS
// ============================================================================

const Header = ({ onlineUsers, isConnected, timeRemaining, showSessionWarning, isMobile, onSkip, onStop }) => {
  const styles = isMobile ? mobileStyles : desktopStyles;
  
  return (
    <header style={styles.header}>
      <div style={styles.headerLeft}>
        <h1 style={styles.title}>
          <span style={styles.titleIcon}>●</span>
          RealTime
        </h1>
      </div>
      
      <div style={styles.headerCenter}>
        <div style={styles.onlineIndicator}>
          <div style={styles.greenDot}></div>
          <span style={styles.onlineCount}>{onlineUsers.toLocaleString()}</span>
          <span style={styles.onlineLabel}>online</span>
        </div>
      </div>

      <div style={styles.headerRight}>
        {isConnected ? (
          <div style={styles.controls}>
            {!isMobile && (
              <div style={{
                ...styles.timerBadge,
                ...(showSessionWarning ? styles.timerWarning : {})
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>{formatTime(timeRemaining)}</span>
              </div>
            )}
            <button style={styles.buttonSkip} onClick={onSkip}>
              <span>{isMobile ? '→' : 'Next'}</span>
            </button>
            <button style={styles.buttonStop} onClick={onStop}>
              <span>{isMobile ? '■' : 'Stop'}</span>
            </button>
          </div>
        ) : (
          <div style={styles.placeholderControls}></div>
        )}
      </div>
    </header>
  );
};

const VideoSection = ({
  localVideoRef,
  remoteVideoRef,
  isConnected,
  isSearching,
  videoNeedsClick,
  userCountry,
  strangerCountry,
  isMobile,
  onStart,
  onPlayVideo
}) => {
  const styles = isMobile ? mobileStyles : desktopStyles;

  return (
    <div style={styles.videoSection}>
      {/* Remote Video Container */}
      <div style={styles.videoContainer}>
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          muted={false}
          style={styles.video}
        />
        
        {/* Play Overlay */}
        {videoNeedsClick && isConnected && !isSearching && (
          <div style={styles.playOverlay} onClick={onPlayVideo}>
            <div style={styles.playButton}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z"/>
              </svg>
              <span>Click to Play</span>
            </div>
          </div>
        )}
        
        {/* Stranger Badge */}
        {strangerCountry && (
          <div style={styles.countryBadge}>
            <span style={styles.flag}>{getCountryFlag(strangerCountry)}</span>
            {!isMobile && <span style={styles.countryText}>Stranger</span>}
          </div>
        )}
        
        {/* Placeholder when not connected */}
        {!isConnected && (
          <div style={styles.placeholder}>
            {isSearching ? (
              <div style={styles.searchingContainer}>
                <div style={styles.spinnerRing}>
                  <div style={styles.spinner}></div>
                </div>
                <div style={styles.searchingText}>Finding someone...</div>
                <div style={styles.searchingSubtext}>This usually takes a few seconds</div>
              </div>
            ) : (
              <div style={styles.startContainer}>
                <button style={styles.buttonStart} onClick={onStart}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  <span>Start Video Chat</span>
                </button>
                <p style={styles.startHint}>Connect with strangers around the world</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Local Video (Mobile - PiP) */}
      {isMobile && (
        <div style={styles.localVideoContainer}>
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={styles.localVideo}
          />
          <div style={styles.localVideoBadge}>
            <span style={styles.flag}>{getCountryFlag(userCountry)}</span>
          </div>
        </div>
      )}

      {/* Local Video (Desktop - Separate) */}
      {!isMobile && (
        <div style={styles.desktopLocalVideo}>
          <div style={styles.videoContainerSmall}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={styles.video}
            />
            <div style={styles.countryBadge}>
              <span style={styles.flag}>{getCountryFlag(userCountry)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ChatSection = ({
  messages,
  messageInput,
  isConnected,
  showConnectionNotice,
  strangerCountry,
  isMobile,
  messagesEndRef,
  onMessageChange,
  onSendMessage
}) => {
  const styles = isMobile ? mobileStyles : desktopStyles;

  return (
    <div style={styles.chatSection}>
      {/* Chat Header */}
      <div style={styles.chatHeader}>
        <div style={styles.chatHeaderContent}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <h3 style={styles.chatTitle}>Messages</h3>
        </div>
        {isConnected && (
          <div style={styles.connectedBadge}>
            <div style={styles.connectedDot}></div>
            <span>Connected</span>
          </div>
        )}
      </div>
      
      {/* Messages Container */}
      <div style={styles.messagesContainer}>
        {/* Connection Notice */}
        {showConnectionNotice && (
          <div style={styles.connectionNotice}>
            <div style={styles.noticeIcon}>🎉</div>
            <div style={styles.noticeContent}>
              <div style={styles.noticeTitle}>You're now chatting with someone new</div>
              <div style={styles.noticeCountry}>
                <span style={styles.noticeFlag}>{getCountryFlag(strangerCountry)}</span>
                <span>{getCountryName(strangerCountry)}</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Empty State */}
        {messages.length === 0 && !showConnectionNotice ? (
          <div style={styles.emptyChat}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="1.5">
              <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
            </svg>
            <p style={styles.emptyChatText}>No messages yet</p>
            <p style={styles.emptyChatSubtext}>Start a conversation!</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} style={{
              ...styles.message,
              alignSelf: msg.sender === 'You' ? 'flex-end' : 'flex-start',
              backgroundColor: msg.sender === 'You' ? '#ff375f' : '#2c2c2e',
            }}>
              <div style={styles.messageContent}>
                <span style={styles.messageText}>{msg.text}</span>
              </div>
              <span style={styles.messageTime}>{msg.time}</span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      
      {/* Input Container */}
      <div style={styles.inputContainer}>
        <input
          type="text"
          value={messageInput}
          onChange={(e) => onMessageChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSendMessage();
            }
          }}
          placeholder={isConnected ? "Type a message..." : "Connect to start chatting"}
          style={styles.input}
          disabled={!isConnected}
          maxLength={CONFIG.MESSAGE_MAX_LENGTH}
        />
        <button 
          onClick={onSendMessage} 
          style={{
            ...styles.sendButton,
            opacity: !isConnected || !messageInput.trim() ? 0.4 : 1,
            cursor: !isConnected || !messageInput.trim() ? 'not-allowed' : 'pointer'
          }}
          disabled={!isConnected || !messageInput.trim()}
          aria-label="Send message"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

// ============================================================================
// STYLES
// ============================================================================

const desktopStyles = {
  container: {
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    width: '100%',
    height: '100vh',
    backgroundColor: '#0f0f10',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  errorBanner: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
    padding: '12px 24px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
    fontWeight: '500',
    borderBottom: '1px solid #b91c1c',
    position: 'relative',
    animation: 'slideDown 0.3s ease-out',
  },
  errorClose: {
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    color: '#ffffff',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0 8px',
    lineHeight: '1',
  },
  header: {
    backgroundColor: '#1a1a1c',
    padding: '16px 32px',
    borderBottom: '1px solid #2a2a2c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: '72px',
    backdropFilter: 'blur(10px)',
  },
  headerLeft: {
    flex: 1,
  },
  headerCenter: {
    flex: 1,
    display: 'flex',
    justifyContent: 'center',
  },
  headerRight: {
    flex: 1,
    display: 'flex',
    justifyContent: 'flex-end',
  },
  title: {
    margin: 0,
    fontSize: '26px',
    fontWeight: '700',
    background: 'linear-gradient(135deg, #ff375f 0%, #ff6b8a 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
    letterSpacing: '-0.5px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  titleIcon: {
    color: '#ff375f',
    fontSize: '12px',
  },
  onlineIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#1f1f21',
    padding: '10px 20px',
    borderRadius: '24px',
    border: '1px solid #2a2a2c',
  },
  greenDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
  },
  onlineCount: {
    fontSize: '20px',
    color: '#ffffff',
    fontWeight: '700',
    letterSpacing: '-0.5px',
  },
  onlineLabel: {
    fontSize: '14px',
    color: '#8e8e93',
    fontWeight: '500',
  },
  controls: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
  },
  placeholderControls: {
    width: '200px',
  },
  timerBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#1f1f21',
    padding: '8px 14px',
    borderRadius: '20px',
    fontSize: '14px',
    fontWeight: '600',
    color: '#a0a0a5',
    border: '1px solid #2a2a2c',
    fontVariantNumeric: 'tabular-nums',
    transition: 'all 0.3s ease',
  },
  timerWarning: {
    backgroundColor: '#dc26261a',
    color: '#ef4444',
    border: '1px solid #dc2626',
  },
  buttonStart: {
    padding: '18px 36px',
    fontSize: '16px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '12px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.3s ease',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    boxShadow: '0 4px 20px rgba(255, 55, 95, 0.3)',
  },
  buttonSkip: {
    padding: '8px 18px',
    fontSize: '14px',
    backgroundColor: '#2a2a2c',
    color: '#fff',
    border: '1px solid #3a3a3c',
    borderRadius: '20px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.2s ease',
  },
  buttonStop: {
    padding: '8px 18px',
    fontSize: '14px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '20px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'all 0.2s ease',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    gap: '20px',
    padding: '20px',
    overflow: 'hidden',
    minHeight: 0,
  },
  videoSection: {
    flex: 1,
    display: 'flex',
    gap: '20px',
    minWidth: 0,
  },
  desktopLocalVideo: {
    width: '300px',
    flexShrink: 0,
  },
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '16px',
    overflow: 'hidden',
    flex: 1,
    border: '1px solid #2a2a2c',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  videoContainerSmall: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '16px',
    overflow: 'hidden',
    height: '100%',
    border: '1px solid #2a2a2c',
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  video: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
  },
  searchingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
  },
  spinnerRing: {
    position: 'relative',
    width: '60px',
    height: '60px',
  },
  spinner: {
    width: '60px',
    height: '60px',
    border: '4px solid #2a2a2c',
    borderTop: '4px solid #ff375f',
    borderRadius: '50%',
  },
  searchingText: {
    color: '#ffffff',
    fontSize: '20px',
    fontWeight: '600',
  },
  searchingSubtext: {
    color: '#8e8e93',
    fontSize: '14px',
  },
  startContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
  },
  startHint: {
    margin: 0,
    color: '#8e8e93',
    fontSize: '14px',
  },
  countryBadge: {
    position: 'absolute',
    top: '16px',
    right: '16px',
    backgroundColor: 'rgba(26, 26, 28, 0.9)',
    backdropFilter: 'blur(10px)',
    padding: '8px 14px',
    borderRadius: '20px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: '600',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  flag: {
    fontSize: '18px',
  },
  countryText: {
    color: '#ffffff',
  },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)',
  },
  playButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#ff375f',
    color: '#fff',
    padding: '16px 32px',
    borderRadius: '30px',
    fontSize: '16px',
    fontWeight: '600',
    boxShadow: '0 8px 24px rgba(255, 55, 95, 0.4)',
    transition: 'transform 0.2s ease',
  },
  chatSection: {
    width: '380px',
    backgroundColor: '#1a1a1c',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid #2a2a2c',
    flexShrink: 0,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  },
  chatHeader: {
    padding: '20px 24px',
    backgroundColor: '#1a1a1c',
    borderBottom: '1px solid #2a2a2c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatHeaderContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  chatTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: '600',
    color: '#fff',
  },
  connectedBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    backgroundColor: '#1f2e1f',
    padding: '6px 12px',
    borderRadius: '12px',
    fontSize: '12px',
    fontWeight: '600',
    color: '#10b981',
  },
  connectedDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#10b981',
  },
  messagesContainer: {
    flex: 1,
    padding: '20px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    backgroundColor: '#0f0f10',
  },
  emptyChat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: '12px',
    opacity: 0.5,
  },
  emptyChatText: {
    margin: 0,
    fontSize: '15px',
    fontWeight: '600',
    color: '#8e8e93',
  },
  emptyChatSubtext: {
    margin: 0,
    fontSize: '13px',
    color: '#5e5e63',
  },
  connectionNotice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    backgroundColor: '#1f1f21',
    padding: '14px 16px',
    borderRadius: '12px',
    border: '1px solid #2a2a2c',
    marginBottom: '8px',
  },
  noticeIcon: {
    fontSize: '24px',
    flexShrink: 0,
  },
  noticeContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  noticeTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: '1.4',
  },
  noticeCountry: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#ff375f',
    fontWeight: '600',
  },
  noticeFlag: {
    fontSize: '16px',
  },
  message: {
    maxWidth: '75%',
    padding: '12px 16px',
    borderRadius: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  messageContent: {
    display: 'flex',
    flexDirection: 'column',
  },
  messageText: {
    fontSize: '14px',
    color: '#fff',
    lineHeight: '1.5',
    wordBreak: 'break-word',
  },
  messageTime: {
    fontSize: '11px',
    color: 'rgba(255, 255, 255, 0.5)',
    fontWeight: '500',
  },
  inputContainer: {
    padding: '20px',
    borderTop: '1px solid #2a2a2c',
    display: 'flex',
    gap: '12px',
    backgroundColor: '#1a1a1c',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#0f0f10',
    border: '1px solid #2a2a2c',
    borderRadius: '24px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
    transition: 'border-color 0.2s ease',
  },
  sendButton: {
    width: '44px',
    height: '44px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '50%',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    transition: 'all 0.2s ease',
    flexShrink: 0,
  },
};

const mobileStyles = {
  ...desktopStyles,
  header: {
    ...desktopStyles.header,
    padding: '10px 12px',
    minHeight: '56px',
  },
  title: {
    ...desktopStyles.title,
    fontSize: '18px',
    gap: '4px',
  },
  titleIcon: {
    ...desktopStyles.titleIcon,
    fontSize: '8px',
  },
  onlineIndicator: {
    ...desktopStyles.onlineIndicator,
    gap: '6px',
    padding: '6px 12px',
    borderRadius: '16px',
  },
  greenDot: {
    ...desktopStyles.greenDot,
    width: '7px',
    height: '7px',
  },
  onlineCount: {
    ...desktopStyles.onlineCount,
    fontSize: '14px',
  },
  onlineLabel: {
    display: 'none',
  },
  controls: {
    ...desktopStyles.controls,
    gap: '6px',
  },
  placeholderControls: {
    width: '60px',
  },
  timerBadge: {
    display: 'none',
  },
  buttonSkip: {
    ...desktopStyles.buttonSkip,
    padding: '8px 12px',
    fontSize: '16px',
    minWidth: '32px',
  },
  buttonStop: {
    ...desktopStyles.buttonStop,
    padding: '8px 12px',
    fontSize: '14px',
    minWidth: '32px',
  },
  mainContent: {
    ...desktopStyles.mainContent,
    flexDirection: 'column',
    gap: '12px',
    padding: '12px',
  },
  videoSection: {
    ...desktopStyles.videoSection,
    position: 'relative',
    flex: 1,
    flexDirection: 'column',
    gap: '12px',
  },
  videoContainer: {
    ...desktopStyles.videoContainer,
    borderRadius: '12px',
    minHeight: 0,
  },
  localVideoContainer: {
    position: 'absolute',
    bottom: '12px',
    right: '12px',
    width: '100px',
    height: '140px',
    backgroundColor: '#000',
    borderRadius: '10px',
    overflow: 'hidden',
    border: '2px solid #2a2a2c',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.6)',
    zIndex: 10,
  },
  localVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideoBadge: {
    position: 'absolute',
    top: '6px',
    right: '6px',
    backgroundColor: 'rgba(26, 26, 28, 0.95)',
    backdropFilter: 'blur(10px)',
    padding: '4px 6px',
    borderRadius: '8px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  desktopLocalVideo: {
    display: 'none',
  },
  chatSection: {
    ...desktopStyles.chatSection,
    width: '100%',
    height: '40vh',
    maxHeight: '40vh',
    borderRadius: '12px 12px 0 0',
    borderBottom: 'none',
  },
  errorBanner: {
    ...desktopStyles.errorBanner,
    padding: '10px 16px',
    fontSize: '13px',
  },
};

export default App;
