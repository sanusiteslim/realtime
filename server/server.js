const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

let waitingUsers = [];
let connectedPairs = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('find-peer', () => {
    if (waitingUsers.length > 0) {
      const peer = waitingUsers.shift();
      
      connectedPairs.set(socket.id, peer.id);
      connectedPairs.set(peer.id, socket.id);

      socket.emit('peer-found', { peerId: peer.id });
      peer.emit('peer-found', { peerId: socket.id });
    } else {
      waitingUsers.push(socket);
      socket.emit('waiting');
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
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});