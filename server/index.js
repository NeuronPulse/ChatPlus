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
const si = require('systeminformation');
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
const voiceDir = path.join(uploadDir, 'voice');
if (!fsSync.existsSync(uploadDir)) {
  fsSync.mkdirSync(uploadDir, { recursive: true });
  console.log(`[初始化] 创建上传目录: ${uploadDir}`);
}
if (!fsSync.existsSync(thumbDir)) {
  fsSync.mkdirSync(thumbDir, { recursive: true });
  console.log(`[初始化] 创建缩略图目录: ${thumbDir}`);
}
if (!fsSync.existsSync(voiceDir)) {
  fsSync.mkdirSync(voiceDir, { recursive: true });
  console.log(`[初始化] 创建语音目录: ${voiceDir}`);
}

// 数据存储 - 增强版结构
const dataStore = {
  users: new Map(), // socketId -> {name, publicKey, rooms: []}
  rooms: new Map(), // roomId -> {id, name, creator, members: [], messages: [], files: []}
  privateChats: new Map(), // "userId1-userId2" -> {messages: [], files: []}
  friendRequests: new Map(), // userId -> [{id, from, fromName, status, time}]
  friends: new Map(), // userId -> [friendId]
  uploads: new Map(), // uploadId -> {progress, total, speed, remaining, timeRemaining, owner}
  downloads: new Map(), // downloadId -> {progress, total, speed, remaining, timeRemaining, owner}
  files: new Map() // fileId -> {id, name, url, thumbnailUrl, size, uploadTime, expiryTime, owner, type: 'file'|'voice', conversationType: 'room'|'private', conversationId}
};

// 文件上传配置 - 普通文件
const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const uniqueName = `${Date.now()}-${uuidv4()}-${safeName}`;
    console.log(`[文件存储] 生成文件名: ${uniqueName}`);
    cb(null, uniqueName);
  }
});

// 语音文件上传配置
const voiceStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, voiceDir);
  },
  filename: (req, file, cb) => {
    const uniqueName = `voice-${Date.now()}-${uuidv4()}.webm`;
    console.log(`[语音存储] 生成文件名: ${uniqueName}`);
    cb(null, uniqueName);
  }
});

// 文件过滤 - 使用配置文件
const fileFilter = (req, file, cb) => {
  console.log(`[文件过滤] 检查文件: ${file.originalname}, 类型: ${file.mimetype}`);
  
  // 检查文件扩展名
  const ext = path.extname(file.originalname).toLowerCase();
  if (fileTypesConfig.blockedExtensions.includes(ext)) {
    console.log(`[文件过滤] 拒绝上传 blocked 类型文件: ${ext}`);
    return cb(new Error(`不允许上传此类型文件: ${ext}`), false);
  }
  
  // 检查MIME类型
  const isImage = fileTypesConfig.allowedImageTypes.includes(file.mimetype);
  const isAllowedFile = fileTypesConfig.allowedFileTypes.includes(file.mimetype);
  const isVoice = file.mimetype.startsWith('audio/');
  
  if (!isImage && !isAllowedFile && !isVoice) {
    console.log(`[文件过滤] 拒绝上传不支持的文件类型: ${file.mimetype}`);
    return cb(new Error(`不支持的文件类型: ${file.mimetype}`), false);
  }
  
  // 检查文件大小
  const fileSize = parseInt(req.headers['content-length'] || '0');
  if (fileSize > fileTypesConfig.maxFileSize) {
    const maxSizeFormatted = formatFileSize(fileTypesConfig.maxFileSize);
    console.log(`[文件过滤] 拒绝上传过大文件: ${formatFileSize(fileSize)} > ${maxSizeFormatted}`);
    return cb(new Error(`文件大小不能超过${maxSizeFormatted}`), false);
  }
  
  cb(null, true);
};

// 初始化上传中间件
const fileUpload = multer({ 
  storage: fileStorage,
  fileFilter,
  limits: { fileSize: fileTypesConfig.maxFileSize }
});

