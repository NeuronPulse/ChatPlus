const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const sharp = require('sharp');
const si = require('systeminformation');
const { Op, Transaction } = require('sequelize');
const fileTypesConfig = require('./config/file-types.json');
const { sequelize, syncDB, User, Room, RoomMember, Message, Friend, File } = require('./models');

// 初始化数据库
syncDB();

// 创建Express应用
const app = express();

// CORS配置 - 生产环境建议限制origin
app.use(cors({
  origin: "*",
  methods: ["GET", "POST"],
  credentials: true
}));

// 安全配置
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 确保上传目录存在（添加错误处理）
const uploadDir = path.join(__dirname, 'uploads');
const thumbDir = path.join(uploadDir, 'thumbnails');
const voiceDir = path.join(uploadDir, 'voice');

const ensureDirExists = async (dir) => {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
    console.log(`[初始化] 创建目录: ${dir}`);
  }
};

// 初始化目录（异步处理）
(async () => {
  try {
    await Promise.all([
      ensureDirExists(uploadDir),
      ensureDirExists(thumbDir),
      ensureDirExists(voiceDir)
    ]);
  } catch (error) {
    console.error(`[目录初始化错误] ${error.message}`);
    process.exit(1); // 目录创建失败时退出服务
  }
})();

// 提供静态文件访问
app.use('/uploads', express.static(uploadDir));

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

// 语音文件上传配置（使用配置文件中的大小限制）
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
    console.log(`[文件过滤] 拒绝上传blocked类型文件: ${ext}`);
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
  
  cb(null, true); // 大小限制由multer的limits处理
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
  limits: { fileSize: fileTypesConfig.maxVoiceSize } // 使用配置文件中的值
});

// 辅助函数：安全的输入验证（对加密内容不转义）
const sanitizeInput = (input, isEncrypted = false) => {
  if (typeof input !== 'string') return '';
  if (isEncrypted) return input; // 加密内容不进行转义处理
  
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

// 处理图片压缩（移除自定义元数据，避免sharp错误）
const processImage = async (filePath, fileName) => {
  try {
    console.log(`[图片处理] 开始处理图片: ${fileName}`);
    const thumbPath = path.join(thumbDir, fileName);
    
    await sharp(filePath)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .toFile(thumbPath); // 移除自定义元数据，避免兼容性问题
      
    console.log(`[图片处理] 图片处理完成: ${fileName}`);
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/thumbnails/${fileName}`
    };
  } catch (error) {
    console.error(`[图片处理] 图片处理失败: ${error.message}`);
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/${fileName}` // 失败时使用原图
    };
  }
};

