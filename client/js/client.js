document.addEventListener('DOMContentLoaded', () => {
  // DOM元素
  const loginScreen = document.getElementById('loginScreen');
  const usernameInput = document.getElementById('usernameInput');
  const loginButton = document.getElementById('loginButton');
  const userInfo = document.getElementById('userInfo');
  const messagesContainer = document.getElementById('messages');
  const messageInput = document.getElementById('messageInput');
  const sendButton = document.getElementById('sendButton');
  const fileInput = document.getElementById('fileInput');
  const userListElement = document.getElementById('userList');
  const roomListElement = document.getElementById('roomList');
  const friendListElement = document.getElementById('friendList');
  const openSidebarButton = document.getElementById('openSidebar');
  const closeSidebarButton = document.getElementById('closeSidebar');
  const sidebar = document.querySelector('.sidebar');
  const encryptToggle = document.getElementById('encryptToggle');
  const encryptionStatusIndicator = document.getElementById('encryptionStatusIndicator');
  const encryptionStatusText = document.getElementById('encryptionStatusText');
  const filePreview = document.getElementById('filePreview');
  const previewImage = document.getElementById('previewImage');
  const previewFileName = document.getElementById('previewFileName');
  const previewFileSize = document.getElementById('previewFileSize');
  const cancelUpload = document.getElementById('cancelUpload');
  const confirmUpload = document.getElementById('confirmUpload');
  const sendOriginalCheckbox = document.getElementById('sendOriginalCheckbox');
  const imageViewerModal = document.getElementById('imageViewerModal');
  const modalImage = document.getElementById('modalImage');
  const closeModal = document.getElementById('closeModal');
  const downloadImage = document.getElementById('downloadImage');
  const imageOptions = document.getElementById('imageOptions');
  const createRoomButton = document.getElementById('createRoomButton');
  const roomNameInput = document.getElementById('roomNameInput');
  const joinRoomButton = document.getElementById('joinRoomButton');
  const storageInfoElement = document.getElementById('storageInfo');
  const uploadsContainer = document.getElementById('uploadsContainer');
  const downloadsContainer = document.getElementById('downloadsContainer');
  const friendRequestsButton = document.getElementById('friendRequestsButton');
  const friendRequestsContainer = document.getElementById('friendRequestsContainer');
  const chatHeader = document.getElementById('chatHeader');
  const tabUsers = document.getElementById('tabUsers');
  const tabRooms = document.getElementById('tabRooms');
  const tabFriends = document.getElementById('tabFriends');
  const contentUsers = document.getElementById('contentUsers');
  const contentRooms = document.getElementById('contentRooms');
  const contentFriends = document.getElementById('contentFriends');

  // 全局变量
  let socket;
  let username = '';
  let userId = '';
  let isEncryptionEnabled = false;
  let currentChat = { type: 'room', id: 'default', name: '公共聊天室' }; // 默认为公共聊天室
  let rsa = null;
  let publicKey = '';
  let privateKey = '';
  let userPublicKeys = new Map();
  let pendingFile = null;
  let currentImageUrl = null;
  let activeUploads = new Map(); // uploadId -> {xhr, abort}
  let activeDownloads = new Map(); // downloadId -> {xhr, abort}

  // 初始化加密模块
  function initEncryption() {
    rsa = new JSEncrypt({ default_key_size: 2048 });
    privateKey = rsa.getPrivateKey();
    publicKey = rsa.getPublicKey();
    console.log('已生成加密密钥对');
  }

  // 初始化Markdown支持
  function initMarkdown() {
    marked.setOptions({
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          return hljs.highlight(code, { language: lang }).value;
        }
        return hljs.highlightAuto(code).value;
      },
      breaks: true,
      gfm: true
    });
  }

  // 初始化
  function init() {
    initEncryption();
    initMarkdown();

    // 事件监听
    loginButton.addEventListener('click', handleLogin);
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    fileInput.addEventListener('change', handleFileSelection);
    cancelUpload.addEventListener('click', cancelFileUpload);
    confirmUpload.addEventListener('click', confirmFileUpload);
    
    openSidebarButton.addEventListener('click', () => {
      sidebar.classList.add('open');
    });
    
    closeSidebarButton.addEventListener('click', () => {
      sidebar.classList.remove('open');
    });

    encryptToggle.addEventListener('click', toggleEncryption);

    closeModal.addEventListener('click', () => {
      imageViewerModal.style.display = 'none';
    });
    
    downloadImage.addEventListener('click', downloadCurrentImage);
    
    imageViewerModal.addEventListener('click', (e) => {
      if (e.target === imageViewerModal) {
        imageViewerModal.style.display = 'none';
      }
    });

    createRoomButton.addEventListener('click', createRoom);
    roomNameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') createRoom();
    });

    friendRequestsButton.addEventListener('click', toggleFriendRequests);

    // 标签切换
    tabUsers.addEventListener('click', () => {
      setActiveTab('users');
    });
    
    tabRooms.addEventListener('click', () => {
      setActiveTab('rooms');
    });
    
    tabFriends.addEventListener('click', () => {
      setActiveTab('friends');
    });

    // 自动调整文本框高度
    messageInput.addEventListener('input', adjustTextareaHeight);
    adjustTextareaHeight();

    // 初始显示用户标签
    setActiveTab('users');
  }

  // 设置活动标签
  function setActiveTab(tabName) {
    // 移除所有标签的活动状态
    tabUsers.classList.remove('active');
    tabRooms.classList.remove('active');
    tabFriends.classList.remove('active');
    
    // 隐藏所有内容
    contentUsers.style.display = 'none';
    contentRooms.style.display = 'none';
    contentFriends.style.display = 'none';
    
    // 激活选中的标签和内容
    if (tabName === 'users') {
      tabUsers.classList.add('active');
      contentUsers.style.display = 'block';
    } else if (tabName === 'rooms') {
      tabRooms.classList.add('active');
      contentRooms.style.display = 'block';
    } else if (tabName === 'friends') {
      tabFriends.classList.add('active');
      contentFriends.style.display = 'block';
    }
  }

  // 处理登录
  function handleLogin() {
    const inputValue = usernameInput.value.trim();
    if (!inputValue) return;

    username = inputValue;
    userInfo.textContent = username;
    
    connectWebSocket();
    
    loginScreen.style.opacity = '0';
    setTimeout(() => {
      loginScreen.style.display = 'none';
    }, 300);
  }

  // 连接WebSocket
  function connectWebSocket() {
    socket = io();
    userId = socket.id;

    socket.on('connect', () => {
      userId = socket.id;
      socket.emit('login', username);
      socket.emit('publicKey', publicKey);
      addSystemMessage('已连接到服务器');
    });

    socket.on('userList', updateUserList);
    socket.on('roomList', updateRoomList);
    socket.on('friendList', updateFriendList);
    socket.on('friendRequests', updateFriendRequests);
    socket.on('newFriendRequest', (request) => {
      updateFriendRequests();
      addSystemMessage(`收到来自 ${request.fromName} 的好友请求`);
    });

    socket.on('newMessage', handleNewMessage);
    socket.on('systemMessage', (msg) => {
      // 只显示当前房间的系统消息
      if (!msg.roomId || msg.roomId === currentChat.id) {
        addSystemMessage(msg.text, msg.time);
      }
    });

    socket.on('publicKeyResponse', (data) => {
      if (data.error) {
        addSystemMessage(`无法获取${data.user}的公钥: ${data.error}`);
        return;
      }
      
      if (data.publicKey) {
        userPublicKeys.set(data.user, data.publicKey);
        addSystemMessage(`已获取${data.user}的公钥，现在可以发送加密消息`);
        updateEncryptionStatus();
      }
    });

    socket.on('disconnect', () => {
      addSystemMessage('与服务器断开连接，正在尝试重连...');
    });

    socket.on('loginError', (error) => {
      addSystemMessage(`登录失败: ${error}`);
      loginScreen.style.display = 'flex';
      loginScreen.style.opacity = '1';
    });

    socket.on('roomCreated', (room) => {
      addSystemMessage(`房间创建成功: ${room.name}`);
      switchToChat('room', room.id, room.name);
    });

    socket.on('roomError', (error) => {
      addSystemMessage(`房间操作失败: ${error}`);
    });

    socket.on('requestSent', (data) => {
      addSystemMessage(`已发送${data.type === 'room' ? '房间' : '好友'}请求至 ${data.target}`);
    });

    socket.on('roomJoinRequest', (request) => {
      showRoomJoinRequest(request);
    });

    socket.on('roomRequestResponse', (data) => {
      if (data.accepted) {
        addSystemMessage(`已加入房间: ${data.roomName}`);
        switchToChat('room', data.roomId, data.roomName);
      } else {
        addSystemMessage(`加入房间 ${data.roomName} 的请求被拒绝`);
      }
    });

    socket.on('friendError', (error) => {
      addSystemMessage(`好友操作失败: ${error}`);
    });

    socket.on('friendRequestResponse', (data) => {
      if (data.accepted) {
        addSystemMessage(`${data.targetName} 接受了你的好友请求`);
      } else {
        addSystemMessage(`${data.targetName} 拒绝了你的好友请求`);
      }
    });

    socket.on('storageInfo', (info) => {
      updateStorageInfo(info);
    });

    // 文件上传相关事件
    socket.on('uploadInitialized', (data) => {
      startFileUpload(data);
    });

    socket.on('uploadProgress', (data) => {
      updateUploadProgress(data);
    });

    socket.on('uploadComplete', (data) => {
      completeUpload(data);
    });

    socket.on('uploadError', (data) => {
      handleUploadError(data);
    });

    // 文件下载相关事件
    socket.on('downloadInitialized', (data) => {
      startFileDownload(data);
    });

    socket.on('downloadProgress', (data) => {
      updateDownloadProgress(data);
    });

    socket.on('downloadError', (data) => {
      handleDownloadError(data);
    });
  }

  // 更新用户列表
  function updateUserList(users) {
    userListElement.innerHTML = '';
    
    users.forEach(user => {
      if (user.id === userId) return;
      
      const userItem = document.createElement('div');
      userItem.className = 'user-item';
      userItem.dataset.userId = user.id;
      
      const initial = user.name.charAt(0).toUpperCase();
      
      userItem.innerHTML = `
        <div class="user-avatar ${user.hasPublicKey ? 'has-key' : ''}">${initial}</div>
        <div class="user-name">${escapeHtml(user.name)}</div>
        <button class="add-friend-btn" data-userid="${user.id}">
          <i class="fas fa-user-plus"></i>
        </button>
      `;
      
      userItem.addEventListener('click', () => {
        switchToChat('private', user.id, user.name);
        sidebar.classList.remove('open');
      });
      
      userListElement.appendChild(userItem);
    });

    // 添加好友按钮事件
    document.querySelectorAll('.add-friend-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const userId = btn.dataset.userid;
        socket.emit('sendFriendRequest', userId);
      });
    });
  }

  // 更新房间列表
  function updateRoomList(rooms) {
    roomListElement.innerHTML = '';
    
    rooms.forEach(room => {
      const roomItem = document.createElement('div');
      roomItem.className = `room-item ${currentChat.type === 'room' && currentChat.id === room.id ? 'active' : ''}`;
      roomItem.dataset.roomId = room.id;
      
      roomItem.innerHTML = `
        <div class="room-icon">
          <i class="fas fa-users"></i>
        </div>
        <div class="room-info">
          <div class="room-name">${escapeHtml(room.name)}</div>
          <div class="room-members">${room.memberCount} 成员</div>
        </div>
        ${room.isCreator ? '<span class="room-creator">创建者</span>' : ''}
        <button class="join-room-btn" data-roomid="${room.id}">
          ${room.isCreator ? '进入' : '加入'}
        </button>
      `;
      
      roomListElement.appendChild(roomItem);
    });

    // 加入房间按钮事件
    document.querySelectorAll('.join-room-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const roomId = btn.dataset.roomid;
        const room = rooms.find(r => r.id === roomId);
        
        if (room.isCreator) {
          // 是创建者，直接进入
          switchToChat('room', roomId, room.name);
          sidebar.classList.remove('open');
        } else {
          // 不是创建者，发送加入请求
          socket.emit('requestJoinRoom', roomId);
        }
      });
    });
  }

  // 更新好友列表
  function updateFriendList(friends) {
    friendListElement.innerHTML = '';
    
    if (friends.length === 0) {
      friendListElement.innerHTML = '<div class="empty-state">暂无好友，请添加好友</div>';
      return;
    }
    
    friends.forEach(friend => {
      const friendItem = document.createElement('div');
      friendItem.className = `friend-item ${currentChat.type === 'private' && currentChat.id === friend.id ? 'active' : ''}`;
      friendItem.dataset.friendId = friend.id;
      
      const initial = friend.name.charAt(0).toUpperCase();
      
      friendItem.innerHTML = `
        <div class="user-avatar">${initial}</div>
        <div class="user-name">${escapeHtml(friend.name)}</div>
      `;
      
      friendItem.addEventListener('click', () => {
        switchToChat('private', friend.id, friend.name);
        sidebar.classList.remove('open');
      });
      
      friendListElement.appendChild(friendItem);
    });
  }

  // 更新好友请求
  function updateFriendRequests() {
    // 实际应用中应该从服务器获取最新请求
    // 这里只是简单清空并等待服务器推送
    friendRequestsContainer.innerHTML = '';
    friendRequestsContainer.classList.remove('open');
  }

  // 显示房间加入请求
  function showRoomJoinRequest(request) {
    const requestElement = document.createElement('div');
    requestElement.className = 'request-notification';
    requestElement.dataset.requestId = request.requestId;
    
    requestElement.innerHTML = `
      <div class="request-info">
        <div class="request-text">${escapeHtml(request.fromName)} 想要加入房间 ${escapeHtml(request.roomName)}</div>
        <div class="request-time">${request.time}</div>
      </div>
      <div class="request-actions">
        <button class="accept-request" data-requestid="${request.requestId}" data-roomid="${request.roomId}">
          <i class="fas fa-check"></i> 同意
        </button>
        <button class="reject-request" data-requestid="${request.requestId}" data-roomid="${request.roomId}">
          <i class="fas fa-times"></i> 拒绝
        </button>
      </div>
    `;
    
    document.body.appendChild(requestElement);
    
    // 添加按钮事件
    requestElement.querySelector('.accept-request').addEventListener('click', (e) => {
      const requestId = e.target.closest('.accept-request').dataset.requestid;
      const roomId = e.target.closest('.accept-request').dataset.roomid;
      socket.emit('respondRoomRequest', { requestId, roomId, accepted: true });
      document.body.removeChild(requestElement);
    });
    
    requestElement.querySelector('.reject-request').addEventListener('click', (e) => {
      const requestId = e.target.closest('.reject-request').dataset.requestid;
      const roomId = e.target.closest('.reject-request').dataset.roomid;
      socket.emit('respondRoomRequest', { requestId, roomId, accepted: false });
      document.body.removeChild(requestElement);
    });
    
    // 5分钟后自动移除
    setTimeout(() => {
      if (document.body.contains(requestElement)) {
        document.body.removeChild(requestElement);
      }
    }, 300000);
  }

  // 切换聊天对象（房间或私聊）
  function switchToChat(type, id, name) {
    currentChat = { type, id, name };
    chatHeader.textContent = name;
    messagesContainer.innerHTML = '';
    addSystemMessage(`正在与 ${name} 聊天`);
    
    // 更新UI选中状态
    document.querySelectorAll('.room-item, .friend-item').forEach(item => {
      item.classList.remove('active');
    });
    
    if (type === 'room') {
      document.querySelector(`.room-item[data-room-id="${id}"]`)?.classList.add('active');
    } else {
      document.querySelector(`.friend-item[data-friend-id="${id}"]`)?.classList.add('active');
    }
    
    updateEncryptionStatus();
  }

  // 创建房间
  function createRoom() {
    const roomName = roomNameInput.value.trim();
    if (!roomName) return;
    
    socket.emit('createRoom', roomName);
    roomNameInput.value = '';
  }

  // 切换好友请求面板
  function toggleFriendRequests() {
    friendRequestsContainer.classList.toggle('open');
  }

  // 处理新消息
  function handleNewMessage(message) {
    // 只显示当前聊天的消息
    if (message.roomId && message.roomId !== currentChat.id) return;
    if (message.targetUserId && message.targetUserId !== currentChat.id && message.userId !== currentChat.id) return;
    
    // 解密逻辑
    let decryptedText = message.text;
    let isEncrypted = message.isEncrypted || false;
    
    if (isEncrypted) {
      try {
        if (message.user === username) {
          decryptedText = message.plainText || message.text;
        } else {
          decryptedText = rsa.decrypt(message.text) || '无法解密此消息';
        }
      } catch (e) {
        console.error('解密失败:', e);
        decryptedText = '解密失败: 无法读取此消息';
      }
    }
    
    addMessage({
      ...message,
      text: decryptedText,
      isEncrypted: isEncrypted
    });
  }

  // 添加消息到界面
  function addMessage(message) {
    const isOwnMessage = message.user === username;
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isOwnMessage ? 'own' : 'other'} ${message.isEncrypted ? 'encrypted' : ''}`;
    
    let messageContent = '';
    
    if (message.type === 'file') {
      // 文件消息
      let fileContent = '';
      
      if (message.isImage) {
        const viewImageHandler = `openImageViewer('${message.originalUrl || message.fileUrl}', '${escapeHtml(message.fileName)}')`;
        
        fileContent = `
          <div class="image-message" onclick="${viewImageHandler}">
            <img src="${message.thumbnailUrl || message.fileUrl}" alt="${escapeHtml(message.fileName)}" class="image-preview">
          </div>
        `;
      } else {
        fileContent = `
          <div class="file-message">
            <div class="file-icon">
              <i class="fas fa-file"></i>
            </div>
            <div class="file-info">
              <div class="file-name">${escapeHtml(message.fileName)}</div>
              <div class="file-size">${formatFileSize(message.fileSize)}</div>
              <button class="download-file-btn" data-url="${message.fileUrl}" data-name="${escapeHtml(message.fileName)}">
                <i class="fas fa-download"></i> 下载
              </button>
            </div>
          </div>
        `;
      }
      
      messageContent = `
        <div class="sender">${escapeHtml(message.user)} ${message.isEncrypted ? '<span class="encrypted-indicator">🔒 加密</span>' : ''}</div>
        ${fileContent}
        <div class="time">${message.time}</div>
      `;
    } else {
      // 文本消息 - 使用Markdown渲染
      const htmlContent = marked.parse(message.text);
      
      messageContent = `
        <div class="sender">${escapeHtml(message.user)} ${message.isEncrypted ? '<span class="encrypted-indicator">🔒 加密</span>' : ''}</div>
        <div class="content">${htmlContent}</div>
        <div class="time">${message.time}</div>
      `;
    }
    
    messageElement.innerHTML = messageContent;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    
    // 添加文件下载事件
    if (message.type === 'file' && !message.isImage) {
      const downloadBtn = messageElement.querySelector('.download-file-btn');
      if (downloadBtn) {
        downloadBtn.addEventListener('click', (e) => {
          const url = e.target.closest('.download-file-btn').dataset.url;
          const name = e.target.closest('.download-file-btn').dataset.name;
          initDownload(url, name);
        });
      }
    }
  }

  // 添加系统消息
  function addSystemMessage(text, time = new Date().toLocaleTimeString()) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message system';
    messageElement.innerHTML = `
      <div class="content">${escapeHtml(text)}</div>
      <div class="time">${time}</div>
    `;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
  }

  // 发送消息
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket) return;
    
    let message = {
      text: text,
      isEncrypted: false
    };
    
    // 设置消息目标
    if (currentChat.type === 'room') {
      message.roomId = currentChat.id;
    } else {
      message.targetUserId = currentChat.id;
    }
    
    // 加密处理
    if (isEncryptionEnabled) {
      try {
        // 查找接收者公钥
        let recipientPublicKey = null;
        if (currentChat.type === 'room') {
          // 房间消息不加密，或需要特殊处理
          addSystemMessage('房间消息暂不支持加密，请使用私聊');
          return;
        } else {
          // 私聊消息
          const user = Array.from(userPublicKeys.entries())
            .find(([id, key]) => id === currentChat.id);
            
          if (user) {
            recipientPublicKey = user[1];
          }
        }
        
        if (recipientPublicKey) {
          const encrypt = new JSEncrypt();
          encrypt.setPublicKey(recipientPublicKey);
          const encryptedText = encrypt.encrypt(text);
          
          if (encryptedText) {
            message = {
              ...message,
              text: encryptedText,
              plainText: text,
              isEncrypted: true
            };
          } else {
            throw new Error('加密失败');
          }
        } else {
          throw new Error('未找到接收者的公钥');
        }
      } catch (e) {
        console.error('消息加密失败:', e);
        addSystemMessage('消息加密失败: ' + e.message);
        isEncryptionEnabled = false;
        updateEncryptionStatus();
        return;
      }
    }

    socket.emit('chatMessage', message);
    messageInput.value = '';
    adjustTextareaHeight();
  }

  // 处理文件选择
  function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    pendingFile = file;
    
    previewFileName.textContent = file.name;
    previewFileSize.textContent = formatFileSize(file.size);
    
    imageOptions.style.display = file.type.startsWith('image/') ? 'flex' : 'none';
    
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = function(e) {
        previewImage.src = e.target.result;
        previewImage.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      previewImage.src = '';
      previewImage.style.display = 'none';
    }
    
    filePreview.style.display = 'flex';
  }

  // 取消文件上传
  function cancelFileUpload() {
    filePreview.style.display = 'none';
    fileInput.value = '';
    pendingFile = null;
  }

  // 确认文件上传
  function confirmFileUpload() {
    if (!pendingFile || !socket) return;

    // 初始化上传
    const target = currentChat.type === 'room' 
      ? { roomId: currentChat.id } 
      : { userId: currentChat.id };
      
    socket.emit('initFileUpload', {
      name: pendingFile.name,
      size: pendingFile.size,
      target: target,
      isEncrypted: isEncryptionEnabled
    });
  }

  // 开始文件上传
  function startFileUpload(data) {
    if (!pendingFile) return;
    
    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('uploadId', data.uploadId);
    formData.append('sendOriginal', sendOriginalCheckbox.checked);
    
    // 创建上传进度元素
    const uploadElement = document.createElement('div');
    uploadElement.className = 'transfer-item';
    uploadElement.dataset.uploadId = data.uploadId;
    uploadElement.innerHTML = `
      <div class="transfer-info">
        <div class="transfer-name">${escapeHtml(data.fileName)}</div>
        <div class="transfer-stats">
          <span class="transfer-progress">0%</span>
          <span class="transfer-speed">-- MB/s</span>
          <span class="transfer-remaining">剩余: --</span>
        </div>
      </div>
      <div class="transfer-progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <button class="cancel-transfer" data-uploadid="${data.uploadId}">
        <i class="fas fa-times"></i>
      </button>
    `;
    uploadsContainer.appendChild(uploadElement);
    
    // 创建取消按钮事件
    uploadElement.querySelector('.cancel-transfer').addEventListener('click', (e) => {
      const uploadId = e.target.closest('.cancel-transfer').dataset.uploadid;
      cancelUploadTransfer(uploadId);
    });
    
    // 创建XHR上传
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    
    // 跟踪上传进度
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const uploaded = e.loaded;
        socket.emit('updateUploadProgress', {
          uploadId: data.uploadId,
          uploaded: uploaded
        });
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // 上传完成，通知服务器
        socket.emit('completeFileUpload', {
          uploadId: data.uploadId,
          sendOriginal: sendOriginalCheckbox.checked,
          isEncrypted: isEncryptionEnabled
        });
      } else {
        socket.emit('uploadError', {
          uploadId: data.uploadId,
          error: '上传失败: ' + xhr.statusText
        });
      }
    });
    
    xhr.addEventListener('error', () => {
      socket.emit('uploadError', {
        uploadId: data.uploadId,
        error: '网络错误，上传失败'
      });
    });
    
    // 保存上传信息
    activeUploads.set(data.uploadId, {
      xhr: xhr,
      element: uploadElement,
      fileName: data.fileName
    });
    
    // 开始上传
    xhr.send(formData);
    
    // 清理预览
    filePreview.style.display = 'none';
    fileInput.value = '';
  }

  // 更新上传进度
  function updateUploadProgress(data) {
    const upload = activeUploads.get(data.uploadId);
    if (!upload) return;
    
    const progressBar = upload.element.querySelector('.progress-fill');
    const progressText = upload.element.querySelector('.transfer-progress');
    const speedText = upload.element.querySelector('.transfer-speed');
    const remainingText = upload.element.querySelector('.transfer-remaining');
    
    if (progressBar) progressBar.style.width = `${data.progress}%`;
    if (progressText) progressText.textContent = `${data.progress}% (${formatFileSize(data.uploaded)}/${formatFileSize(data.total)})`;
    if (speedText) speedText.textContent = data.speedFormatted;
    if (remainingText) remainingText.textContent = `剩余: ${data.timeRemainingFormatted}`;
  }

  // 完成上传
  function completeUpload(data) {
    const upload = activeUploads.get(data.uploadId);
    if (!upload) return;
    
    // 更新进度为100%
    upload.element.querySelector('.progress-fill').style.width = '100%';
    upload.element.querySelector('.transfer-progress').textContent = '100% 上传完成';
    upload.element.querySelector('.cancel-transfer').style.display = 'none';
    
    // 3秒后移除上传进度条
    setTimeout(() => {
      if (uploadsContainer.contains(upload.element)) {
        uploadsContainer.removeChild(upload.element);
      }
      activeUploads.delete(data.uploadId);
    }, 3000);
  }

  // 处理上传错误
  function handleUploadError(data) {
    const upload = activeUploads.get(data.uploadId);
    if (!upload) return;
    
    upload.element.classList.add('error');
    upload.element.querySelector('.transfer-progress').textContent = `错误: ${data.error}`;
    upload.element.querySelector('.progress-fill').style.backgroundColor = '#ef4444';
    
    // 5秒后移除
    setTimeout(() => {
      if (uploadsContainer.contains(upload.element)) {
        uploadsContainer.removeChild(upload.element);
      }
      activeUploads.delete(data.uploadId);
    }, 5000);
  }

  // 取消上传
  function cancelUploadTransfer(uploadId) {
    const upload = activeUploads.get(uploadId);
    if (!upload) return;
    
    // 中止XHR请求
    upload.xhr.abort();
    
    // 移除元素
    if (uploadsContainer.contains(upload.element)) {
      uploadsContainer.removeChild(upload.element);
    }
    
    activeUploads.delete(uploadId);
    addSystemMessage(`已取消上传: ${upload.fileName}`);
  }

  // 初始化文件下载
  function initDownload(fileUrl, fileName) {
    if (!socket) return;
    
    socket.emit('initFileDownload', {
      fileUrl: fileUrl,
      fileName: fileName
    });
  }

  // 开始文件下载
  function startFileDownload(data) {
    // 创建下载进度元素
    const downloadElement = document.createElement('div');
    downloadElement.className = 'transfer-item';
    downloadElement.dataset.downloadId = data.downloadId;
    downloadElement.innerHTML = `
      <div class="transfer-info">
        <div class="transfer-name">${escapeHtml(data.fileName)}</div>
        <div class="transfer-stats">
          <span class="transfer-progress">0%</span>
          <span class="transfer-speed">-- MB/s</span>
          <span class="transfer-remaining">剩余: --</span>
        </div>
      </div>
      <div class="transfer-progress-bar">
        <div class="progress-fill" style="width: 0%"></div>
      </div>
      <button class="cancel-transfer" data-downloadid="${data.downloadId}">
        <i class="fas fa-times"></i>
      </button>
    `;
    downloadsContainer.appendChild(downloadElement);
    
    // 创建取消按钮事件
    downloadElement.querySelector('.cancel-transfer').addEventListener('click', (e) => {
      const downloadId = e.target.closest('.cancel-transfer').dataset.downloadid;
      cancelDownloadTransfer(downloadId);
    });
    
    // 创建XHR下载
    const xhr = new XMLHttpRequest();
    xhr.open('GET', data.fileUrl, true);
    xhr.responseType = 'blob';
    
    // 跟踪下载进度
    xhr.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const downloaded = e.loaded;
        socket.emit('updateDownloadProgress', {
          downloadId: data.downloadId,
          downloaded: downloaded
        });
      }
    });
    
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        // 下载完成，创建下载链接
        const blob = new Blob([xhr.response]);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // 更新进度为100%
        downloadElement.querySelector('.progress-fill').style.width = '100%';
        downloadElement.querySelector('.transfer-progress').textContent = '100% 下载完成';
        downloadElement.querySelector('.cancel-transfer').style.display = 'none';
        
        // 3秒后移除
        setTimeout(() => {
          if (downloadsContainer.contains(downloadElement)) {
            downloadsContainer.removeChild(downloadElement);
          }
          activeDownloads.delete(data.downloadId);
        }, 3000);
      } else {
        socket.emit('downloadError', {
          downloadId: data.downloadId,
          error: '下载失败: ' + xhr.statusText
        });
      }
    });
    
    xhr.addEventListener('error', () => {
      socket.emit('downloadError', {
        downloadId: data.downloadId,
        error: '网络错误，下载失败'
      });
    });
    
    // 保存下载信息
    activeDownloads.set(data.downloadId, {
      xhr: xhr,
      element: downloadElement,
      fileName: data.fileName
    });
    
    // 开始下载
    xhr.send();
  }

  // 更新下载进度
  function updateDownloadProgress(data) {
    const download = activeDownloads.get(data.downloadId);
    if (!download) return;
    
    const progressBar = download.element.querySelector('.progress-fill');
    const progressText = download.element.querySelector('.transfer-progress');
    const speedText = download.element.querySelector('.transfer-speed');
    const remainingText = download.element.querySelector('.transfer-remaining');
    
    if (progressBar) progressBar.style.width = `${data.progress}%`;
    if (progressText) progressText.textContent = `${data.progress}% (${formatFileSize(data.uploaded)}/${formatFileSize(data.total)})`;
    if (speedText) speedText.textContent = data.speedFormatted;
    if (remainingText) remainingText.textContent = `剩余: ${data.timeRemainingFormatted}`;
  }

  // 处理下载错误
  function handleDownloadError(data) {
    const download = activeDownloads.get(data.downloadId);
    if (!download) return;
    
    download.element.classList.add('error');
    download.element.querySelector('.transfer-progress').textContent = `错误: ${data.error}`;
    download.element.querySelector('.progress-fill').style.backgroundColor = '#ef4444';
    
    // 5秒后移除
    setTimeout(() => {
      if (downloadsContainer.contains(download.element)) {
        downloadsContainer.removeChild(download.element);
      }
      activeDownloads.delete(data.downloadId);
    }, 5000);
  }

  // 取消下载
  function cancelDownloadTransfer(downloadId) {
    const download = activeDownloads.get(downloadId);
    if (!download) return;
    
    // 中止XHR请求
    download.xhr.abort();
    
    // 移除元素
    if (downloadsContainer.contains(download.element)) {
      downloadsContainer.removeChild(download.element);
    }
    
    activeDownloads.delete(downloadId);
    addSystemMessage(`已取消下载: ${download.fileName}`);
  }

  // 打开图片查看器
  function openImageViewer(url, altText) {
    currentImageUrl = url;
    modalImage.src = url;
    modalImage.alt = altText;
    imageViewerModal.style.display = 'flex';
  }

  // 下载当前图片
  function downloadCurrentImage() {
    if (!currentImageUrl) return;
    
    initDownload(currentImageUrl, currentImageUrl.split('/').pop().split('-').slice(2).join('-') || 'image');
    imageViewerModal.style.display = 'none';
  }

  // 切换加密状态
  function toggleEncryption() {
    isEncryptionEnabled = !isEncryptionEnabled;
    encryptToggle.classList.toggle('active', isEncryptionEnabled);
    updateEncryptionStatus();
    
    if (isEncryptionEnabled && currentChat.type === 'room') {
      addSystemMessage('房间消息暂不支持加密，请使用私聊');
      isEncryptionEnabled = false;
      encryptToggle.classList.remove('active');
      updateEncryptionStatus();
    }
  }

  // 更新加密状态显示
  function updateEncryptionStatus() {
    if (isEncryptionEnabled && currentChat.type === 'private') {
      encryptionStatusIndicator.className = 'status-indicator status-encrypted';
      encryptionStatusText.textContent = `端到端加密: 已启用 (与 ${currentChat.name} 通信)`;
    } else {
      encryptionStatusIndicator.className = 'status-indicator status-not-encrypted';
      encryptionStatusText.textContent = currentChat.type === 'room' 
        ? '端到端加密: 房间消息不支持加密'
        : '端到端加密: 未启用';
    }
  }

  // 更新存储空间信息
  function updateStorageInfo(info) {
    if (!storageInfoElement) return;
    
    storageInfoElement.innerHTML = `
      <div class="storage-label">服务器存储空间</div>
      <div class="storage-bar">
        <div class="storage-used" style="width: ${info.usedPercentage}%"></div>
      </div>
      <div class="storage-stats">
        <span>已使用: ${formatFileSize(info.total - info.free)}</span>
        <span>剩余: ${info.freeFormatted}</span>
        <span>总计: ${info.totalFormatted}</span>
      </div>
    `;
  }

  // 辅助函数：滚动到底部
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 辅助函数：调整文本框高度
  function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    const scrollHeight = messageInput.scrollHeight;
    messageInput.style.height = `${Math.min(scrollHeight, 120)}px`;
  }

  // 辅助函数：格式化文件大小
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // 辅助函数：转义HTML防止XSS攻击
  function escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return '';
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // 暴露给全局
  window.openImageViewer = openImageViewer;

  // 初始化应用
  init();
});