const voiceUpload = multer({
  storage: voiceStorage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('audio/')) {
      console.log(`[语音过滤] 拒绝非音频文件: ${file.mimetype}`);
      return cb(new Error('仅支持音频文件'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB语音限制
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
    console.log(`[图片处理] 开始处理图片: ${fileName}`);
    const thumbPath = path.join(thumbDir, fileName);
    
    await sharp(filePath)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .withMetadata({ 
        sender: sender,
        timestamp: new Date().toISOString()
      })
      .toFile(thumbPath);
      
    console.log(`[图片处理] 图片处理完成: ${fileName}`);
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/thumbnails/${fileName}`
    };
  } catch (error) {
    console.error(`[图片处理] 图片处理失败: ${error.message}`);
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/${fileName}`
    };
  }
};

// 获取剩余存储空间
const getRemainingStorage = async () => {
  try {
    console.log(`[存储信息] 获取磁盘空间信息`);
    // 获取当前磁盘信息
    const diskInfo = await si.fsSize();
    // 找到包含上传目录的磁盘分区
    const uploadDirDrive = uploadDir.split(path.sep)[0] + path.sep;
    const targetDisk = diskInfo.find(disk => disk.mount === uploadDirDrive);
    
    if (targetDisk) {
      const storageInfo = { 
        total: targetDisk.size, 
        free: targetDisk.available,
        totalFormatted: formatFileSize(targetDisk.size),
        freeFormatted: formatFileSize(targetDisk.available),
        usedPercentage: Math.round(((targetDisk.size - targetDisk.available) / targetDisk.size) * 100)
      };
      console.log(`[存储信息] 磁盘空间: 总容量 ${storageInfo.totalFormatted}, 剩余 ${storageInfo.freeFormatted}`);
      return storageInfo;
    } else {
      // 如果找不到对应分区，返回第一个磁盘信息
      const firstDisk = diskInfo[0] || { size: 0, available: 0 };
      const storageInfo = { 
        total: firstDisk.size, 
        free: firstDisk.available,
        totalFormatted: formatFileSize(firstDisk.size),
        freeFormatted: formatFileSize(firstDisk.available),
        usedPercentage: firstDisk.size ? Math.round(((firstDisk.size - firstDisk.available) / firstDisk.size) * 100) : 0
      };
      console.log(`[存储信息] 使用默认磁盘信息: 总容量 ${storageInfo.totalFormatted}, 剩余 ${storageInfo.freeFormatted}`);
      return storageInfo;
    }
  } catch (error) {
    console.error(`[存储信息] 获取磁盘空间失败: ${error.message}`);
    return { total: 0, free: 0, totalFormatted: '0 B', freeFormatted: '0 B', usedPercentage: 0 };
  }
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
  
  if (stats.progress % 10 === 0) { // 每10%记录一次进度
    console.log(`[传输统计] ${transferId} 进度: ${stats.progress}%, 速度: ${stats.speedFormatted}`);
  }
  return stats;
}

// 初始化文件过期检查定时器
function initFileExpiryChecker() {
  // 每分钟检查一次过期文件
  setInterval(async () => {
    const now = Date.now();
    console.log(`[文件过期检查] 开始检查过期文件, 当前时间: ${new Date(now).toISOString()}`);
    
    const expiredFiles = [];
    
    // 检查所有文件
    dataStore.files.forEach(file => {
      if (file.expiryTime && file.expiryTime < now) {
        expiredFiles.push(file);
      }
    });
    
    if (expiredFiles.length > 0) {
      console.log(`[文件过期检查] 发现 ${expiredFiles.length} 个过期文件, 开始清理`);
      
      for (const file of expiredFiles) {
        try {
          // 从数据存储中移除
          dataStore.files.delete(file.id);
          
          // 从会话历史中移除
          if (file.conversationType === 'room' && dataStore.rooms.has(file.conversationId)) {
            const room = dataStore.rooms.get(file.conversationId);
            room.files = room.files.filter(f => f.id !== file.id);
          } else if (file.conversationType === 'private' && dataStore.privateChats.has(file.conversationId)) {
            const chat = dataStore.privateChats.get(file.conversationId);
            chat.files = chat.files.filter(f => f.id !== file.id);
          }
          
          // 删除实际文件
          const filePath = path.join(__dirname, file.url.replace(/^\//, ''));
          if (fsSync.existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`[文件过期检查] 删除过期文件: ${filePath}`);
          }
          
          // 如果是图片，也删除缩略图
          if (file.thumbnailUrl) {
            const thumbPath = path.join(__dirname, file.thumbnailUrl.replace(/^\//, ''));
            if (fsSync.existsSync(thumbPath)) {
              await fs.unlink(thumbPath);
              console.log(`[文件过期检查] 删除过期缩略图: ${thumbPath}`);
            }
          }
          
          // 通知文件所有者文件已过期
          io.to(file.owner).emit('fileExpired', {
            fileId: file.id,
            fileName: file.name
          });
          
        } catch (error) {
          console.error(`[文件过期检查] 清理文件 ${file.id} 失败: ${error.message}`);
        }
      }
    } else {
      console.log(`[文件过期检查] 未发现过期文件`);
    }
  }, 60000); // 每分钟检查一次
  
  console.log(`[初始化] 文件过期检查定时器已启动`);
}

// 获取私聊会话ID（确保一致性）
function getPrivateChatId(userId1, userId2) {
  return [userId1, userId2].sort().join('-');
}

// WebSocket事件处理
io.on('connection', (socket) => {
  console.log(`[连接] 新WebSocket连接: ${socket.id}`);
  
  // 发送存储空间信息
  const sendStorageInfo = async () => {
    try {
      const storageInfo = await getRemainingStorage();
      socket.emit('storageInfo', storageInfo);
      console.log(`[存储信息] 已向 ${socket.id} 发送存储空间信息`);
    } catch (error) {
      console.error(`[存储信息] 发送存储空间信息失败: ${error.message}`);
      socket.emit('storageError', { message: '获取存储空间信息失败' });
    }
  };
  
  // 初始发送一次存储空间信息
  sendStorageInfo();
  // 定期更新存储空间信息（每30秒）
  const storageInterval = setInterval(sendStorageInfo, 30000);

  // 用户登录
  socket.on('login', (username) => {
    console.log(`[登录] 用户尝试登录: ${username}, socketId: ${socket.id}`);
    
    const sanitizedUsername = sanitizeInput(username).substring(0, 50);
    if (!sanitizedUsername) {
      console.log(`[登录] 登录失败 - 无效的用户名: ${username}`);
      socket.emit('loginError', '无效的用户名');
      return;
    }
    
    // 检查用户名是否已存在
    const existingUser = Array.from(dataStore.users.values()).find(
      user => user.name === sanitizedUsername
    );
    
    if (existingUser) {
      console.log(`[登录] 登录失败 - 用户名已被使用: ${sanitizedUsername}`);
      socket.emit('loginError', '用户名已被使用');
      return;
    }
    
    dataStore.users.set(socket.id, {
      name: sanitizedUsername,
      publicKey: '',
      rooms: []
    });
    
    console.log(`[登录] 用户登录成功: ${sanitizedUsername}, socketId: ${socket.id}`);
    
    // 加入默认房间
    const defaultRoomId = 'default';
    if (!dataStore.rooms.has(defaultRoomId)) {
      dataStore.rooms.set(defaultRoomId, {
        id: defaultRoomId,
        name: '公共聊天室',
        creator: sanitizedUsername,
        members: [socket.id],
        messages: [],
        files: []
      });
      console.log(`[房间] 创建默认公共聊天室: ${defaultRoomId}`);
    } else {
      dataStore.rooms.get(defaultRoomId).members.push(socket.id);
      console.log(`[房间] 用户 ${sanitizedUsername} 加入默认房间: ${defaultRoomId}`);
    }
    
    dataStore.users.get(socket.id).rooms.push(defaultRoomId);
    socket.join(defaultRoomId);
    
    // 更新用户列表
    const userList = Array.from(dataStore.users.entries()).map(([id, user]) => ({
      id: id,
      name: user.name,
      hasPublicKey: !!user.publicKey
    }));
    io.emit('userList', userList);
    console.log(`[用户列表] 已更新并广播用户列表, 当前用户数: ${userList.length}`);
    
    // 发送房间列表
    const roomList = Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === sanitizedUsername
    }));
    socket.emit('roomList', roomList);
    console.log(`[房间列表] 向 ${sanitizedUsername} 发送房间列表, 共 ${roomList.length} 个房间`);
    
    // 发送好友请求
    const friendRequests = dataStore.friendRequests.get(socket.id) || [];
    socket.emit('friendRequests', friendRequests);
    console.log(`[好友请求] 向 ${sanitizedUsername} 发送 ${friendRequests.length} 个好友请求`);
    
    // 发送好友列表
    const friends = dataStore.friends.get(socket.id) || [];
    const friendList = friends.map(friendId => ({
      id: friendId,
      name: dataStore.users.get(friendId)?.name || '未知用户'
    }));
    socket.emit('friendList', friendList);
    console.log(`[好友列表] 向 ${sanitizedUsername} 发送 ${friendList.length} 个好友`);
    
    io.to(defaultRoomId).emit('systemMessage', { 
      text: `${sanitizedUsername} 加入聊天`, 
      time: new Date().toLocaleTimeString(),
      roomId: defaultRoomId
    });
    console.log(`[系统消息] ${sanitizedUsername} 加入默认房间`);
  });

  // 接收用户公钥
  socket.on('publicKey', (key) => {
    if (typeof key === 'string' && key.length > 100 && dataStore.users.has(socket.id)) {
      dataStore.users.get(socket.id).publicKey = key;
      const userList = Array.from(dataStore.users.entries()).map(([id, user]) => ({
        id: id,
        name: user.name,
        hasPublicKey: !!user.publicKey
      }));
      io.emit('userList', userList);
      console.log(`[公钥] 用户 ${dataStore.users.get(socket.id).name} 更新了公钥`);
    } else {
      console.log(`[公钥] 无效的公钥数据, socketId: ${socket.id}`);
    }
  });

  // 创建房间
  socket.on('createRoom', (roomName) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[房间创建] 未登录用户尝试创建房间, socketId: ${socket.id}`);
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    const sanitizedName = sanitizeInput(roomName).substring(0, 50);
    if (!sanitizedName) {
      console.log(`[房间创建] 用户 ${user.name} 尝试使用无效名称创建房间`);
      socket.emit('roomError', '无效的房间名称');
      return;
    }
    
    const roomId = uuidv4();
    dataStore.rooms.set(roomId, {
      id: roomId,
      name: sanitizedName,
      creator: user.name,
      members: [socket.id],
      messages: [],
      files: []
    });
    
    user.rooms.push(roomId);
    socket.join(roomId);
    
    // 广播房间列表更新
    const roomList = Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === user.name
    }));
    io.emit('roomList', roomList);
    
    socket.emit('roomCreated', { id: roomId, name: sanitizedName });
    socket.emit('systemMessage', {
      text: `已创建房间: ${sanitizedName}`,
      time: new Date().toLocaleTimeString(),
      roomId: roomId
    });
    
    console.log(`[房间创建] 用户 ${user.name} 创建了新房间: ${sanitizedName} (${roomId})`);
  });

  // 申请加入房间
  socket.on('requestJoinRoom', (roomId) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[加入房间] 未登录用户尝试加入房间, socketId: ${socket.id}`);
      return;
    }
    
    if (!dataStore.rooms.has(roomId)) {
      console.log(`[加入房间] 用户 ${dataStore.users.get(socket.id).name} 尝试加入不存在的房间: ${roomId}`);
      socket.emit('roomError', '房间不存在');
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    const room = dataStore.rooms.get(roomId);
    
    // 检查是否已在房间中
    if (room.members.includes(socket.id)) {
      console.log(`[加入房间] 用户 ${user.name} 已在房间中: ${room.name}`);
      socket.emit('roomError', '已在房间中');
      return;
    }
    
    // 找到房间创建者
    const creatorSocketId = Array.from(dataStore.users.entries()).find(
      ([id, u]) => u.name === room.creator
    )?.[0];
    
    if (creatorSocketId) {
      // 向房间创建者发送加入请求
      const requestId = uuidv4();
      io.to(creatorSocketId).emit('roomJoinRequest', {
        requestId: requestId,
        roomId: roomId,
        roomName: room.name,
        from: socket.id,
        fromName: user.name,
        time: new Date().toLocaleTimeString()
      });
      
      socket.emit('requestSent', { type: 'room', target: room.name });
      console.log(`[加入房间] 用户 ${user.name} 发送加入房间 ${room.name} 的请求, 等待创建者 ${room.creator} 批准`);
    } else {
      console.log(`[加入房间] 找不到房间 ${room.name} 的创建者`);
      socket.emit('roomError', '无法找到房间创建者');
    }
  });

  // 处理房间加入请求
  socket.on('respondRoomRequest', ({ requestId, roomId, accepted }) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[处理加入请求] 未登录用户尝试处理请求, socketId: ${socket.id}`);
      return;
    }
    
    if (!dataStore.rooms.has(roomId)) {
      console.log(`[处理加入请求] 房间不存在: ${roomId}`);
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    const room = dataStore.rooms.get(roomId);
    
    // 验证是否为房间创建者
    if (room.creator !== user.name) {
      console.log(`[处理加入请求] 用户 ${user.name} 不是房间 ${room.name} 的创建者, 无权处理请求`);
      return;
    }
    
    // 找到请求者
    // 这里改进了查找逻辑，确保能正确找到请求者
    const allUsers = Array.from(dataStore.users.keys());
    const requesterSocketId = allUsers.find(id => 
      !room.members.includes(id) && 
      // 排除当前用户自己
      id !== socket.id
    );
      
    if (!requesterSocketId) {
      console.log(`[处理加入请求] 找不到请求者, 房间: ${room.name}`);
      return;
    }
    
    const requesterName = dataStore.users.get(requesterSocketId)?.name || '未知用户';
    
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
        text: `${requesterName} 加入了房间`,
        time: new Date().toLocaleTimeString(),
        roomId: roomId
      });
      
      // 更新房间列表
      const roomList = Array.from(dataStore.rooms.values()).map(r => ({
        id: r.id,
        name: r.name,
        memberCount: r.members.length,
        isCreator: r.creator === user.name
      }));
      io.emit('roomList', roomList);
      
      console.log(`[处理加入请求] 房间创建者 ${user.name} 同意 ${requesterName} 加入房间 ${room.name}`);
    } else {
      // 拒绝加入
      io.to(requesterSocketId).emit('roomRequestResponse', {
        accepted: false,
        roomId: roomId,
        roomName: room.name
      });
      console.log(`[处理加入请求] 房间创建者 ${user.name} 拒绝 ${requesterName} 加入房间 ${room.name}`);
    }
  });

  // 发送好友请求
  socket.on('sendFriendRequest', (targetUserId) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[好友请求] 未登录用户尝试发送好友请求, socketId: ${socket.id}`);
      return;
    }
    
    if (!dataStore.users.has(targetUserId)) {
      console.log(`[好友请求] 目标用户不存在: ${targetUserId}, 发送者: ${socket.id}`);
      socket.emit('friendError', '目标用户不存在');
      return;
    }
    
    if (socket.id === targetUserId) {
      console.log(`[好友请求] 用户尝试添加自己为好友: ${socket.id}`);
      socket.emit('friendError', '不能添加自己为好友');
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    const targetUser = dataStore.users.get(targetUserId);
    
    // 检查是否已经是好友
    const friends = dataStore.friends.get(socket.id) || [];
    if (friends.includes(targetUserId)) {
      console.log(`[好友请求] 用户 ${user.name} 尝试添加已存在的好友 ${targetUser.name}`);
      socket.emit('friendError', '已经是好友');
      return;
    }
    
    // 检查是否已有请求
    const targetRequests = dataStore.friendRequests.get(targetUserId) || [];
    const existingRequest = targetRequests.find(r => r.from === socket.id);
    if (existingRequest) {
      console.log(`[好友请求] 用户 ${user.name} 重复向 ${targetUser.name} 发送好友请求`);
      socket.emit('friendError', '已发送好友请求');
      return;
    }
    
    // 创建新请求
    const requestId = uuidv4();
    const newRequest = {
      id: requestId,
      from: socket.id,
      fromName: user.name,
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
    socket.emit('requestSent', { type: 'friend', target: targetUser.name });
    
    console.log(`[好友请求] 用户 ${user.name} 向 ${targetUser.name} 发送好友请求`);
  });

  // 处理好友请求
  socket.on('respondFriendRequest', ({ requestId, accepted }) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[处理好友请求] 未登录用户尝试处理请求, socketId: ${socket.id}`);
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    // 找到请求
    const requests = dataStore.friendRequests.get(socket.id) || [];
    const requestIndex = requests.findIndex(r => r.id === requestId);
    if (requestIndex === -1) {
      console.log(`[处理好友请求] 找不到请求: ${requestId}, 用户: ${user.name}`);
      return;
    }
    
    const request = requests[requestIndex];
    request.status = accepted ? 'accepted' : 'rejected';
    const requesterName = request.fromName;
    
    // 更新请求
    requests[requestIndex] = request;
    dataStore.friendRequests.set(socket.id, requests);
    
    // 通知请求发送者
    io.to(request.from).emit('friendRequestResponse', {
      requestId: requestId,
      accepted: accepted,
      targetName: user.name
    });
    
    if (accepted) {
      console.log(`[处理好友请求] 用户 ${user.name} 接受了 ${requesterName} 的好友请求`);
      
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
      
      // 初始化私聊会话
      const privateChatId = getPrivateChatId(socket.id, request.from);
      if (!dataStore.privateChats.has(privateChatId)) {
        dataStore.privateChats.set(privateChatId, {
          messages: [],
          files: []
        });
        console.log(`[私聊初始化] 为 ${user.name} 和 ${requesterName} 创建私聊会话: ${privateChatId}`);
      }
      
      // 通知双方好友列表更新
      const requesterFriendList = dataStore.friends.get(request.from).map(friendId => ({
        id: friendId,
        name: dataStore.users.get(friendId)?.name || '未知用户'
      }));
      io.to(request.from).emit('friendList', requesterFriendList);
      
      const userFriendList = dataStore.friends.get(socket.id).map(friendId => ({
        id: friendId,
        name: dataStore.users.get(friendId)?.name || '未知用户'
      }));
      io.to(socket.id).emit('friendList', userFriendList);
      
    } else {
      console.log(`[处理好友请求] 用户 ${user.name} 拒绝了 ${requesterName} 的好友请求`);
    }
    
    // 更新当前用户的请求列表
    socket.emit('friendRequests', requests);
  });

  // 发送消息（支持房间和私聊）
  socket.on('chatMessage', (msg) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[发送消息] 未登录用户尝试发送消息, socketId: ${socket.id}`);
      return;
    }
    
    if (!msg.text) {
      console.log(`[发送消息] 用户 ${dataStore.users.get(socket.id).name} 尝试发送空消息`);
      return;
    }
    
    const user = dataStore.users.get(socket.id);
    const message = {
      id: uuidv4(),
      ...msg,
      text: msg.isEncrypted ? msg.text : sanitizeInput(msg.text).substring(0, 5000),
      user: user.name,
      userId: socket.id,
      time: new Date().toLocaleTimeString(),
      type: 'text'
    };
    
    console.log(`[发送消息] 用户 ${user.name} 发送${msg.roomId ? '房间' : '私聊'}消息: ${message.text.substring(0, 20)}${message.text.length > 20 ? '...' : ''}`);
    
    // 保存消息
    if (msg.roomId && dataStore.rooms.has(msg.roomId)) {
      // 房间消息
      dataStore.rooms.get(msg.roomId).messages.push(message);
      io.to(msg.roomId).emit('newMessage', message);
    } else if (msg.targetUserId && dataStore.friends.get(socket.id)?.includes(msg.targetUserId)) {
      // 私聊消息
      const privateChatId = getPrivateChatId(socket.id, msg.targetUserId);
      if (!dataStore.privateChats.has(privateChatId)) {
        dataStore.privateChats.set(privateChatId, { messages: [], files: [] });
      }
      dataStore.privateChats.get(privateChatId).messages.push(message);
      
      io.to(msg.targetUserId).emit('newMessage', message);
      socket.emit('newMessage', message); // 自己也能看到
    } else {
      console.log(`[发送消息] 消息发送失败，目标不存在或不是好友`);
      socket.emit('messageError', '无法发送消息，目标不存在或不是好友');
    }
  });

  // 发送语音消息
  socket.on('initVoiceUpload', (data) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[语音上传] 未登录用户尝试上传语音, socketId: ${socket.id}`);
      return;
    }
    
    if (!data.duration || !data.size) {
      console.log(`[语音上传] 语音数据不完整, 用户: ${dataStore.users.get(socket.id).name}`);
      socket.emit('voiceError', { error: '语音数据不完整' });
      return;
    }
    
    const uploadId = uuidv4();
    const user = dataStore.users.get(socket.id);
    const fileSize = parseInt(data.size);
    
    // 检查文件大小（10MB限制）
    if (fileSize > 10 * 1024 * 1024) {
      console.log(`[语音上传] 语音文件过大: ${formatFileSize(fileSize)}, 用户: ${user.name}`);
      socket.emit('voiceError', { 
        uploadId, 
        error: `语音文件大小不能超过10MB` 
      });
      return;
    }
    
    // 检查存储空间
    getRemainingStorage().then(storageInfo => {
      if (storageInfo.free < fileSize) {
        console.log(`[语音上传] 存储空间不足, 需要${formatFileSize(fileSize)}, 剩余${storageInfo.freeFormatted}, 用户: ${user.name}`);
        socket.emit('voiceError', { 
          uploadId, 
          error: `服务器存储空间不足，需要${formatFileSize(fileSize)}，剩余${storageInfo.freeFormatted}` 
        });
        return;
      }
      
      // 初始化上传记录
      dataStore.uploads.set(uploadId, {
        id: uploadId,
        type: 'voice',
        duration: data.duration,
        fileSize: fileSize,
        progress: 0,
        startTime: Date.now(),
        owner: socket.id,
        target: data.target // roomId 或 targetUserId
      });
      
      // 响应客户端开始上传
      socket.emit('voiceUploadInitialized', {
        uploadId,
        fileSize
      });
      
      console.log(`[语音上传] 初始化语音上传, ID: ${uploadId}, 大小: ${formatFileSize(fileSize)}, 用户: ${user.name}`);
    });
  });

  // 更新语音上传进度
  socket.on('updateVoiceUploadProgress', ({ uploadId, uploaded }) => {
    const upload = dataStore.uploads.get(uploadId);
    if (!upload || upload.owner !== socket.id || upload.type !== 'voice') {
      console.log(`[语音上传进度] 无效的上传ID或权限不足: ${uploadId}, 用户: ${socket.id}`);
      return;
    }
    
    // 计算进度信息
    const stats = calculateTransferStats(
      uploadId, 
      dataStore.uploads, 
      uploaded, 
      upload.fileSize, 
      upload.startTime
    );
    
    // 发送进度更新
    socket.emit('voiceUploadProgress', {
      uploadId,
      ...stats
    });
  });

  // 语音上传完成
  socket.on('completeVoiceUpload', async (data) => {
    const { uploadId } = data;
    const upload = dataStore.uploads.get(uploadId);
    if (!upload || upload.owner !== socket.id || upload.type !== 'voice') {
      console.log(`[语音上传完成] 无效的上传ID或权限不足: ${uploadId}, 用户: ${socket.id}`);
      return;
    }
    
    try {
      const user = dataStore.users.get(socket.id);
      // 查找上传的语音文件
      const files = await fs.readdir(voiceDir);
      // 查找最新的语音文件（因为文件名包含时间戳）
      const sortedFiles = files.filter(f => f.startsWith('voice-')).sort().reverse();
      const voiceFile = sortedFiles[0];
      
      if (!voiceFile) {
        throw new Error('语音文件未找到');
      }
      
      const filePath = path.join(voiceDir, voiceFile);
      const fileStats = await fs.stat(filePath);
      
      // 生成文件ID
      const fileId = uuidv4();
      const fileUrl = `/uploads/voice/${voiceFile}`;
      
      // 保存文件信息（默认无限期）
      dataStore.files.set(fileId, {
        id: fileId,
        name: `语音消息-${new Date().toLocaleString()}.webm`,
        url: fileUrl,
        size: fileStats.size,
        uploadTime: Date.now(),
        expiryTime: null, // 默认无限期
        owner: socket.id,
        type: 'voice',
        duration: upload.duration,
        conversationType: upload.target.roomId ? 'room' : 'private',
        conversationId: upload.target.roomId || getPrivateChatId(socket.id, upload.target.userId)
      });
      
      // 发送语音消息
      const voiceMessage = {
        id: uuidv4(),
        fileId: fileId,
        fileName: `语音消息 (${Math.round(upload.duration / 1000)}秒)`,
        fileUrl: fileUrl,
        fileSize: fileStats.size,
        duration: upload.duration,
        type: 'voice',
        user: user.name,
        userId: socket.id,
        time: new Date().toLocaleTimeString(),
        expiryTime: null,
        target: upload.target
      };
      
      // 保存到会话历史
      if (upload.target.roomId && dataStore.rooms.has(upload.target.roomId)) {
        // 房间语音
        dataStore.rooms.get(upload.target.roomId).messages.push(voiceMessage);
        dataStore.rooms.get(upload.target.roomId).files.push({
          id: fileId,
          name: voiceMessage.fileName,
          size: fileStats.size,
          time: voiceMessage.time,
          user: user.name,
          userId: socket.id,
          type: 'voice',
          duration: upload.duration,
          expiryTime: null
        });
        io.to(upload.target.roomId).emit('newMessage', voiceMessage);
        console.log(`[语音上传完成] 房间语音消息已发送, 房间: ${upload.target.roomId}, 文件ID: ${fileId}`);
      } else if (upload.target.userId && dataStore.friends.get(socket.id)?.includes(upload.target.userId)) {
        // 私聊语音
        const privateChatId = getPrivateChatId(socket.id, upload.target.userId);
        if (!dataStore.privateChats.has(privateChatId)) {
          dataStore.privateChats.set(privateChatId, { messages: [], files: [] });
        }
        dataStore.privateChats.get(privateChatId).messages.push(voiceMessage);
        dataStore.privateChats.get(privateChatId).files.push({
          id: fileId,
          name: voiceMessage.fileName,
          size: fileStats.size,
          time: voiceMessage.time,
          user: user.name,
          userId: socket.id,
          type: 'voice',
          duration: upload.duration,
          expiryTime: null
        });
        
        io.to(upload.target.userId).emit('newMessage', voiceMessage);
        socket.emit('newMessage', voiceMessage); // 自己也能看到
        console.log(`[语音上传完成] 私聊语音消息已发送, 目标: ${upload.target.userId}, 文件ID: ${fileId}`);
      }
      
      // 通知上传完成
      socket.emit('voiceUploadComplete', {
        uploadId,
        fileUrl: fileUrl,
        fileId: fileId
      });
      
      // 清理上传记录
      setTimeout(() => {
        dataStore.uploads.delete(uploadId);
      }, 30000);
      
    } catch (error) {
      console.error(`[语音上传完成] 处理失败: ${error.message}`);
      socket.emit('voiceError', {
        uploadId,
        error: '语音处理失败: ' + error.message
      });
    }
  });

  // 初始化文件上传
  socket.on('initFileUpload', (data) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[文件上传] 未登录用户尝试上传文件, socketId: ${socket.id}`);
      return;
    }
    
    if (!data.name || !data.size) {
      console.log(`[文件上传] 文件信息不完整, 用户: ${dataStore.users.get(socket.id).name}`);
      socket.emit('uploadError', { error: '文件信息不完整' });
      return;
    }
    
    const uploadId = uuidv4();
    const fileName = sanitizeInput(data.name);
    const fileSize = parseInt(data.size);
    const user = dataStore.users.get(socket.id);
    
    // 检查文件类型
    const ext = path.extname(fileName).toLowerCase();
    if (fileTypesConfig.blockedExtensions.includes(ext)) {
      console.log(`[文件上传] 不允许的文件类型: ${ext}, 用户: ${user.name}`);
      socket.emit('uploadError', { 
        uploadId, 
        error: `不允许上传此类型文件: ${ext}` 
      });
      return;
    }
    
    // 检查文件大小
    if (fileSize > fileTypesConfig.maxFileSize) {
      const maxSizeFormatted = formatFileSize(fileTypesConfig.maxFileSize);
      console.log(`[文件上传] 文件过大: ${formatFileSize(fileSize)} > ${maxSizeFormatted}, 用户: ${user.name}`);
      socket.emit('uploadError', { 
        uploadId, 
        error: `文件大小不能超过${maxSizeFormatted}` 
      });
      return;
    }
    
    // 检查存储空间
    getRemainingStorage().then(storageInfo => {
      if (storageInfo.free < fileSize) {
        console.log(`[文件上传] 存储空间不足, 需要${formatFileSize(fileSize)}, 剩余${storageInfo.freeFormatted}, 用户: ${user.name}`);
        socket.emit('uploadError', { 
          uploadId, 
          error: `服务器存储空间不足，需要${formatFileSize(fileSize)}，剩余${storageInfo.freeFormatted}` 
        });
        return;
      }
      
      // 处理保质期（单位：毫秒，null表示无限期）
      let expiryTime = null;
      if (data.expiryTime && !isNaN(data.expiryTime) && data.expiryTime > 0) {
        expiryTime = Date.now() + parseInt(data.expiryTime);
      }
      
      // 初始化上传记录
      dataStore.uploads.set(uploadId, {
        id: uploadId,
        type: 'file',
        fileName: fileName,
        fileSize: fileSize,
        expiryTime: expiryTime,
        progress: 0,
        startTime: Date.now(),
        owner: socket.id,
        target: data.target // roomId 或 targetUserId
      });
      
      // 响应客户端开始上传
      socket.emit('uploadInitialized', {
        uploadId,
        fileName,
        fileSize,
        expiryTime
      });
      
      console.log(`[文件上传] 初始化文件上传, ID: ${uploadId}, 名称: ${fileName}, 大小: ${formatFileSize(fileSize)}, 用户: ${user.name}`);
    });
  });

  // 更新上传进度
  socket.on('updateUploadProgress', ({ uploadId, uploaded }) => {
    const upload = dataStore.uploads.get(uploadId);
    if (!upload || upload.owner !== socket.id || upload.type !== 'file') {
      console.log(`[文件上传进度] 无效的上传ID或权限不足: ${uploadId}, 用户: ${socket.id}`);
      return;
    }
    
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
    if (!upload || upload.owner !== socket.id || upload.type !== 'file') {
      console.log(`[文件上传完成] 无效的上传ID或权限不足: ${uploadId}, 用户: ${socket.id}`);
      return;
    }
    
    try {
      const user = dataStore.users.get(socket.id);
      // 查找上传的文件
      const files = await fs.readdir(uploadDir);
      // 查找包含原始文件名且最新的文件
      const baseName = path.parse(upload.fileName).name;
      const uploadedFile = files
        .filter(file => file.includes(baseName))
        .sort()
        .reverse()[0];
      
      if (!uploadedFile) {
        throw new Error('文件未找到');
      }
      
      const filePath = path.join(uploadDir, uploadedFile);
      const fileStats = await fs.stat(filePath);
      const isImage = fileTypesConfig.allowedImageTypes.some(type => 
        uploadedFile.toLowerCase().endsWith(type.split('/')[1])
      );
      
      let urls = {
        original: `/uploads/${uploadedFile}`,
        thumbnail: `/uploads/${uploadedFile}`
      };
      
      // 处理图片
      if (isImage) {
        urls = await processImage(filePath, uploadedFile, user.name);
      }
      
      // 生成文件ID
      const fileId = uuidv4();
      
      // 保存文件信息
      dataStore.files.set(fileId, {
        id: fileId,
        name: upload.fileName,
        url: urls.original,
        thumbnailUrl: isImage ? urls.thumbnail : null,
        size: fileStats.size,
        uploadTime: Date.now(),
        expiryTime: upload.expiryTime, // 保存保质期
        owner: socket.id,
        type: 'file',
        isImage: isImage,
        conversationType: upload.target.roomId ? 'room' : 'private',
        conversationId: upload.target.roomId || getPrivateChatId(socket.id, upload.target.userId)
      });
      
      // 发送文件消息
      const fileMessage = {
        id: uuidv4(),
        fileId: fileId,
        type: 'file',
        fileName: upload.fileName,
        fileUrl: sendOriginal === true ? urls.original : urls.thumbnail,
        originalUrl: isImage ? urls.original : null,
        thumbnailUrl: isImage ? urls.thumbnail : null,
        fileSize: fileStats.size,
        isImage: isImage,
        user: user.name,
        userId: socket.id,
        time: new Date().toLocaleTimeString(),
        isEncrypted: data.isEncrypted || false,
        target: upload.target,
        expiryTime: upload.expiryTime,
        expiryTimeFormatted: upload.expiryTime 
          ? new Date(upload.expiryTime).toLocaleString() 
          : '永久'
      };
      
      // 保存到会话历史文件列表
      if (upload.target.roomId && dataStore.rooms.has(upload.target.roomId)) {
        // 房间文件
        dataStore.rooms.get(upload.target.roomId).messages.push(fileMessage);
        dataStore.rooms.get(upload.target.roomId).files.push({
          id: fileId,
          name: upload.fileName,
          size: fileStats.size,
          time: fileMessage.time,
          user: user.name,
          userId: socket.id,
          isImage: isImage,
          expiryTime: upload.expiryTime,
          expiryTimeFormatted: fileMessage.expiryTimeFormatted
        });
        io.to(upload.target.roomId).emit('newMessage', fileMessage);
        console.log(`[文件上传完成] 房间文件已发送, 房间: ${upload.target.roomId}, 文件ID: ${fileId}`);
      } else if (upload.target.userId && dataStore.friends.get(socket.id)?.includes(upload.target.userId)) {
        // 私聊文件
        const privateChatId = getPrivateChatId(socket.id, upload.target.userId);
        if (!dataStore.privateChats.has(privateChatId)) {
          dataStore.privateChats.set(privateChatId, { messages: [], files: [] });
        }
        dataStore.privateChats.get(privateChatId).messages.push(fileMessage);
        dataStore.privateChats.get(privateChatId).files.push({
          id: fileId,
          name: upload.fileName,
          size: fileStats.size,
          time: fileMessage.time,
          user: user.name,
          userId: socket.id,
          isImage: isImage,
          expiryTime: upload.expiryTime,
          expiryTimeFormatted: fileMessage.expiryTimeFormatted
        });
        
        io.to(upload.target.userId).emit('newMessage', fileMessage);
        socket.emit('newMessage', fileMessage); // 自己也能看到
        console.log(`[文件上传完成] 私聊文件已发送, 目标: ${upload.target.userId}, 文件ID: ${fileId}`);
      }
      
      // 通知上传完成
      socket.emit('uploadComplete', {
        uploadId,
        fileUrl: fileMessage.fileUrl,
        fileId: fileId
      });
      
      // 清理上传记录
      setTimeout(() => {
        dataStore.uploads.delete(uploadId);
      }, 30000);
      
    } catch (error) {
      console.error(`[文件上传完成] 处理失败: ${error.message}`);
      socket.emit('uploadError', {
        uploadId,
        error: '文件处理失败: ' + error.message
      });
    }
  });

  // 修改文件保质期
  socket.on('updateFileExpiry', ({ fileId, newExpiryTime }) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[修改保质期] 未登录用户尝试修改文件保质期, socketId: ${socket.id}`);
      return;
    }
    
    const file = dataStore.files.get(fileId);
    if (!file) {
      console.log(`[修改保质期] 文件不存在: ${fileId}, 用户: ${socket.id}`);
      socket.emit('fileError', { error: '文件不存在' });
      return;
    }
    
    // 检查是否为文件所有者
    if (file.owner !== socket.id) {
      console.log(`[修改保质期] 无权限修改文件 ${fileId}, 用户: ${socket.id} 不是所有者`);
      socket.emit('fileError', { error: '没有权限修改此文件' });
      return;
    }
    
    // 处理新的保质期（null表示无限期）
    let expiryTime = null;
    if (newExpiryTime && !isNaN(newExpiryTime) && newExpiryTime > 0) {
      expiryTime = Date.now() + parseInt(newExpiryTime);
    }
    
    // 更新文件保质期
    file.expiryTime = expiryTime;
    dataStore.files.set(fileId, file);
    
    // 更新会话中的文件记录
    if (file.conversationType === 'room' && dataStore.rooms.has(file.conversationId)) {
      const room = dataStore.rooms.get(file.conversationId);
      const fileIndex = room.files.findIndex(f => f.id === fileId);
      if (fileIndex !== -1) {
        room.files[fileIndex].expiryTime = expiryTime;
        room.files[fileIndex].expiryTimeFormatted = expiryTime 
          ? new Date(expiryTime).toLocaleString() 
          : '永久';
      }
      // 通知房间内的用户
      io.to(file.conversationId).emit('fileExpiryUpdated', {
        fileId,
        expiryTime,
        expiryTimeFormatted: expiryTime 
          ? new Date(expiryTime).toLocaleString() 
          : '永久'
      });
    } else if (file.conversationType === 'private' && dataStore.privateChats.has(file.conversationId)) {
      const chat = dataStore.privateChats.get(file.conversationId);
      const fileIndex = chat.files.findIndex(f => f.id === fileId);
      if (fileIndex !== -1) {
        chat.files[fileIndex].expiryTime = expiryTime;
        chat.files[fileIndex].expiryTimeFormatted = expiryTime 
          ? new Date(expiryTime).toLocaleString() 
          : '永久';
      }
      // 通知私聊双方
      const [userId1, userId2] = file.conversationId.split('-');
      io.to(userId1).emit('fileExpiryUpdated', {
        fileId,
        expiryTime,
        expiryTimeFormatted: expiryTime 
          ? new Date(expiryTime).toLocaleString() 
          : '永久'
      });
      io.to(userId2).emit('fileExpiryUpdated', {
        fileId,
        expiryTime,
        expiryTimeFormatted: expiryTime 
          ? new Date(expiryTime).toLocaleString() 
          : '永久'
      });
    }
    
    console.log(`[修改保质期] 文件 ${fileId} 保质期已更新为 ${expiryTime ? new Date(expiryTime).toLocaleString() : '永久'}, 用户: ${dataStore.users.get(socket.id).name}`);
    socket.emit('fileExpiryUpdated', {
      fileId,
      expiryTime,
      expiryTimeFormatted: expiryTime 
        ? new Date(expiryTime).toLocaleString() 
        : '永久'
    });
  });

  // 获取会话历史文件列表
  socket.on('getConversationFiles', ({ conversationType, conversationId }) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[获取文件列表] 未登录用户尝试获取文件列表, socketId: ${socket.id}`);
      return;
    }
    
    let files = [];
    
    if (conversationType === 'room' && dataStore.rooms.has(conversationId)) {
      // 检查用户是否在房间中
      const room = dataStore.rooms.get(conversationId);
      if (!room.members.includes(socket.id)) {
        console.log(`[获取文件列表] 用户 ${dataStore.users.get(socket.id).name} 不在房间 ${conversationId} 中，无权获取权限`);
        socket.emit('fileError', { error: '没有权限访问此房间的文件' });
        return;
      }
      files = room.files;
      console.log(`[获取文件列表] 向用户 ${dataStore.users.get(socket.id).name} 发送送房间 ${conversationId} 的文件列表，共 ${files.length} 个文件`);
    } else if (conversationType === 'private' && dataStore.privateChats.has(conversationId)) {
      // 检查用户是否为私聊参与者
      const [userId1, userId2] = conversationId.split('-');
      if (socket.id !== userId1 && socket.id !== userId2) {
        console.log(`[获取文件列表] 用户 ${dataStore.users.get(socket.id).name} 不是私聊 ${conversationId} 的参与者，无权限`);
        socket.emit('fileError', { error: '没有权限访问此聊天的文件' });
        return;
      }
      files = dataStore.privateChats.get(conversationId).files;
      console.log(`[获取文件列表] 向用户 ${dataStore.users.get(socket.id).name} 发送私聊 ${conversationId} 的文件列表，共 ${files.length} 个文件`);
    } else {
      console.log(`[获取文件列表] 会话不存在: ${conversationType} ${conversationId}`);
      socket.emit('fileError', { error: '会话不存在' });
      return;
    }
    
    socket.emit('conversationFiles', {
      conversationType,
      conversationId,
      files: files.map(file => ({
        ...file,
        sizeFormatted: formatFileSize(file.size)
      }))
    });
  });

  // 初始化文件下载
  socket.on('initFileDownload', (data) => {
    if (!dataStore.users.has(socket.id)) {
      console.log(`[文件下载] 未登录用户尝试下载文件, socketId: ${socket.id}`);
      return;
    }
    
    if (!data.fileUrl) {
      console.log(`[文件下载] 文件URL不存在, 用户: ${dataStore.users.get(socket.id).name}`);
      socket.emit('downloadError', { error: '文件URL不存在' });
      return;
    }
    
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
        
        console.log(`[文件下载] 初始化文件下载, ID: ${downloadId}, 名称: ${fileName}, 用户: ${dataStore.users.get(socket.id).name}`);
      })
      .catch(error => {
        console.error(`[文件下载] 初始化失败: ${error.message}`);
        socket.emit('downloadError', {
          downloadId,
          error: '文件不存在或无法访问'
        });
      });
  });

  // 更新下载进度
  socket.on('updateDownloadProgress', ({ downloadId, downloaded }) => {
    const download = dataStore.downloads.get(downloadId);
    if (!download || download.owner !== socket.id) {
      console.log(`[下载进度] 无效的下载ID或权限不足: ${downloadId}, 用户: ${socket.id}`);
      return;
    }
    
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
      console.log(`[下载进度] 下载完成: ${downloadId}, 文件: ${download.fileName}`);
      setTimeout(() => {
        dataStore.downloads.delete(downloadId);
      }, 30000);
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    clearInterval(storageInterval);
    const user = dataStore.users.get(socket.id);
    if (!user) {
      console.log(`[断开连接] 未知用户断开连接: ${socket.id}`);
      return;
    }
    
    console.log(`[断开连接] 用户 ${user.name} 断开连接`);
    
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
        
        // 如果房间创建者离开，需要处理房间所有权
        if (room.creator === user.name && room.members.length > 0) {
          const newCreatorId = room.members[0];
          const newCreator = dataStore.users.get(newCreatorId);
          if (newCreator) {
            room.creator = newCreator.name;
            console.log(`[房间维护] 房间 ${room.name} 所有权转移给 ${newCreator.name}`);
            io.to(room.id).emit('systemMessage', {
              text: `${newCreator.name} 成为房间新管理员`,
              time: new Date().toLocaleTimeString(),
              roomId: room.id
            });
          }
        }
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
    const userList = Array.from(dataStore.users.entries()).map(([id, u]) => ({
      id: id,
      name: u.name,
      hasPublicKey: !!u.publicKey
    }));
    io.emit('userList', userList);
    console.log(`[用户列表] 用户 ${user.name} 离开后，当前用户数: ${userList.length}`);
    
    // 更新房间列表
    const roomList = Array.from(dataStore.rooms.values()).map(room => ({
      id: room.id,
      name: room.name,
      memberCount: room.members.length,
      isCreator: room.creator === user.name
    }));
    io.emit('roomList', roomList);
  });
});