// 获取剩余存储空间
const getRemainingStorage = async () => {
  try {
    console.log(`[存储信息] 获取磁盘空间信息`);
    const diskInfo = await si.fsSize();
    const uploadDirDrive = path.parse(uploadDir).root; // 更可靠的获取根目录方式
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
  
  if (stats.progress % 10 === 0) {
    console.log(`[传输统计] ${transferId} 进度: ${stats.progress}%, 速度: ${stats.speedFormatted}`);
  }
  return stats;
}

// 初始化文件过期检查定时器（保存定时器ID，支持关闭）
let expiryCheckerTimer;
function initFileExpiryChecker() {
  expiryCheckerTimer = setInterval(async () => {
    const now = Date.now();
    console.log(`[文件过期检查] 开始检查过期文件, 当前时间: ${new Date(now).toISOString()}`);
    
    try {
      const expiredFiles = await File.findAll({
        where: {
          expiryTime: { [Op.lt]: new Date(now) }
        }
      });
      
      if (expiredFiles.length > 0) {
        console.log(`[文件过期检查] 发现 ${expiredFiles.length} 个过期文件, 开始清理`);
        
        for (const file of expiredFiles) {
          try {
            // 事务处理：确保数据库记录和文件同时删除
            await sequelize.transaction(async (t) => {
              // 从数据库中移除
              await file.destroy({ transaction: t });
              
              // 删除文件（异步检查文件是否存在）
              if (file.url) {
                const filePath = path.join(__dirname, file.url);
                try {
                  await fs.access(filePath);
                  await fs.unlink(filePath);
                  console.log(`[文件清理] 删除文件: ${filePath}`);
                } catch {
                  console.log(`[文件清理] 文件不存在: ${filePath}`);
                }
              }
              
              // 删除缩略图
              if (file.thumbnailUrl) {
                const thumbPath = path.join(__dirname, file.thumbnailUrl);
                try {
                  await fs.access(thumbPath);
                  await fs.unlink(thumbPath);
                  console.log(`[文件清理] 删除缩略图: ${thumbPath}`);
                } catch {
                  console.log(`[文件清理] 缩略图不存在: ${thumbPath}`);
                }
              }
            });
            
            // 通知文件所有者
            if (io) {
              io.to(file.owner).emit('fileExpired', {
                fileId: file.id,
                fileName: file.name
              });
            }
          } catch (error) {
            console.error(`[文件清理] 清理文件 ${file.id} 失败: ${error.message}`);
          }
        }
      }
    } catch (error) {
      console.error(`[文件过期检查] 检查过程出错: ${error.message}`);
    }
  }, 60000); // 每分钟检查一次
}

// 内存存储活跃的上传和下载
const activeUploads = new Map();
const activeDownloads = new Map();

// 创建HTTP服务器（提前创建以便io能被路由访问）
const server = http.createServer(app);

// 配置WebSocket
const io = new Server(server, {
  cors: { 
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// 文件上传处理路由
app.post('/upload', fileUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }
    
    // 验证必要参数
    const { conversationType, conversationId, expiryTime, senderId, senderName } = req.body;
    if (!conversationType || !conversationId || !senderId) {
      return res.status(400).json({ error: '缺少必要的请求参数' });
    }
    
    const fileId = uuidv4();
    let urls = {
      original: `/uploads/${req.file.filename}`,
      thumbnail: `/uploads/${req.file.filename}`
    };
    
    // 如果是图片，处理缩略图
    if (req.file.mimetype.startsWith('image/')) {
      urls = await processImage(
        req.file.path,
        req.file.filename
      );
    }
    
    // 计算过期时间（默认7天，验证时间有效性）
    let expires;
    try {
      expires = expiryTime 
        ? new Date(parseInt(expiryTime)) 
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      if (isNaN(expires.getTime())) {
        throw new Error('无效的过期时间');
      }
    } catch (error) {
      return res.status(400).json({ error: '无效的过期时间参数' });
    }
    
    // 使用事务确保数据一致性
    const result = await sequelize.transaction(async (t) => {
      // 保存文件信息到数据库
      const file = await File.create({
        id: fileId,
        name: req.file.originalname,
        url: urls.original,
        thumbnailUrl: urls.thumbnail,
        size: req.file.size,
        expiryTime: expires,
        owner: senderId,
        type: req.file.mimetype.startsWith('audio/') ? 'voice' : 'file',
        conversationType,
        conversationId
      }, { transaction: t });
      
      // 获取用户信息
      const user = await User.findByPk(senderId, { transaction: t });
      const actualSenderName = user?.username || senderName || '未知用户';
      
      // 创建文件消息
      const message = await Message.create({
        id: uuidv4(),
        sender: senderId,
        senderName: actualSenderName,
        conversationType,
        conversationId,
        content: JSON.stringify({
          fileId,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          fileUrl: urls.original,
          thumbnailUrl: urls.thumbnail
        }),
        type: req.file.mimetype.startsWith('image/') ? 'image' : 'file',
        timestamp: new Date()
      }, { transaction: t });
      
      return { file, message, actualSenderName };
    });
    
    // 发送文件消息
    if (result.message.conversationType === 'room') {
      io.to(result.message.conversationId).emit('newMessage', result.message);
    } else {
      io.to(result.message.conversationId).emit('newMessage', result.message);
      io.to(senderId).emit('newMessage', result.message);
    }
    
    res.json({ 
      success: true, 
      fileId,
      fileName: req.file.originalname 
    });
    
  } catch (error) {
    console.error(`[上传错误] ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// 配置前端静态文件托管（放在所有路由最后）
const clientPath = path.join(__dirname, '../client');
if (fsSync.existsSync(clientPath)) {
  app.use(express.static(clientPath));
  
  // 前端页面路由
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientPath, 'index.html'));
  });
} else {
  console.warn(`[静态文件] 客户端目录不存在: ${clientPath}`);
}

// 创建一个测试房间
async function createTestRoom() {
  try {
    console.log('[测试] 开始创建测试房间');
    const existingRoom = await Room.findOne({ where: { name: '测试房间' } });
    console.log('[测试] 检查是否存在测试房间:', existingRoom ? '存在' : '不存在');
    if (!existingRoom) {
      await Room.create({
        id: 'test-room-1',
        name: '测试房间',
        description: '这是一个测试房间',
        creator: 'system'
      });
      console.log('[测试] 创建了测试房间: test-room-1');
    } else {
      console.log('[测试] 测试房间已存在，ID:', existingRoom.id);
    }
  } catch (error) {
    console.error(`[测试错误] 创建测试房间失败: ${error.message}`);
    console.error('[测试错误] 详细信息:', error);
  }
}

// 启动时创建测试房间
createTestRoom();

// WebSocket连接处理
io.on('connection', async (socket) => {
  console.log(`[连接] 新客户端连接: ${socket.id}`);
  
  // 登录处理
  socket.on('login', async (username) => {
    try {
      username = sanitizeInput(username);
      if (!username || username.length < 2 || username.length > 20) {
        return socket.emit('loginError', '用户名长度必须为2-20个字符');
      }
      
      // 检查用户名是否已存在（所有用户）
      const existingUser = await User.findOne({ 
        where: { username } 
      });
      
      if (existingUser && existingUser.online) {
        return socket.emit('loginError', '用户名已被使用');
      }
      
      // 如果用户名已存在但用户离线，可以复用该用户名
      if (existingUser) {
        // 删除与该用户相关的房间成员记录
        await RoomMember.destroy({ where: { userId: existingUser.id } });
        // 删除离线用户记录
        await existingUser.destroy();
      }
      
      // 更新或创建用户
      let user = await User.findByPk(socket.id);
      if (user) {
        user.username = username;
        user.online = true;
        await user.save();
      } else {
        user = await User.create({
          id: socket.id,
          username,
          online: true
        });
      }
      
      console.log(`[登录] 用户登录: ${username} (${socket.id})`);
      
      // 确保默认房间存在
      const defaultRoom = 'default';
      const [room] = await Room.findOrCreate({
        where: { id: defaultRoom },
        defaults: {
          name: '公共聊天室',
          creator: socket.id
        }
      });
      
      // 将用户加入默认房间
      await RoomMember.findOrCreate({
        where: { roomId: defaultRoom, userId: socket.id }
      });
      
      socket.join(defaultRoom);
      
      // 发送用户列表
      const users = await User.findAll({ 
        where: { online: true },
        attributes: ['id', 'username', 'publicKey']
      });
      io.emit('userList', users);
      
      // 发送房间列表
      const rooms = await Room.findAll();
      socket.emit('roomList', rooms);
      
      // 发送好友列表
      try {
        const [friends] = await sequelize.query(
          'SELECT u.id, u.username, u.publicKey, f.status FROM friends f JOIN users u ON f.friendId = u.id WHERE f.userId = ? AND f.status = ?',
          {
            replacements: [socket.id, 'accepted'],
            type: sequelize.QueryTypes.SELECT
          }
        );
        socket.emit('friendList', friends);
      } catch (error) {
        console.error('查询好友列表错误:', error);
        socket.emit('friendList', []);
      }
      
      // 发送好友请求
      try {
        const friendRequests = await Friend.findAll({
          where: {
            friendId: socket.id,
            status: 'pending'
          },
          include: [{
            model: User,
            as: 'user',
            attributes: ['id', 'username']
          }]
        });
        socket.emit('friendRequests', friendRequests);
      } catch (error) {
        console.error('查询好友请求错误:', error);
        socket.emit('friendRequests', []);
      }

      // 发送剩余存储空间信息
      try {
        const storageInfo = await getRemainingStorage();
        socket.emit('storageInfo', storageInfo);
      } catch (error) {
        console.error('获取剩余空间信息错误:', error);
      }

      // 发送系统消息
      io.to(defaultRoom).emit('systemMessage', {
        text: `${username} 加入了聊天室`,
        roomId: defaultRoom,
        time: new Date()
      });
      
    } catch (error) {
      console.error(`[登录错误] ${error.message}`);
      socket.emit('loginError', '登录失败，请重试');
    }
  });
  
  // 处理公钥
  socket.on('publicKey', async (publicKey) => {
    try {
      if (typeof publicKey !== 'string' || publicKey.length === 0) {
        return console.warn(`[密钥错误] 无效的公钥格式`);
      }
      
      const user = await User.findByPk(socket.id);
      if (user) {
        user.publicKey = publicKey;
        await user.save();
        console.log(`[密钥] 更新了用户 ${user.username} 的公钥`);
      }
    } catch (error) {
      console.error(`[密钥错误] ${error.message}`);
    }
  });
  
  // 发送消息
  socket.on('sendMessage', async (data) => {
    try {
      // 验证消息数据
      if (!data || !data.conversationId || (typeof data.content !== 'string')) {
        return console.warn(`[消息错误] 无效的消息格式: ${JSON.stringify(data)}`);
      }
      
      const user = await User.findByPk(socket.id);
      if (!user) return;
      
      const message = {
        id: uuidv4(),
        sender: socket.id,
        senderName: user.username,
        conversationType: data.conversationType || 'room',
        conversationId: data.conversationId,
        content: sanitizeInput(data.content, data.encrypted), // 加密消息不转义
        encrypted: data.encrypted || false,
        timestamp: new Date()
      };
      
      // 保存消息到数据库
      await Message.create(message);
      
      // 发送消息到目标会话
      if (message.conversationType === 'room') {
        io.to(message.conversationId).emit('newMessage', message);
      } else {
        // 私聊发送给双方
        socket.to(message.conversationId).emit('newMessage', message);
        socket.emit('newMessage', message);
      }
      
    } catch (error) {
      console.error(`[消息错误] ${error.message}`);
    }
  });
  
  // 加入房间
  socket.on('joinRoom', async (data) => {
    try {
      console.log(`[房间调试] 收到joinRoom请求，数据类型: ${typeof data}, 原始数据:`, data);
      // 尝试获取roomId
      const roomId = typeof data === 'object' ? data.roomId : data;
      console.log(`[房间调试] 提取的roomId类型: ${typeof roomId}, 值:`, roomId);
      // 确保roomId是字符串
      if (typeof roomId !== 'string') {
        console.error(`[房间错误] roomId类型无效: ${typeof roomId}`);
        return socket.emit('roomError', '房间ID无效');
      }
      // 验证房间是否存在
      const room = await Room.findByPk(roomId);
      if (!room) {
        return socket.emit('roomError', '房间不存在');
      }

      // 检查用户是否已加入该房间
      const existingMember = await RoomMember.findOne({
        where: { roomId, userId: socket.id }
      });

      if (existingMember) {
        return socket.emit('roomError', '你已加入该房间');
      }

      // 添加用户到房间成员
      await RoomMember.create({
        roomId,
        userId: socket.id
      });

      // 加入房间
      socket.join(roomId);

      // 获取房间成员
      const members = await RoomMember.findAll({
        where: { roomId },
        include: [{ model: User, attributes: ['id', 'username'] }]
      });

      // 获取当前用户信息
      const currentUser = await User.findByPk(socket.id);
      const username = currentUser ? currentUser.username : '未知用户';

      // 通知所有房间成员
      io.to(roomId).emit('userJoinedRoom', {
        roomId,
        user: { id: socket.id, username }
      });

      socket.emit('roomJoined', room);
    } catch (error) {
      console.error(`[加入房间错误] ${error.message}`);
      socket.emit('roomError', '加入房间失败');
    }
  });

  // 创建房间
  socket.on('createRoom', async (roomName) => {
    try {
      roomName = sanitizeInput(roomName);
      if (!roomName || roomName.length < 2 || roomName.length > 50) {
        return socket.emit('roomError', '房间名称长度必须为2-50个字符');
      }
      
      const roomId = uuidv4();
      const room = await Room.create({
        id: roomId,
        name: roomName,
        creator: socket.id
      });
      
      // 添加创建者为成员
      await RoomMember.create({
        roomId,
        userId: socket.id
      });
      
      socket.join(roomId);
      socket.emit('roomCreated', room);
      
      // 广播房间列表更新
      const rooms = await Room.findAll();
      io.emit('roomList', rooms);
      
    } catch (error) {
      console.error(`[房间错误] ${error.message}`);
      socket.emit('roomError', '创建房间失败');
    }
  });
  
  // 断开连接处理
  socket.on('disconnect', async () => {
    console.log(`[断开连接] 客户端断开: ${socket.id}`);
    
    try {
      const user = await User.findByPk(socket.id);
      if (user) {
        user.online = false;
        await user.save();
        
        // 广播用户列表更新
        const users = await User.findAll({ 
          where: { online: true },
          attributes: ['id', 'username', 'publicKey']
        });
        io.emit('userList', users);
        
        // 发送系统消息
        io.emit('systemMessage', {
          text: `${user.username} 离开了聊天室`,
          time: new Date()
        });
      }
    } catch (error) {
      console.error(`[断开连接错误] ${error.message}`);
    }
  });
});

// 初始化过期检查
initFileExpiryChecker();

// 添加测试端点
app.get('/test-join-room', async (req, res) => {
  try {
    const roomId = req.query.roomId || 'test-room-1';
    const username = 'test-user-' + Math.random().toString(36).substr(2, 5);
    console.log(`[测试端点] 收到房间加入请求，roomId: ${roomId}, 用户名: ${username}`);

    // 验证房间是否存在
    const room = await Room.findByPk(roomId);
    if (!room) {
      return res.status(404).json({ success: false, error: '房间不存在' });
    }

    // 创建测试用户（如果不存在）
    let user = await User.findOne({ where: { username } });
    if (!user) {
      user = await User.create({
        id: 'test-user-' + Math.random().toString(36).substr(2, 9),
        username,
        password: 'test-password', // 实际应用中应该加密
        online: true
      });
      console.log(`[测试端点] 创建了测试用户: ${user.id}`);
    }

    const userId = user.id;

    // 检查用户是否已加入该房间
    const existingMember = await RoomMember.findOne({
      where: { roomId, userId }
    });

    if (existingMember) {
      return res.status(400).json({ success: false, error: '用户已加入该房间' });
    }

    // 添加用户到房间成员
    await RoomMember.create({
      roomId,
      userId
    });

    res.json({ success: true, message: '加入房间成功' });
  } catch (error) {
    console.error(`[测试端点错误] ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
});

// 处理进程退出，清理资源
process.on('SIGINT', async () => {
  console.log('\n[服务器] 开始关闭...');
  clearInterval(expiryCheckerTimer); // 清除定时器

  try {
    // 尝试关闭数据库连接
    if (sequelize && sequelize.connectionManager && sequelize.connectionManager.pool) {
      await sequelize.close();
      console.log('[数据库] 已关闭');
    }
  } catch (dbError) {
    console.error(`[关闭数据库错误] ${dbError.message}`);
  }

  try {
    // 尝试关闭服务器
    if (server) {
      server.close(() => {
        console.log('[服务器] 已完全关闭');
        process.exit(0);
      });
    } else {
      console.log('[服务器] 未初始化，直接退出');
      process.exit(0);
    }
  } catch (error) {
    console.error(`[关闭服务器错误] ${error.message}`);
    process.exit(1);
  }
});