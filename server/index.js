const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const sharp = require('sharp'); // 用于图片处理

// 创建Express应用
const app = express();
app.use(cors());
const server = http.createServer(app);

// WebSocket配置
const io = socketio(server, {
  cors: { origin: '*' }
});

// 安全配置 - 限制请求大小防止DoS攻击
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// 确保上传目录存在
const uploadDir = path.join(__dirname, 'uploads');
const thumbDir = path.join(uploadDir, 'thumbnails');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(thumbDir)) {
  fs.mkdirSync(thumbDir, { recursive: true });
}

// 文件上传配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // 生成唯一文件名，移除特殊字符
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, '_');
    const uniqueName = `${Date.now()}-${uuidv4()}-${safeName}`;
    cb(null, uniqueName);
  }
});

// 文件过滤 - 限制文件类型和大小
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
  const allowedTypes = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf', 'text/plain'
  ];
  
  // 检查文件类型
  if (!allowedTypes.includes(file.mimetype)) {
    return cb(new Error('不支持的文件类型'), false);
  }
  
  // 检查文件大小 (10MB)
  const fileSize = parseInt(req.headers['content-length'] || '0');
  if (fileSize > 10 * 1024 * 1024) {
    return cb(new Error('文件大小不能超过10MB'), false);
  }
  
  cb(null, true);
};

const upload = multer({ 
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB限制
});

// 存储用户公钥
const userPublicKeys = new Map();

// 在线用户管理
let onlineUsers = {};
let tcpClients = {};

// 安全的输入验证函数
const sanitizeInput = (input) => {
  if (typeof input !== 'string') return '';
  // 移除危险字符和模式
  return validator.escape(
    input.replace(/(?:\r\n|\r|\n)/g, ' ')
         .replace(/<script.*?>.*?<\/script>/gi, '')
         .replace(/<.*?\/?>/gi, '')
  );
};

// 防止正则表达式攻击的安全验证
const safeRegexTest = (pattern, input) => {
  // 限制输入长度防止ReDoS攻击
  if (input.length > 1000) return false;
  
  try {
    // 使用超时限制正则执行时间
    const startTime = Date.now();
    const result = pattern.test(input);
    const executionTime = Date.now() - startTime;
    
    // 如果正则执行时间过长，视为可疑
    if (executionTime > 100) {
      console.warn(`潜在的正则表达式攻击，执行时间: ${executionTime}ms`);
      return false;
    }
    
    return result;
  } catch (e) {
    console.error('正则表达式执行错误:', e);
    return false;
  }
};

// 处理图片压缩和元数据添加
const processImage = async (filePath, fileName, sender) => {
  try {
    // 创建缩略图路径
    const thumbPath = path.join(thumbDir, fileName);
    
    // 压缩图片（宽度最大800px，保持比例）
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
    // 处理失败时返回原图
    return {
      original: `/uploads/${fileName}`,
      thumbnail: `/uploads/${fileName}`
    };
  }
};

// WebSocket事件处理
io.on('connection', (socket) => {
  console.log('新WebSocket连接:', socket.id);

  // 接收用户公钥
  socket.on('publicKey', (key) => {
    if (typeof key === 'string' && key.length > 100) { // 简单验证公钥格式
      const username = onlineUsers[socket.id];
      if (username) {
        userPublicKeys.set(username, key);
        // 广播更新的用户列表（包含谁有公钥）
        io.emit('userList', Object.values(onlineUsers).map(user => ({
          name: user,
          hasPublicKey: userPublicKeys.has(user)
        })));
      }
    }
  });

  // 用户登录
  socket.on('login', (username) => {
    // 验证并清理用户名
    const sanitizedUsername = sanitizeInput(username).substring(0, 50);
    if (!sanitizedUsername) {
      socket.emit('loginError', '无效的用户名');
      return;
    }
    
    onlineUsers[socket.id] = sanitizedUsername;
    io.emit('userList', Object.values(onlineUsers).map(user => ({
      name: user,
      hasPublicKey: userPublicKeys.has(user)
    })));
    io.emit('systemMessage', { 
      text: `${sanitizedUsername} 加入聊天`, 
      time: new Date().toLocaleTimeString() 
    });
  });

  // 发送消息
  socket.on('chatMessage', (msg) => {
    const username = onlineUsers[socket.id];
    if (username && msg) {
      // 验证消息内容
      const safeMsg = {
        ...msg,
        // 只有非加密消息需要验证
        text: msg.isEncrypted ? msg.text : sanitizeInput(msg.text).substring(0, 5000),
        user: username,
        time: new Date().toLocaleTimeString()
      };
      
      io.emit('newMessage', safeMsg);
      
      // 同时向TCP客户端广播
      broadcastToTCP(username, {
        type: 'chat',
        ...safeMsg
      });
    }
  });

  // 请求用户公钥
  socket.on('requestPublicKey', (targetUser) => {
    const requester = onlineUsers[socket.id];
    if (requester && targetUser) {
      const publicKey = userPublicKeys.get(targetUser);
      if (publicKey) {
        // 只发送给请求者
        socket.emit('publicKeyResponse', {
          user: targetUser,
          publicKey: publicKey
        });
      } else {
        socket.emit('publicKeyResponse', {
          user: targetUser,
          error: '用户没有可用的公钥'
        });
      }
    }
  });

  // 断开连接
  socket.on('disconnect', () => {
    const username = onlineUsers[socket.id];
    if (username) {
      delete onlineUsers[socket.id];
      userPublicKeys.delete(username); // 移除公钥
      io.emit('userList', Object.values(onlineUsers).map(user => ({
        name: user,
        hasPublicKey: userPublicKeys.has(user)
      })));
      io.emit('systemMessage', { 
        text: `${username} 离开聊天`, 
        time: new Date().toLocaleTimeString()
      });
    }
  });
});