// 文件上传接口
app.post('/upload', fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      console.log(`[HTTP上传] 未收到文件`);
      return res.status(400).json({ error: '未上传文件' });
    }
    
    console.log(`[HTTP上传] 文件上传成功: ${req.file.filename}, 大小: ${formatFileSize(req.file.size)}`);
    res.json({
      fileName: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error(`[HTTP上传] 接口错误: ${error.message}`);
    res.status(400).json({ error: error.message });
  }
});

// 语音上传接口
app.post('/upload-voice', voiceUpload.single('voice'), async (req, res) => {
  try {
    if (!req.file) {
      console.log(`[HTTP语音上传] 未收到语音文件`);
      return res.status(400).json({ error: '未上传语音文件' });
    }
    
    console.log(`[HTTP语音上传] 语音上传成功: ${req.file.filename}, 大小: ${formatFileSize(req.file.size)}`);
    res.json({
      fileName: req.file.filename,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
  } catch (error) {
    console.error(`[HTTP语音上传] 接口错误: ${error.message}`);
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
  console.log(`[服务器启动] 主服务器运行在 http://localhost:${PORT}`);
  // 初始化文件过期检查
  initFileExpiryChecker();
});

// 错误处理
process.on('uncaughtException', (err) => {
  console.error(`[未捕获异常] ${err.stack}`);
});

process.on('unhandledRejection', (reason) => {
  console.error(`[未处理Promise拒绝] ${reason}`);
});
