// backend/index.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Store room data
const rooms = new Map();

// Middleware
app.use(express.json());
app.use(express.static('../frontend')); // Adjust path based on your structure

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// ========== TRTC CONFIGURATION ENDPOINT ==========
app.post('/api/trtc/config', (req, res) => {
    try {
        const { userId, roomId } = req.body;
        
        // Get TRTC credentials from environment variables
        const SDK_APP_ID = process.env.TRTC_SDK_APP_ID;
        const SECRET_KEY = process.env.TRTC_SECRET_KEY;
        
        console.log('🔧 TRTC Config Request:', { 
            userId: userId.substring(0, 10) + '...', 
            roomId, 
            SDK_APP_ID: SDK_APP_ID ? '***' : 'NOT SET'
        });
        
        // Check if environment variables are set
        if (!SDK_APP_ID || !SECRET_KEY) {
            console.error('❌ TRTC environment variables not set!');
            console.log('Current env:', {
                TRTC_SDK_APP_ID: process.env.TRTC_SDK_APP_ID || 'NOT SET',
                TRTC_SECRET_KEY: process.env.TRTC_SECRET_KEY ? 'SET' : 'NOT SET'
            });
            
            // Return test config for development
            return res.json({
                sdkAppId: 0, // Test mode
                userId: userId,
                userSig: 'test_sig',
                roomId: roomId || 0,
                success: true,
                mode: 'test'
            });
        }
        
        // Generate UserSig
        const userSig = generateUserSig(userId, parseInt(SDK_APP_ID), SECRET_KEY);
        
        // Return configuration
        res.json({
            sdkAppId: parseInt(SDK_APP_ID),
            userId: userId,
            userSig: userSig,
            roomId: roomId || 0,
            success: true,
            mode: 'production'
        });
        
    } catch (error) {
        console.error('❌ Error generating TRTC config:', error);
        res.status(500).json({
            error: 'Failed to generate TRTC configuration',
            message: error.message,
            success: false
        });
    }
});

// Function to generate UserSig (TRTC authentication token)
function generateUserSig(userId, sdkAppId, secretKey, expireTime = 86400 * 180) {
    try {
        const currentTime = Math.floor(Date.now() / 1000);
        const expire = currentTime + expireTime;
        
        // Create the raw string to sign
        const rawStringToSign = `TLS.identifier:${userId}\n` +
                               `TLS.sdkappid:${sdkAppId}\n` +
                               `TLS.time:${currentTime}\n` +
                               `TLS.expire:${expire}\n`;
        
        // Create HMAC signature
        const hmac = crypto.createHmac('sha256', secretKey);
        hmac.update(rawStringToSign);
        const signature = hmac.digest('base64');
        
        // Construct the final UserSig
        const jsonString = JSON.stringify({
            TLS: {
                ver: "2.0",
                identifier: userId,
                sdkappid: sdkAppId,
                time: currentTime,
                expire: expire,
                signature: signature
            }
        });
        
        // Encode to base64
        const userSig = Buffer.from(jsonString).toString('base64');
        
        console.log(`✅ Generated UserSig for ${userId.substring(0, 10)}..., length: ${userSig.length}`);
        return userSig;
        
    } catch (error) {
        console.error('❌ Error generating UserSig:', error);
        throw error;
    }
}

