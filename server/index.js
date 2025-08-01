const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const sharp = require('sharp');
const { diskSpace } = require('diskspace');
const fileTypesConfig = require('./config/file-types.json');

// 创建Express应用
const app = express();
app.use(cors());
const server = http.createServer(app);

// WebSocket配置
const io = socketio(server, {
  cors: { origin: '*' }
});

// 安全配置
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
const thumbDir = path.join(uploadDir, 'thumbnails');
if (!fsSync.existsSync(uploadDir)) {
  fsSync.mkdirSync(uploadDir, { recursive: true });
}
if (!fsSync.existsSync(thumbDir)) {
  fsSync.mkdirSync(thumbDir, { recursive: true });
}

// 数据存储 - 实际应用中应使用数据库
const dataStore = {
  users: new Map(), // socketId -> {name, publicKey, rooms: []}
  rooms: new Map(), // roomId -> {id, name, creator, members: [], messages: []}
  friendRequests: new Map(), // userId -> [{id, from, fromName, status, time}]
  friends: new Map(), // userId -> [friendId]
  uploads: new Map(), // uploadId -> {progress, total, speed, remaining, timeRemaining, owner}
  downloads: new Map() // downloadId -> {progress, total, speed, remaining, timeRemaining, owner}
};

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const uniqueName = `${Date.now()}-${uuidv4()}-${safeName}`;
    cb(null, uniqueName);
  }
});

// 文件过滤 - 使用配置文件
const fileFilter = (req, file, cb) => {
  // 检查文件扩展名
  const ext = path.extname(file.originalname).toLowerCase();
  if (fileTypesConfig.blockedExtensions.includes(ext)) {
    return cb(new Error(`不允许上传此类型文件: ${ext}`), false);
  }
  
  // 检查MIME类型
  const isImage = fileTypesConfig.allowedImageTypes.includes(file.mimetype);
  const isAllowedFile = fileTypesConfig.allowedFileTypes.includes(file.mimetype);
  
  if (!isImage && !isAllowedFile) {
    return cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
  
  // 检查文件大小
  const fileSize = parseInt(req.headers['content-length'] || '0');
  if (fileSize > fileTypesConfig.maxFileSize) {
    return cb(new Error(`文件大小不能超过${formatFileSize(fileTypesConfig.maxFileSize)}`), false);
  }
  
  cb(null, true);
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: fileTypesConfig.maxFileSize }
});

// 辅助函数：安全的输入验证
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  return validator.escape(
    input.replace(/(?:\r\n|\r|\n)/g, ' ')
         .replace(/<script.*?>.*?<\/script>/gi, '')
         .replace(/<.*?\/?>/gi, '')
  );
};

// 辅助函数：格式化文件大小
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// 处理图片压缩和元数据添加
const processImage = async (filePath, fileName, sender) => {
  try {
    const thumbPath = path.join(thumbDir, fileName);
    
    await sharp(filePath)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .withMetadata({ 
        sender: sender,
        timestamp: new Date().toISOString()
      })
      .toFile(thumbPath);
      
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/thumbnails/${fileName}`
    };
  } catch (error) {
    console.error('图片处理失败:', error);
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/${fileName}`
    };
  }
};

// 获取剩余存储空间
const getRemainingStorage = async () => {
  return new Promise((resolve) => {
    diskSpace.check(uploadDir, (err, total, free) => {
      if (err) {
        console.error('获取磁盘空间失败:', err);
        resolve({ total: 0, free: 0 });
      } else {
        resolve({ 
          total, 
          free,
          totalFormatted: formatFileSize(total),
          freeFormatted: formatFileSize(free),
          usedPercentage: total ? Math.round(((total - free) / total) * 100) : 0
        });
      }
    });
  });
};

