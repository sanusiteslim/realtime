import React, { useState, useEffect, useRef } from 'react';

const App = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [chatMessages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [userCountry, setUserCountry] = useState('');
  const [strangerCountry, setStrangerCountry] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(2400);
  const [showChat, setShowChat] = useState(true);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const wsRef = useRef(null);
  const timerRef = useRef(null);

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  useEffect(() => {
    fetch('https://ipapi.co/json/')
      .then(res => res.json())
      .then(data => {
        setUserCountry(data.country_code || 'US');
      })
      .catch(() => setUserCountry('US'));

    const style = document.createElement('style');
    style.textContent = `
      @keyframes spin {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    return () => {
      cleanup();
      if (style.parentNode) {
        document.head.removeChild(style);
      }
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
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setTimeRemaining(2400);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isConnected]);
<<<<<<< HEAD
=======

>>>>>>> 7ac47e5fbac8e981b6b11593c300495f345dc0c3
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const setupWebSocket = () => {
    console.log('WebSocket setup - connect to your signaling server here');
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
      if (event.candidate) {
        sendSignal({ type: 'ice-candidate', candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsConnected(true);
        setIsSearching(false);
        const countries = ['US', 'GB', 'CA', 'AU', 'DE', 'FR', 'JP', 'BR', 'IN', 'MX'];
        setStrangerCountry(countries[Math.floor(Math.random() * countries.length)]);
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        handleDisconnect();
      }
    };

    return pc;
  };

  const sendSignal = (data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  };

  const handleStart = async () => {
    setIsSearching(true);
    
    const stream = await initializeMedia();
    if (!stream) {
      setIsSearching(false);
      return;
    }

    setupWebSocket();
    
    setTimeout(async () => {
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      stream.getTracks().forEach(track => {
        pc.addTrack(track, stream);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendSignal({ type: 'offer', offer });

      setTimeout(async () => {
        const simulatedAnswer = await pc.createAnswer();
        await pc.setRemoteDescription(new RTCSessionDescription(simulatedAnswer));
      }, 1000);
    }, 2000);
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

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
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
  };

  const sendMessage = () => {
    if (messageInput.trim() && isConnected) {
      const newMsg = { sender: 'You', text: messageInput, time: new Date().toLocaleTimeString() };
      setMessages(prev => [...prev, newMsg]);
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
      <header style={styles.header}>
        <h1 style={styles.title}>RealTime</h1>
        {isConnected && (
          <div style={styles.controls}>
            <div style={styles.timer}>
              {formatTime(timeRemaining)}
            </div>
            <button style={styles.buttonSkip} onClick={handleSkip}>
              Skip
            </button>
            <button style={styles.buttonStop} onClick={handleStop}>
              Stop
            </button>
          </div>
        )}
      </header>

      <div style={styles.mainContent}>
        <div style={styles.videoSection}>
          <div style={styles.videoContainer}>
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              style={styles.remoteVideo}
            />
            {strangerCountry && (
              <div style={styles.countryBadge}>
                <span style={styles.flag}>{getCountryFlag(strangerCountry)}</span>
                <span>{strangerCountry}</span>
              </div>
            )}
            {!isConnected && (
              <div style={styles.placeholder}>
                {isSearching ? (
                  <div style={styles.searchingContainer}>
                    <div style={styles.searchingText}>Searching for stranger...</div>
                    <div style={styles.spinner}></div>
                  </div>
                ) : (
                  <button style={styles.buttonStart} onClick={handleStart}>
                    Start Chat
                  </button>
                )}
              </div>
            )}
          </div>

          <div style={styles.videoContainer}>
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              muted
              style={styles.localVideo}
            />
            <div style={styles.countryBadge}>
              <span style={styles.flag}>{getCountryFlag(userCountry)}</span>
              <span>{userCountry || 'You'}</span>
            </div>
          </div>
        </div>

        {showChat && (
          <div style={styles.chatSection}>
            <div style={styles.chatHeader}>
              <h3 style={styles.chatTitle}>Chat</h3>
              <button 
                style={styles.toggleChat} 
                onClick={() => setShowChat(false)}
              >
                ✕
              </button>
            </div>
            <div style={styles.messagesContainer}>
              {chatMessages.map((msg, idx) => (
                <div key={idx} style={styles.message}>
                  <span style={styles.messageSender}>{msg.sender}:</span>
                  <span style={styles.messageText}>{msg.text}</span>
                  <span style={styles.messageTime}>{msg.time}</span>
                </div>
              ))}
            </div>
            <div style={styles.inputContainer}>
              <input
                type="text"
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Type a message..."
                style={styles.input}
                disabled={!isConnected}
              />
              <button 
                onClick={sendMessage} 
                style={styles.sendButton}
                disabled={!isConnected}
              >
                Send
              </button>
            </div>
          </div>
        )}

        {!showChat && (
          <button 
            style={styles.showChatButton} 
            onClick={() => setShowChat(true)}
          >
            Show Chat
          </button>
        )}
      </div>
    </div>
  );
};
<<<<<<< HEAD
=======

const styles = {
  container: {
    fontFamily: "'Segoe UI', Arial, sans-serif",
    width: '100%',
    height: '100vh',
    backgroundColor: '#1c1c1e',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#2c2c2e',
    padding: '15px 30px',
    borderBottom: '1px solid #3a3a3c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: '600',
    color: '#ff375f',
    letterSpacing: '0.5px',
  },
  controls: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  buttonStart: {
    padding: '16px 40px',
    fontSize: '18px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'background-color 0.2s',
  },
  buttonSkip: {
    padding: '10px 20px',
    fontSize: '14px',
    backgroundColor: '#3a3a3c',
    color: '#fff',
    border: '1px solid #505052',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s',
  },
  buttonStop: {
    padding: '10px 20px',
    fontSize: '14px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s',
  },
  searchingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '15px',
  },
  searchingText: {
    color: '#ff375f',
    fontSize: '18px',
    fontWeight: '500',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #3a3a3c',
    borderTop: '3px solid #ff375f',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  timer: {
    fontSize: '14px',
    color: '#8e8e93',
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    padding: '20px',
    gap: '20px',
    flexWrap: 'wrap',
    '@media (max-width: 1024px)': {
      flexDirection: 'column',
    },
  },
  videoSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: '300px',
  },
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    flex: 1,
    minHeight: '300px',
    border: '1px solid #3a3a3c',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '18px',
    color: '#8e8e93',
    fontWeight: '500',
  },
  countryBadge: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    backgroundColor: 'rgba(44, 44, 46, 0.85)',
    backdropFilter: 'blur(10px)',
    padding: '6px 12px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  flag: {
    fontSize: '18px',
  },
  chatSection: {
    width: '350px',
    backgroundColor: '#2c2c2e',
    minWidth: '280px',
  },
  '@media (max-width: 1024px)': {
    chatSection: {
      width: '100%',
      minHeight: '300px',
    },
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid #3a3a3c',
  },
  chatHeader: {
    padding: '15px 20px',
    backgroundColor: '#2c2c2e',
    borderBottom: '1px solid #3a3a3c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
  },
  toggleChat: {
    background: 'none',
    border: 'none',
    color: '#8e8e93',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px',
  },
  messagesContainer: {
    flex: 1,
    padding: '15px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: '#1c1c1e',
  },
  message: {
    padding: '10px 12px',
    backgroundColor: '#2c2c2e',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  messageSender: {
    fontWeight: '600',
    color: '#ff375f',
    fontSize: '13px',
  },
  messageText: {
    fontSize: '14px',
    color: '#fff',
    lineHeight: '1.4',
  },
  messageTime: {
    fontSize: '11px',
    color: '#8e8e93',
  },
  inputContainer: {
    padding: '15px',
    borderTop: '1px solid #3a3a3c',
    display: 'flex',
    gap: '10px',
    backgroundColor: '#2c2c2e',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    backgroundColor: '#1c1c1e',
    border: '1px solid #3a3a3c',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
  },
  sendButton: {
    padding: '10px 20px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
  showChatButton: {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    padding: '12px 24px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
};
>>>>>>> 7ac47e5fbac8e981b6b11593c300495f345dc0c3

const styles = {
  container: {
    fontFamily: "'Segoe UI', Arial, sans-serif",
    width: '100%',
    height: '100vh',
    backgroundColor: '#1c1c1e',
    color: '#ffffff',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    backgroundColor: '#2c2c2e',
    padding: '15px 30px',
    borderBottom: '1px solid #3a3a3c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '10px',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: '600',
    color: '#ff375f',
    letterSpacing: '0.5px',
  },
  controls: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  buttonStart: {
    padding: '16px 40px',
    fontSize: '18px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '600',
    transition: 'background-color 0.2s',
  },
  buttonSkip: {
    padding: '10px 20px',
    fontSize: '14px',
    backgroundColor: '#3a3a3c',
    color: '#fff',
    border: '1px solid #505052',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s',
  },
  buttonStop: {
    padding: '10px 20px',
    fontSize: '14px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: '500',
    transition: 'background-color 0.2s',
  },
  searchingContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '15px',
  },
  searchingText: {
    color: '#ff375f',
    fontSize: '18px',
    fontWeight: '500',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #3a3a3c',
    borderTop: '3px solid #ff375f',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
  },
  timer: {
    fontSize: '14px',
    color: '#8e8e93',
    fontWeight: '500',
    fontVariantNumeric: 'tabular-nums',
  },
  mainContent: {
    flex: 1,
    display: 'flex',
    padding: '20px',
    gap: '20px',
    flexWrap: 'wrap',
    '@media (max-width: 1024px)': {
      flexDirection: 'column',
    },
  },
  videoSection: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '20px',
    minWidth: '300px',
  },
  videoContainer: {
    position: 'relative',
    backgroundColor: '#000',
    borderRadius: '8px',
    overflow: 'hidden',
    flex: 1,
    minHeight: '300px',
    border: '1px solid #3a3a3c',
  },
  remoteVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  localVideo: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  placeholder: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    fontSize: '18px',
    color: '#8e8e93',
    fontWeight: '500',
  },
  countryBadge: {
    position: 'absolute',
    top: '12px',
    right: '12px',
    backgroundColor: 'rgba(44, 44, 46, 0.85)',
    backdropFilter: 'blur(10px)',
    padding: '6px 12px',
    borderRadius: '6px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    border: '1px solid rgba(255, 255, 255, 0.1)',
  },
  flag: {
    fontSize: '18px',
  },
  chatSection: {
    width: '350px',
    backgroundColor: '#2c2c2e',
    minWidth: '280px',
  },
  '@media (max-width: 1024px)': {
    chatSection: {
      width: '100%',
      minHeight: '300px',
    },
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    border: '1px solid #3a3a3c',
  },
  chatHeader: {
    padding: '15px 20px',
    backgroundColor: '#2c2c2e',
    borderBottom: '1px solid #3a3a3c',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
    color: '#fff',
  },
  toggleChat: {
    background: 'none',
    border: 'none',
    color: '#8e8e93',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '4px',
  },
  messagesContainer: {
    flex: 1,
    padding: '15px',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    backgroundColor: '#1c1c1e',
  },
  message: {
    padding: '10px 12px',
    backgroundColor: '#2c2c2e',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  messageSender: {
    fontWeight: '600',
    color: '#ff375f',
    fontSize: '13px',
  },
  messageText: {
    fontSize: '14px',
    color: '#fff',
    lineHeight: '1.4',
  },
  messageTime: {
    fontSize: '11px',
    color: '#8e8e93',
  },
  inputContainer: {
    padding: '15px',
    borderTop: '1px solid #3a3a3c',
    display: 'flex',
    gap: '10px',
    backgroundColor: '#2c2c2e',
  },
  input: {
    flex: 1,
    padding: '10px 12px',
    backgroundColor: '#1c1c1e',
    border: '1px solid #3a3a3c',
    borderRadius: '6px',
    color: '#fff',
    fontSize: '14px',
    outline: 'none',
  },
  sendButton: {
    padding: '10px 20px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
  },
  showChatButton: {
    position: 'fixed',
    right: '20px',
    bottom: '20px',
    padding: '12px 24px',
    backgroundColor: '#ff375f',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
};

export default App;