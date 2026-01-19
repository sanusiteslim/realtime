const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Allow all origins (or specify your Replit URL)
    methods: ["GET", "POST"]
  }
});

let waitingUsers = [];
let connectedPairs = new Map();

// API endpoint to get online users count
app.get('/api/stats', (req, res) => {
  const onlineUsers = io.sockets.sockets.size;
  const activeChats = connectedPairs.size / 2; // Divide by 2 since each pair is stored twice
  
  res.json({
    onlineUsers,
    waitingUsers: waitingUsers.length,
    activeChats: Math.floor(activeChats)
  });
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  // Broadcast updated user count to all clients
  io.emit('user-count', { count: io.sockets.sockets.size });

  socket.on('find-peer', () => {
    if (waitingUsers.length > 0) {
      const peer = waitingUsers.shift();
      
      connectedPairs.set(socket.id, peer.id);
      connectedPairs.set(peer.id, socket.id);

      socket.emit('peer-found', { peerId: peer.id });
      peer.emit('peer-found', { peerId: socket.id });
      
      console.log(`Matched ${socket.id} with ${peer.id}`);
    } else {
      waitingUsers.push(socket);
      socket.emit('waiting');
      console.log(`User ${socket.id} waiting for peer. Queue: ${waitingUsers.length}`);
    }
  });

  socket.on('offer', ({ offer, to }) => {
    io.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ answer, to }) => {
    io.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, to }) => {
    io.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  socket.on('chat-message', ({ message, to }) => {
    io.to(to).emit('chat-message', { message, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    
    const peerSocketId = connectedPairs.get(socket.id);
    if (peerSocketId) {
      io.to(peerSocketId).emit('peer-disconnected');
      connectedPairs.delete(socket.id);
      connectedPairs.delete(peerSocketId);
    }

    waitingUsers = waitingUsers.filter(user => user.id !== socket.id);
    
    // Broadcast updated user count to all clients
    io.emit('user-count', { count: io.sockets.sockets.size });
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
