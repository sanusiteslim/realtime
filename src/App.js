import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';

const SOCKET_URL = 'http://localhost:3001';

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [chatMessages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [userCountry, setUserCountry] = useState('');
  const [strangerCountry, setStrangerCountry] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(2400);
  const [onlineUsers, setOnlineUsers] = useState(0);
  const [peerSocketId, setPeerSocketId] = useState(null);
  const [videoNeedsClick, setVideoNeedsClick] = useState(false);
  const [showConnectionNotice, setShowConnectionNotice] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const messagesEndRef = useRef(null);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  useEffect(() => {
    const socket = io(SOCKET_URL);
    socketRef.current = socket;

    socket.on('connect', () => console.log('Connected to signaling server'));
    socket.on('user-count', ({ count }) => setOnlineUsers(count));
    socket.on('waiting', () => console.log('Waiting for peer...'));
    socket.on('peer-found', async ({ peerId }) => {
      console.log('Peer found:', peerId);
      setPeerSocketId(peerId);
      await createAndSendOffer(peerId);
    });
    socket.on('offer', async ({ offer, from }) => {
      console.log('Received offer from:', from);
      await handleOffer(offer, from);
    });
    socket.on('answer', async ({ answer }) => {
      console.log('Received answer');
      await handleAnswer(answer);
    });
    socket.on('ice-candidate', async ({ candidate }) => {
      console.log('Received ICE candidate');
      await handleIceCandidate(candidate);
    });
    socket.on('chat-message', ({ message, from }) => {
      const newMsg = { 
        sender: 'Stranger', 
        text: message, 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, newMsg]);
    });
    socket.on('peer-disconnected', () => {
      console.log('Peer disconnected');
      handleDisconnect();
    });

    return () => socket.disconnect();
  }, []);

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(res => res.json())
      .then(data => setUserCountry(data.country_code || 'US'))
      .catch(() => setUserCountry('US'));

    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); opacity: 1; }
        50% { transform: scale(1.2); opacity: 0.8; }
      }
      @keyframes glow {
        0%, 100% { box-shadow: 0 0 8px rgba(16, 185, 129, 0.6), 0 0 16px rgba(16, 185, 129, 0.4); }
        50% { box-shadow: 0 0 12px rgba(16, 185, 129, 0.8), 0 0 24px rgba(16, 185, 129, 0.6); }
      }
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      
      @media (max-width: 768px) {
        .mobile-header {
          padding: 12px 16px !important;
          min-height: 60px !important;
          flex-wrap: wrap;
        }
        .mobile-title {
          font-size: 20px !important;
        }
        .mobile-online {
          padding: 6px 12px !important;
          gap: 6px !important;
        }
        .mobile-online-count {
          font-size: 16px !important;
        }
        .mobile-online-label {
          font-size: 12px !important;
          display: none;
        }
        .mobile-main {
          flex-direction: column !important;
          padding: 12px !important;
          gap: 12px !important;
        }
        .mobile-video-section {
          flex-direction: column !important;
          min-height: 300px !important;
        }
        .mobile-video-wrapper {
          min-height: 200px !important;
        }
        .mobile-chat {
          width: 100% !important;
          min-height: 300px !important;
        }
        .mobile-controls {
          flex-wrap: wrap;
          gap: 8px !important;
        }
        .mobile-timer {
          font-size: 12px !important;
          padding: 6px 10px !important;
        }
        .mobile-button {
          font-size: 13px !important;
          padding: 6px 14px !important;
        }
        .mobile-header-center {
          order: 3;
          flex-basis: 100%;
          margin-top: 8px;
          justify-content: flex-start !important;
        }
      }
    `;
    document.head.appendChild(style);

    return () => {
      cleanup();
      if (style.parentNode) document.head.removeChild(style);
    };
  }, []);

  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => {
        setTimeRemaining(prev => {
          if (prev <= 1) {
            handleDisconnect();
            return 2400;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setTimeRemaining(2400);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isConnected]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const initializeMedia = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
        audio: true
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      
      return stream;
    } catch (err) {
      console.error('Error accessing media devices:', err);
      alert('Please allow camera and microphone access');
      return null;
    }
  };

  const createPeerConnection = () => {
    const pc = new RTCPeerConnection(iceServers);
    
    pc.onicecandidate = (event) => {
      if (event.candidate && peerSocketId) {
        socketRef.current.emit('ice-candidate', {
          candidate: event.candidate,
          to: peerSocketId
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        
        const playPromise = remoteVideoRef.current.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {
            setVideoNeedsClick(false);
          }).catch(err => {
            setVideoNeedsClick(true);
          });
        }
      }
      
      setIsConnected(true);
      setIsSearching(false);
      const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX', 'ES', 'IT', 'NL', 'SE', 'NO'];
      const randomCountry = countries[Math.floor(Math.random() * countries.length)];
      setStrangerCountry(randomCountry);
      setShowConnectionNotice(true);
      setTimeout(() => setShowConnectionNotice(false), 5000);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('Connection state:', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleDisconnect();
      }
    };

    return pc;
  };

  const createAndSendOffer = async (peerId) => {
    try {
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      socketRef.current.emit('offer', { offer, to: peerId });
    } catch (error) {
      console.error('Error creating offer:', error);
      handleDisconnect();
    }
  };

  const handleOffer = async (offer, from) => {
    try {
      setPeerSocketId(from);
      
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
      
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          pc.addTrack(track, localStreamRef.current);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socketRef.current.emit('answer', { answer, to: from });
    } catch (error) {
      console.error('Error handling offer:', error);
      handleDisconnect();
    }
  };

  const handleAnswer = async (answer) => {
    try {
      if (peerConnectionRef.current && peerConnectionRef.current.signalingState !== 'stable') {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      }
    } catch (error) {
      console.error('Error handling answer:', error);
    }
  };

  const handleIceCandidate = async (candidate) => {
    try {
      if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } catch (error) {
      console.error('Error adding ICE candidate:', error);
    }
  };

  const playRemoteVideo = () => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.play().then(() => {
        setVideoNeedsClick(false);
      }).catch(err => {
        console.error('Failed to play video:', err);
      });
    }
  };

  const handleStart = async () => {
    setIsSearching(true);
    setVideoNeedsClick(false);
    
    const stream = await initializeMedia();
    if (!stream) {
      setIsSearching(false);
      return;
    }

    socketRef.current.emit('find-peer');
  };

  const handleSkip = () => {
    cleanup();
    setTimeout(() => handleStart(), 100);
  };

  const handleStop = () => {
    cleanup();
  };

  const handleDisconnect = () => {
    cleanup();
  };

  const cleanup = () => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    setIsConnected(false);
    setIsSearching(false);
    setMessages([]);
    setStrangerCountry('');
    setTimeRemaining(2400);
    setPeerSocketId(null);
    setVideoNeedsClick(false);
    setShowConnectionNotice(false);
  };

  const sendMessage = (e) => {
    if (e) e.preventDefault();
    
    if (messageInput.trim() && isConnected && peerSocketId) {
      const newMsg = { 
        sender: 'You', 
        text: messageInput, 
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      setMessages(prev => [...prev, newMsg]);
      
      socketRef.current.emit('chat-message', {
        message: messageInput,
        to: peerSocketId
      });
      
      setMessageInput('');
    }
  };

  const getCountryFlag = (countryCode) => {
    if (!countryCode) return '';
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt());
    return String.fromCodePoint(...codePoints);
  };

  return (
    <div style={styles.container}>
      <header style={styles.header} className="mobile-header">
        <div style={styles.headerLeft}>
          <h1 style={styles.title} className="mobile-title">
            <span style={styles.titleIcon}>●</span>
            RealTime
          </h1>
        </div>
        
        <div style={styles.headerCenter} className="mobile-header-center">
          <div style={styles.onlineIndicator} className="mobile-online">
            <div style={styles.greenDot}></div>
            <span style={styles.onlineCount} className="mobile-online-count">{onlineUsers.toLocaleString()}</span>
            <span style={styles.onlineLabel} className="mobile-online-label">online</span>
          </div>
        </div>

        <div style={styles.headerRight}>
          {isConnected ? (
            <div style={styles.controls} className="mobile-controls">
              <div style={styles.timerBadge} className="mobile-timer">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <polyline points="12 6 12 12 16 14"/>
                </svg>
                <span>{formatTime(timeRemaining)}</span>
              </div>
              <button style={styles.buttonSkip} className="mobile-button" onClick={handleSkip}>
                <span>Next</span>
              </button>
              <button style={styles.buttonStop} className="mobile-button" onClick={handleStop}>
                <span>Stop</span>
              </button>
            </div>
          ) : (
            <div style={styles.placeholderControls}></div>
          )}
        </div>
      </header>

      <div style={styles.mainContent} className="mobile-main">
        <div style={styles.videoSection} className="mobile-video-section">
          <div style={styles.videoWrapper} className="mobile-video-wrapper">
            <div style={styles.videoContainer}>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                muted={false}
                style={styles.video}
              />
              {videoNeedsClick && isConnected && !isSearching && (
                <div style={styles.playOverlay} onClick={playRemoteVideo}>
                  <div style={styles.playButton}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="white">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                    <span>Click to Play</span>
                  </div>
                </div>
              )}
              {strangerCountry && (
                <div style={styles.countryBadge}>
                  <span style={styles.flag}>{getCountryFlag(strangerCountry)}</span>
                  <span style={styles.countryText}>Stranger</span>
                </div>
              )}
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
                      <button style={styles.buttonStart} onClick={handleStart}>
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
            <div style={styles.localVideoLabel}>You</div>
          </div>

          <div style={styles.videoWrapper} className="mobile-video-wrapper">
            <div style={styles.videoContainerSmall}>
              <video
                ref={localVideoRef}
                autoPlay
                playsInline
                muted
                style={styles.video}
              />
              <div style={{...styles.countryBadge, top: '8px', right: '8px'}}>
                <span style={styles.flag}>{getCountryFlag(userCountry)}</span>
              </div>
            </div>
          </div>
        </div>

        <div style={styles.chatSection} className="mobile-chat">
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
          
          <div style={styles.messagesContainer}>
            {showConnectionNotice && (
              <div style={styles.connectionNotice}>
                <div style={styles.noticeIcon}>🎉</div>
                <div style={styles.noticeContent}>
                  <div style={styles.noticeTitle}>You're now chatting with someone new</div>
                  <div style={styles.noticeCountry}>
                    <span style={styles.flag}>{getCountryFlag(strangerCountry)}</span>
                    <span>{strangerCountry}</span>
                  </div>
                </div>
              </div>
            )}
            {chatMessages.length === 0 ? (
              <div style={styles.emptyChat}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3a3a3c" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                <p style={styles.emptyChatText}>No messages yet</p>
                <p style={styles.emptyChatSubtext}>Start a conversation!</p>
              </div>
            ) : (
              chatMessages.map((msg, idx) => (
                <div key={idx} style={{
                  ...styles.message,
                  alignSelf: msg.sender === 'You' ? 'flex-end' : 'flex-start',
                  backgroundColor: msg.sender === 'You' ? '#ff375f' : '#2c2c2e',
                  animation: 'slideIn 0.3s ease-out'
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
          
          <div style={styles.inputContainer}>
            <input
              type="text"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder={isConnected ? "Type a message..." : "Connect to start chatting"}
              style={styles.input}
              disabled={!isConnected}
            />
            <button 
              onClick={sendMessage} 
              style={{
                ...styles.sendButton,
                opacity: !isConnected || !messageInput.trim() ? 0.4 : 1,
                cursor: !isConnected || !messageInput.trim() ? 'not-allowed' : 'pointer'
              }}
              disabled={!isConnected || !messageInput.trim()}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const styles = {
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
    animation: 'pulse 2s ease-in-out infinite',
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
    animation: 'glow 2s ease-in-out infinite',
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
    animation: 'spin 1s linear infinite',
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
  videoWrapper: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    minWidth: 0,
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
  localVideoLabel: {
    fontSize: '13px',
    color: '#8e8e93',
    fontWeight: '500',
    paddingLeft: '4px',
  },
  placeholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    textAlign: 'center',
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
    animation: 'pulse 2s ease-in-out infinite',
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
  connectionNotice: {
    backgroundColor: '#1f1f21',
    border: '1px solid #2a2a2c',
    borderRadius: '12px',
    padding: '14px 16px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    alignSelf: 'center',
    maxWidth: '90%',
    animation: 'slideIn 0.4s ease-out',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  noticeIcon: {
    fontSize: '24px',
    flexShrink: 0,
  },
  noticeContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  noticeTitle: {
    fontSize: '13px',
    fontWeight: '600',
    color: '#ffffff',
    lineHeight: '1.3',
  },
  noticeCountry: {
    fontSize: '13px',
    color: '#8e8e93',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
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

export default App;