// 计算上传/下载统计信息
function calculateTransferStats(transferId, store, uploaded, total, startTime) {
  const now = Date.now();
  const elapsed = (now - startTime) / 1000; // 秒
  const speed = elapsed > 0 ? (uploaded / elapsed) : 0; // 字节/秒
  const remaining = total > uploaded ? (total - uploaded) : 0;
  const timeRemaining = speed > 0 ? Math.round(remaining / speed) : 0; // 秒
  
  const stats = {
    progress: total > 0 ? Math.round((uploaded / total) * 100) : 0,
    uploaded: uploaded,
    total: total,
    speed: speed,
    speedFormatted: formatFileSize(speed) + '/s',
    remaining: remaining,
    remainingFormatted: formatFileSize(remaining),
    timeRemaining: timeRemaining,
    timeRemainingFormatted: timeRemaining < 60 
      ? `${timeRemaining}秒` 
      : `${Math.floor(timeRemaining / 60)}分${timeRemaining % 60}秒`
  };
  
  const existing = store.get(transferId) || {};
  store.set(transferId, { ...existing, ...stats });
  return stats;
}

// WebSocket事件处理
io.on('connection', (socket) => {
  console.log('新WebSocket连接:', socket.id);
  
  // 发送存储空间信息
  const sendStorageInfo = async () => {
    const storageInfo = await getRemainingStorage();
    socket.emit('storageInfo', storageInfo);
  };
  
  // 初始发送一次存储空间信息
  sendStorageInfo();
  // 定期更新存储空间信息（每30秒）
  const storageInterval = setInterval(sendStorageInfo, 30000);

  // 用户登录
  socket.on('login', (username) => {
    const sanitizedUsername = sanitizeInput(username).substring(0, 50);
    if (!sanitizedUsername) {
      socket.emit('loginError', '无效的用户名');
      return;
    }
    
    // 检查用户名是否已存在
    const existingUser = Array.from(dataStore.users.values()).find(
      user => user.name === sanitizedUsername
    );
    
    if (existingUser) {
      socket.emit('loginError', '用户名已被使用');
      return;
    }
    
    dataStore.users.set(socket.id, {
      name: sanitizedUsername,
      publicKey: '',
      rooms: []
    });
    
    // 加入默认房间
    const defaultRoomId = 'default';
    if (!dataStore.rooms.has(defaultRoomId)) {
      dataStore.rooms.set(defaultRoomId, {
        id: defaultRoomId,
        name: '公共聊天室',
        creator: sanitizedUsername,
        members: [socket.id],
        messages: []
      });
    } else {
      dataStore.rooms.get(defaultRoomId).members.push(socket.id);
    }
    
    dataStore.users.get(socket.id).rooms.push(defaultRoomId);
    socket.join(defaultRoomId);
    
    // 更新用户列表
    io.emit('userList', Array.from(dataStore.users.entries()).map(([id, user]) => ({
      id: id,
      name: user.name,
      hasPublicKey: !!user.publicKey
    })));
    
    // 发送房间列表
    socket.emit('roomList', Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === sanitizedUsername
    })));
    
    // 发送好友请求
    const friendRequests = dataStore.friendRequests.get(socket.id) || [];
    socket.emit('friendRequests', friendRequests);
    
    // 发送好友列表
    const friends = dataStore.friends.get(socket.id) || [];
    socket.emit('friendList', friends.map(friendId => ({
      id: friendId,
      name: dataStore.users.get(friendId)?.name || '未知用户'
    })));
    
    io.to(defaultRoomId).emit('systemMessage', { 
      text: `${sanitizedUsername} 加入聊天`, 
      time: new Date().toLocaleTimeString(),
      roomId: defaultRoomId
    });
  });

  // 接收用户公钥
  socket.on('publicKey', (key) => {
    if (typeof key === 'string' && key.length > 100 && dataStore.users.has(socket.id)) {
      dataStore.users.get(socket.id).publicKey = key;
      io.emit('userList', Array.from(dataStore.users.entries()).map(([id, user]) => ({
        id: id,
        name: user.name,
        hasPublicKey: !!user.publicKey
      })));
    }
  });

  // 创建房间
  socket.on('createRoom', (roomName) => {
    if (!dataStore.users.has(socket.id)) return;
    
    const sanitizedName = sanitizeInput(roomName).substring(0, 50);
    if (!sanitizedName) {
      socket.emit('roomError', '无效的房间名称');
      return;
    }
    
    const roomId = uuidv4();
    const user = dataStore.users.get(socket.id);
    
    dataStore.rooms.set(roomId, {
      id: roomId,
      name: sanitizedName,
      creator: user.name,
      members: [socket.id],
      messages: []
    });
    
    user.rooms.push(roomId);
    socket.join(roomId);
    
    // 广播房间列表更新
    io.emit('roomList', Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === user.name
    })));
    
    socket.emit('roomCreated', { id: roomId, name: sanitizedName });
    socket.emit('systemMessage', {
      text: `已创建房间: ${sanitizedName}`,
      time: new Date().toLocaleTimeString(),
      roomId: roomId
    });
  });

  // 申请加入房间
  socket.on('requestJoinRoom', (roomId) => {
    if (!dataStore.users.has(socket.id) || !dataStore.rooms.has(roomId)) return;
    
    const user = dataStore.users.get(socket.id);
    const room = dataStore.rooms.get(roomId);
    
    // 检查是否已在房间中
    if (room.members.includes(socket.id)) {
      socket.emit('roomError', '已在房间中');
      return;
    }
    
    // 找到房间创建者
    const creatorSocketId = Array.from(dataStore.users.entries()).find(
      ([id, u]) => u.name === room.creator
    )?.[0];
    
    if (creatorSocketId) {
      // 向房间创建者发送加入请求
      io.to(creatorSocketId).emit('roomJoinRequest', {
        requestId: uuidv4(),
        roomId: roomId,
        roomName: room.name,
        from: socket.id,
        fromName: user.name,
        time: new Date().toLocaleTimeString()
      });
      
      socket.emit('requestSent', { type: 'room', target: room.name });
    }
  });

  // 处理房间加入请求
  socket.on('respondRoomRequest', ({ requestId, roomId, accepted }) => {
    if (!dataStore.users.has(socket.id) || !dataStore.rooms.has(roomId)) return;
    
    const room = dataStore.rooms.get(roomId);
    const requesterSocketId = Array.from(dataStore.users.entries())
      .find(([id, u]) => room.members.includes(id) ? false : true)?.[0];
      
    if (!requesterSocketId) return;
    
    if (accepted) {
      // 同意加入
      room.members.push(requesterSocketId);
      dataStore.users.get(requesterSocketId).rooms.push(roomId);
      io.sockets.sockets.get(requesterSocketId)?.join(roomId);
      
      // 通知请求者
      io.to(requesterSocketId).emit('roomRequestResponse', {
        accepted: true,
        roomId: roomId,
        roomName: room.name
      });
      
      // 通知房间内成员
      io.to(roomId).emit('systemMessage', {
        text: `${dataStore.users.get(requesterSocketId).name} 加入了房间`,
        time: new Date().toLocaleTimeString(),
        roomId: roomId
      });
      
      // 更新房间列表
      io.emit('roomList', Array.from(dataStore.rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        memberCount: r.members.length,
        isCreator: r.creator === dataStore.users.get(socket.id).name
      })));
    } else {
      // 拒绝加入
      io.to(requesterSocketId).emit('roomRequestResponse', {
        accepted: false,
        roomId: roomId,
        roomName: room.name
      });
    }
  });

  // 发送好友请求
  socket.on('sendFriendRequest', (targetUserId) => {
    if (!dataStore.users.has(socket.id) || !dataStore.users.has(targetUserId)) return;
    if (socket.id === targetUserId) return; // 不能添加自己为好友
    
    // 检查是否已经是好友
    const friends = dataStore.friends.get(socket.id) || [];
    if (friends.includes(targetUserId)) {
      socket.emit('friendError', '已经是好友');
      return;
    }
    
    // 检查是否已有请求
    const targetRequests = dataStore.friendRequests.get(targetUserId) || [];
    const existingRequest = targetRequests.find(r => r.from === socket.id);
    if (existingRequest) {
      socket.emit('friendError', '已发送好友请求');
      return;
    }
    
    // 创建新请求
    const requestId = uuidv4();
    const newRequest = {
      id: requestId,
      from: socket.id,
      fromName: dataStore.users.get(socket.id).name,
      status: 'pending',
      time: new Date().toLocaleTimeString()
    };
    
    // 保存请求
    if (!dataStore.friendRequests.has(targetUserId)) {
      dataStore.friendRequests.set(targetUserId, []);
    }
    dataStore.friendRequests.get(targetUserId).push(newRequest);
    
    // 通知目标用户
    io.to(targetUserId).emit('newFriendRequest', newRequest);
    socket.emit('requestSent', { type: 'friend', target: dataStore.users.get(targetUserId).name });
  });

  // 处理好友请求
  socket.on('respondFriendRequest', ({ requestId, accepted }) => {
    if (!dataStore.users.has(socket.id)) return;
    
    // 找到请求
    const requests = dataStore.friendRequests.get(socket.id) || [];
    const requestIndex = requests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) return;
    
    const request = requests[requestIndex];
    request.status = accepted ? 'accepted' : 'rejected';
    
    // 更新请求
    requests[requestIndex] = request;
    dataStore.friendRequests.set(socket.id, requests);
    
    // 通知请求发送者
    io.to(request.from).emit('friendRequestResponse', {
      requestId: requestId,
      accepted: accepted,
      targetName: dataStore.users.get(socket.id).name
    });
    
    if (accepted) {
      // 添加为好友
      // 1. 添加到请求发送者的好友列表
      if (!dataStore.friends.has(request.from)) {
        dataStore.friends.set(request.from, []);
      }
      dataStore.friends.get(request.from).push(socket.id);
      
      // 2. 添加到当前用户的好友列表
      if (!dataStore.friends.has(socket.id)) {
        dataStore.friends.set(socket.id, []);
      }
      dataStore.friends.get(socket.id).push(request.from);
      
      // 通知双方好友列表更新
      io.to(request.from).emit('friendList', 
        dataStore.friends.get(request.from).map(friendId => ({
          id: friendId,
          name: dataStore.users.get(friendId)?.name || '未知用户'
        }))
      );
      
      io.to(socket.id).emit('friendList', 
        dataStore.friends.get(socket.id).map(friendId => ({
          id: friendId,
          name: dataStore.users.get(friendId)?.name || '未知用户'
        }))
      );
    }
    
    // 更新当前用户的请求列表
    socket.emit('friendRequests', requests);
  });

  // 发送消息（支持房间和私聊）
  socket.on('chatMessage', (msg) => {
    if (!dataStore.users.has(socket.id) || !msg.text) return;
    
    const user = dataStore.users.get(socket.id);
    const message = {
      id: uuidv4(),
      ...msg,
      text: msg.isEncrypted ? msg.text : sanitizeInput(msg.text).substring(0, 5000),
      user: user.name,
      userId: socket.id,
      time: new Date().toLocaleTimeString()
    };
    
    // 保存消息
    if (msg.roomId && dataStore.rooms.has(msg.roomId)) {
      // 房间消息
      dataStore.rooms.get(msg.roomId).messages.push(message);
      io.to(msg.roomId).emit('newMessage', message);
    } else if (msg.targetUserId && dataStore.friends.get(socket.id)?.includes(msg.targetUserId)) {
      // 私聊消息
      io.to(msg.targetUserId).emit('newMessage', message);
      socket.emit('newMessage', message); // 自己也能看到
    }
  });

  // 初始化文件上传
  socket.on('initFileUpload', (data) => {
    if (!dataStore.users.has(socket.id) || !data.name || !data.size) return;
    
    const uploadId = uuidv4();
    const fileName = sanitizeInput(data.name);
    const fileSize = parseInt(data.size);
    
    // 检查文件类型
    const ext = path.extname(fileName).toLowerCase();
    if (fileTypesConfig.blockedExtensions.includes(ext)) {
      socket.emit('uploadError', { 
        uploadId, 
        error: `不允许上传此类型文件: ${ext}` 
      });
      return;
    }
    
    // 检查文件大小
    if (fileSize > fileTypesConfig.maxFileSize) {
      socket.emit('uploadError', { 
        uploadId, 
        error: `文件大小不能超过${formatFileSize(fileTypesConfig.maxFileSize)}` 
      });
      return;
    }
    
    // 检查存储空间
    getRemainingStorage().then(storageInfo => {
      if (storageInfo.free < fileSize) {
        socket.emit('uploadError', { 
          uploadId, 
          error: `服务器存储空间不足，需要${formatFileSize(fileSize)}，剩余${storageInfo.freeFormatted}` 
        });
        return;
      }
      
      // 初始化上传记录
      dataStore.uploads.set(uploadId, {
        id: uploadId,
        fileName: fileName,
        fileSize: fileSize,
        progress: 0,
        startTime: Date.now(),
        owner: socket.id,
        target: data.target // roomId 或 targetUserId
      });
      
      // 响应客户端开始上传
      socket.emit('uploadInitialized', {
        uploadId,
        fileName,
        fileSize
      });
    });
  });

  // 更新上传进度
  socket.on('updateUploadProgress', ({ uploadId, uploaded }) => {
    const upload = dataStore.uploads.get(uploadId);
    if (!upload || upload.owner !== socket.id) return;
    
    // 计算进度信息
    const stats = calculateTransferStats(
      uploadId, 
      dataStore.uploads, 
      uploaded, 
      upload.fileSize, 
      upload.startTime
    );
    
    // 发送进度更新
    socket.emit('uploadProgress', {
      uploadId,
      ...stats
    });
  });

  // 文件上传完成
  socket.on('completeFileUpload', async (data) => {
    const { uploadId, sendOriginal } = data;
    const upload = dataStore.uploads.get(uploadId);
    if (!upload || upload.owner !== socket.id) return;
    
    try {
      // 查找上传的文件
      const files = await fs.readdir(uploadDir);
      const uploadedFile = files.find(file => file.includes(path.parse(upload.fileName).name));
      
      if (!uploadedFile) {
        throw new Error('文件未找到');
      }
      
      const filePath = path.join(uploadDir, uploadedFile);
      const isImage = fileTypesConfig.allowedImageTypes.some(type => 
        uploadedFile.toLowerCase().endsWith(type.split('/')[1])
      );
      
      let urls = {
        original: `/uploads/${uploadedFile}`,
        thumbnail: `/uploads/${uploadedFile}`
      };
      
      // 处理图片
      if (isImage) {
        urls = await processImage(filePath, uploadedFile, dataStore.users.get(socket.id).name);
      }
      
      // 发送文件消息
      const fileMessage = {
        id: uuidv4(),
        type: 'file',
        fileName: upload.fileName,
        fileUrl: sendOriginal === true ? urls.original : urls.thumbnail,
        originalUrl: isImage ? urls.original : null,
        thumbnailUrl: isImage ? urls.thumbnail : null,
        fileSize: upload.fileSize,
        isImage: isImage,
        user: dataStore.users.get(socket.id).name,
        userId: socket.id,
        time: new Date().toLocaleTimeString(),
        isEncrypted: data.isEncrypted || false,
        target: upload.target
      };
      
      // 发送文件消息
      if (upload.target.roomId && dataStore.rooms.has(upload.target.roomId)) {
        // 房间文件
        dataStore.rooms.get(upload.target.roomId).messages.push(fileMessage);
        io.to(upload.target.roomId).emit('newMessage', fileMessage);
      } else if (upload.target.userId && dataStore.friends.get(socket.id)?.includes(upload.target.userId)) {
        // 私聊文件
        io.to(upload.target.userId).emit('newMessage', fileMessage);
        socket.emit('newMessage', fileMessage); // 自己也能看到
      }
      
      // 通知上传完成
      socket.emit('uploadComplete', {
        uploadId,
        fileUrl: fileMessage.fileUrl
      });
      
      // 清理上传记录
      setTimeout(() => {
        dataStore.uploads.delete(uploadId);
      }, 30000);
      
    } catch (error) {
      console.error('文件上传完成处理失败:', error);
      socket.emit('uploadError', {
        uploadId,
        error: '文件处理失败: ' + error.message
      });
    }
  });

  // 初始化文件下载
  socket.on('initFileDownload', (data) => {
    if (!dataStore.users.has(socket.id) || !data.fileUrl) return;
    
    const downloadId = uuidv4();
    const fileName = path.basename(data.fileUrl);
    const filePath = path.join(__dirname, data.fileUrl.replace(/^\//, ''));
    
    // 检查文件是否存在
    fs.stat(filePath)
      .then(stat => {
        // 初始化下载记录
        dataStore.downloads.set(downloadId, {
          id: downloadId,
          fileName: fileName,
          fileSize: stat.size,
          progress: 0,
          startTime: Date.now(),
          owner: socket.id,
          fileUrl: data.fileUrl
        });
        
        // 响应客户端开始下载
        socket.emit('downloadInitialized', {
          downloadId,
          fileName,
          fileSize: stat.size,
          fileUrl: data.fileUrl
        });
      })
      .catch(error => {
        console.error('文件下载初始化失败:', error);
        socket.emit('downloadError', {
          downloadId,
          error: '文件不存在或无法访问'
        });
      });
  });

  // 更新下载进度
  socket.on('updateDownloadProgress', ({ downloadId, downloaded }) => {
    const download = dataStore.downloads.get(downloadId);
    if (!download || download.owner !== socket.id) return;
    
    // 计算进度信息
    const stats = calculateTransferStats(
      downloadId, 
      dataStore.downloads, 
      downloaded, 
      download.fileSize, 
      download.startTime
    );
    
    // 发送进度更新
    socket.emit('downloadProgress', {
      downloadId,
      ...stats
    });
    
    // 下载完成时清理记录
    if (stats.progress === 100) {
      setTimeout(() => {
        dataStore.downloads.delete(downloadId);
      }, 30000);
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    clearInterval(storageInterval);
    const user = dataStore.users.get(socket.id);
    if (!user) return;
    
    console.log('用户断开连接:', user.name);
    
    // 更新房间成员
    dataStore.rooms.forEach(room => {
      const index = room.members.indexOf(socket.id);
      if (index !== -1) {
        room.members.splice(index, 1);
        io.to(room.id).emit('systemMessage', {
          text: `${user.name} 离开了房间`,
          time: new Date().toLocaleTimeString(),
          roomId: room.id
        });
      }
    });
    
    // 移除用户
    dataStore.users.delete(socket.id);
    
    // 清理好友请求和好友关系
    dataStore.friendRequests.delete(socket.id);
    Array.from(dataStore.friendRequests.entries()).forEach(([userId, requests]) => {
      const filtered = requests.filter(r => r.from !== socket.id);
      dataStore.friendRequests.set(userId, filtered);
      io.to(userId).emit('friendRequests', filtered);
    });
    
    Array.from(dataStore.friends.entries()).forEach(([userId, friends]) => {
      const filtered = friends.filter(friendId => friendId !== socket.id);
      dataStore.friends.set(userId, filtered);
      io.to(userId).emit('friendList', filtered.map(friendId => ({
        id: friendId,
        name: dataStore.users.get(friendId)?.name || '未知用户'
      })));
    });
    
    // 更新用户列表
    io.emit('userList', Array.from(dataStore.users.entries()).map(([id, u]) => ({
      id: id,
      name: u.name,
      hasPublicKey: !!u.publicKey
    })));
    
    // 更新房间列表
    io.emit('roomList', Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === user.name
    })));
  });
});

// 文件上传接口
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }
    
    res.json({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error('文件上传接口错误:', error);
    res.status(400).json({ error: error.message });
  }
});

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 客户端文件服务
app.use(express.static(path.join(__dirname, '../client')));

// 启动服务器
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`主服务器运行在 http://localhost:${PORT}`);
});

// 错误处理
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('未处理的Promise拒绝:', reason);
});