// ========== SOCKET.IO HANDLERS ==========
io.on('connection', (socket) => {
    console.log('✅ New user connected:', socket.id.substring(0, 10) + '...');

    socket.on('join_room', (data) => {
        const { roomId, userName, userId } = data;
        socket.join(roomId);
        
        // Initialize room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                messages: [],
                micSlots: {},
                users: new Map()
            });
            console.log(`🏠 Created new room: ${roomId}`);
        }
        
        const room = rooms.get(roomId);
        room.users.set(socket.id, { userName, userId });
        
        // Send existing room data to the user
        socket.emit('room_data', {
            messages: room.messages.slice(-50), // Last 50 messages
            micSlots: room.micSlots,
            roomId: roomId,
            userCount: room.users.size
        });
        
        // Notify others in the room
        socket.to(roomId).emit('user_joined', {
            userName,
            userId: socket.id
        });
        
        socket.to(roomId).emit('new_message', {
            user: 'System',
            text: `${userName} joined the room`,
            time: new Date().toISOString()
        });
        
        console.log(`👤 ${userName} joined room ${roomId} (Total users: ${room.users.size})`);
    });

    socket.on('send_message', (data) => {
        const { roomId, userName, text } = data;
        const message = {
            user: userName,
            text: text,
            time: new Date().toISOString()
        };
        
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.messages.push(message);
            
            // Broadcast to room
            io.to(roomId).emit('new_message', message);
            console.log(`💬 ${userName} in room ${roomId}: ${text.substring(0, 30)}...`);
        }
    });

    socket.on('join_mic', (data) => {
        const { roomId, slot, userName, userId } = data;
        
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.micSlots[slot] = { userName, userId };
            
            // Broadcast to room
            io.to(roomId).emit('user_joined_mic', {
                slot,
                userName,
                userId
            });
            
            console.log(`🎤 ${userName} joined mic slot ${slot} in room ${roomId}`);
        }
    });

    socket.on('leave_mic', (data) => {
        const { roomId, slot, userName } = data;
        
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            delete room.micSlots[slot];
            
            // Broadcast to room
            io.to(roomId).emit('user_left_mic', {
                slot,
                userName
            });
            
            console.log(`🎤 ${userName || 'User'} left mic slot ${slot} in room ${roomId}`);
        }
    });

    socket.on('get_user_slot', (data) => {
        const { roomId, userId } = data;
        
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            // Find which slot this user is in
            for (const [slot, userData] of Object.entries(room.micSlots)) {
                if (userData.userId === userId) {
                    socket.emit('user_slot_info', {
                        userId,
                        slot: parseInt(slot),
                        userName: userData.userName
                    });
                    console.log(`🔍 Found slot ${slot} for user ${userId.substring(0, 10)}...`);
                    break;
                }
            }
        }
    });

    socket.on('leave_room', (data) => {
        const { roomId, userName } = data;
        
        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.users.delete(socket.id);
            
            // Remove user from mic slots
            for (const [slot, userData] of Object.entries(room.micSlots)) {
                if (userData.userName === userName) {
                    delete room.micSlots[slot];
                    io.to(roomId).emit('user_left_mic', { slot, userName });
                    break;
                }
            }
            
            // Notify others
            socket.to(roomId).emit('user_left', { userName });
            socket.to(roomId).emit('new_message', {
                user: 'System',
                text: `${userName} left the room`,
                time: new Date().toISOString()
            });
            
            // Clean up empty rooms
            if (room.users.size === 0) {
                rooms.delete(roomId);
                console.log(`🗑️  Room ${roomId} deleted (empty)`);
            }
            
            console.log(`👋 ${userName} left room ${roomId} (Remaining: ${room.users.size})`);
        }
        
        socket.leave(roomId);
    });

    socket.on('disconnect', () => {
        console.log('❌ User disconnected:', socket.id.substring(0, 10) + '...');
        
        // Find and clean up disconnected user from all rooms
        for (const [roomId, room] of rooms) {
            if (room.users.has(socket.id)) {
                const user = room.users.get(socket.id);
                room.users.delete(socket.id);
                
                // Remove from mic slots
                for (const [slot, userData] of Object.entries(room.micSlots)) {
                    if (userData.userId === socket.id || userData.userName === user.userName) {
                        delete room.micSlots[slot];
                        io.to(roomId).emit('user_left_mic', { 
                            slot, 
                            userName: user.userName 
                        });
                        break;
                    }
                }
                
                // Notify others
                socket.to(roomId).emit('user_left', { 
                    userName: user.userName 
                });
                
                socket.to(roomId).emit('new_message', {
                    user: 'System',
                    text: `${user.userName} disconnected`,
                    time: new Date().toISOString()
                });
                
                // Clean up empty rooms
                if (room.users.size === 0) {
                    rooms.delete(roomId);
                    console.log(`🗑️  Room ${roomId} deleted (empty)`);
                }
                
                console.log(`📤 ${user.userName} disconnected from room ${roomId}`);
                break;
            }
        }
    });
});

// Serve frontend files
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: '../frontend' });
});

app.get('/chat.html', (req, res) => {
    res.sendFile('chat.html', { root: '../frontend' });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        rooms: rooms.size,
        totalUsers: Array.from(rooms.values()).reduce((acc, room) => acc + room.users.size, 0)
    });
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(`🔧 TRTC SDK App ID: ${process.env.TRTC_SDK_APP_ID ? 'SET' : 'NOT SET'}`);
    console.log(`🔑 TRTC Secret Key: ${process.env.TRTC_SECRET_KEY ? 'SET' : 'NOT SET'}`);
    console.log(`🌐 Access the app at: http://localhost:${PORT}`);
});

let agoraClient;
let localAudioTrack;

async function joinAgoraVoice(roomId, userId) {
    const res = await fetch("/api/agora/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, userId })
    });

    const config = await res.json();

    agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });

    await agoraClient.join(
        config.appId,
        config.channel,
        config.token,
        config.uid
    );

    localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
    await agoraClient.publish([localAudioTrack]);

    console.log("Agora voice connected");
}
async function leaveAgoraVoice() {
    if (localAudioTrack) {
        localAudioTrack.stop();
        localAudioTrack.close();
    }
    if (agoraClient) {
        await agoraClient.leave();
    }
}
socket.emit("join_mic", { roomId, slot, userName, userId });
joinAgoraVoice(roomId, userId);
socket.emit("leave_mic", { roomId, slot, userName });
leaveAgoraVoice();