// TCP服务器 (保留作为备选通信方式)
const tcpServer = net.createServer(socket => {
  let username = '';
  
  socket.on('data', data => {
    const messages = data.toString().split('\n').filter(Boolean);
    messages.forEach(str => {
      try {
        // 限制消息大小防止攻击
        if (str.length > 10000) {
          console.warn('收到过大的TCP消息，可能是攻击');
          return;
        }
        
        const msg = JSON.parse(str);
        if (msg.type === 'login') {
          // 验证用户名
          const sanitizedUsername = sanitizeInput(msg.username).substring(0, 50);
          if (!sanitizedUsername) return;
          
          username = sanitizedUsername;
          tcpClients[username] = socket;
          broadcastToTCP(username, { 
            type: 'system', 
            text: `${username} joined.`,
            time: new Date().toLocaleTimeString()
          });
          // 通知WebSocket客户端
          io.emit('userList', [...Object.values(onlineUsers), ...Object.keys(tcpClients)].map(user => ({
            name: user,
            hasPublicKey: userPublicKeys.has(user)
          })));
        } else if (msg.type === 'chat') {
          const message = {
            ...msg,
            text: sanitizeInput(msg.text).substring(0, 5000),
            user: username,
            time: new Date().toLocaleTimeString()
          };
          broadcastToTCP(username, { type: 'chat', ...message });
          // 同时向WebSocket客户端广播
          io.emit('newMessage', message);
        }
      } catch (e) {
        console.error('TCP消息解析错误:', e);
      }
    });
  });

  socket.on('close', () => {
    if (username) {
      delete tcpClients[username];
      userPublicKeys.delete(username);
      broadcastToTCP(username, { 
        type: 'system', 
        text: `${username} left.`,
        time: new Date().toLocaleTimeString()
      });
      io.emit('userList', [...Object.values(onlineUsers), ...Object.keys(tcpClients)].map(user => ({
        name: user,
        hasPublicKey: userPublicKeys.has(user)
      })));
    }
  });
});

// 向TCP客户端广播消息
function broadcastToTCP(sender, message) {
  Object.entries(tcpClients).forEach(([username, client]) => {
    if (username !== sender && !client.destroyed) {
      try {
        const msgStr = JSON.stringify(message) + '\n';
        // 限制消息大小
        if (msgStr.length > 10000) {
          console.warn('尝试发送过大的TCP消息，已阻止');
          return;
        }
        client.write(msgStr);
      } catch (e) {
        console.error('向TCP客户端发送消息失败:', e);
      }
    }
  });
}

// 文件上传接口 - 支持原图/压缩选项
app.post('/upload', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      console.error('文件上传错误:', err);
      return res.status(400).json({ error: err.message });
    }
    
    if (!req.file) {
      return res.status(400).json({ error: '未上传文件' });
    }
    
    const { sendOriginal } = req.body;
    const isOriginal = sendOriginal === 'true';
    const sender = req.body.sender || 'unknown';
    
    // 检查文件类型是否为图片
    const isImage = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(req.file.mimetype);
    let imageUrls = {
      original: `/uploads/${req.file.filename}`,
      thumbnail: `/uploads/${req.file.filename}`
    };
    
    // 处理图片 - 生成缩略图
    if (isImage) {
      imageUrls = await processImage(
        req.file.path, 
        req.file.filename,
        sender
      );
    }
    
    res.json({ 
      fileUrl: isOriginal ? imageUrls.original : imageUrls.thumbnail,
      originalUrl: isImage ? imageUrls.original : null,
      thumbnailUrl: isImage ? imageUrls.thumbnail : null,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      isImage: isImage,
      mimeType: req.file.mimetype
    });
  });
});

// 静态文件服务
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 客户端文件服务
app.use(express.static(path.join(__dirname, '../client')));

// 启动服务器
const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`主服务器运行在 http://localhost:${PORT}`);
  tcpClients = {}; // 重置TCP客户端列表
  tcpServer.listen(5555, () => {
    console.log('TCP服务器运行在端口 5555');
  });
});

// 处理未捕获的异常
process.on('uncaughtException', (err) => {
  console.error('未捕获的异常:', err);
});

// 处理未捕获的Promise拒绝
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason);
});
