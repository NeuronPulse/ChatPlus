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

    // 新增：文件过期通知处理
    socket.on('fileExpired', (data) => {
      addSystemMessage(`您的文件 "${data.fileName}" (ID: ${data.fileId}) 已过期并被系统清理`);
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

    // 完善：存储空间信息展示
    socket.on('storageInfo', (info) => {
      updateStorageInfo(info);
    });

    socket.on('storageError', (error) => {
      storageInfoElement.textContent = `存储信息获取失败: ${error.message}`;
      storageInfoElement.classList.add('error');
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
        <div class="user-name">${escape escapeHtml(user.name)}</div>
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
              <div class="file-size">${message.fileSize}</div>
            </div>
            <button class="download-file" onclick="downloadFile('${message.fileUrl}', '${escapeHtml(message.fileName)}')">
              <i class="fas fa-download"></i>
            </button>
          </div>
        `;
      }
      
      messageContent = `
        <div class="message-header">
          <span class="message-sender">${escapeHtml(message.user)}</span>
          <span class="message-time">${message.time}</span>
          ${message.isEncrypted ? '<span class="encrypted-indicator"><i class="fas fa-lock"></i></span>' : ''}
        </div>
        <div class="message-content">${fileContent}</div>
      `;
    } else {
      // 文本消息
      messageContent = `
        <div class="message-header">
          <span class="message-sender">${escapeHtml(message.user)}</span>
          <span class="message-time">${message.time}</span>
          ${message.isEncrypted ? '<span class="encrypted-indicator"><i class="fas fa-lock"></i></span>' : ''}
        </div>
        <div class="message-content">${marked.parse(escapeHtml(message.text))}</div>
      `;
    }
    
    messageElement.innerHTML = messageContent;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 添加系统消息
  function addSystemMessage(text, time = new Date().toLocaleTimeString()) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message system';
    messageElement.innerHTML = `
      <div class="message-content">
        <span class="system-text">${escapeHtml(text)}</span>
        <span class="message-time">${time}</span>
      </div>
    `;
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 发送消息
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text) return;
    
    let encryptedText = text;
    let isEncrypted = isEncryptionEnabled;
    
    // 加密逻辑
    if (isEncrypted) {
      try {
        let targetPublicKey;
        
        if (currentChat.type === 'room') {
          // 房间消息使用自己的公钥加密（演示用，实际房间加密需特殊处理）
          targetPublicKey = publicKey;
        } else {
          // 私聊使用对方的公钥
          targetPublicKey = userPublicKeys.get(currentChat.id);
        }
        
        if (!targetPublicKey) {
          addSystemMessage('无法发送加密消息：未获取到目标公钥');
          isEncrypted = false;
        } else {
          rsa.setPublicKey(targetPublicKey);
          encryptedText = rsa.encrypt(text);
          if (!encryptedText) {
            addSystemMessage('加密失败，将发送明文消息');
            isEncrypted = false;
          }
        }
      } catch (e) {
        console.error('加密失败:', e);
        addSystemMessage('加密失败，将发送明文消息');
        isEncrypted = false;
      }
    }
    
    // 构建消息对象
    const message = {
      text: isEncrypted ? encryptedText : text,
      plainText: isEncrypted ? text : undefined,
      user: username,
      userId: userId,
      time: new Date().toLocaleTimeString(),
      isEncrypted: isEncrypted
    };
    
    // 根据聊天类型添加不同参数
    if (currentChat.type === 'room') {
      message.roomId = currentChat.id;
    } else {
      message.targetUserId = currentChat.id;
    }
    
    // 发送消息
    socket.emit('sendMessage', message);
    // 本地直接显示消息
    handleNewMessage(message);
    
    messageInput.value = '';
    adjustTextareaHeight();
  }

  // 处理文件选择
  function handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    pendingFile = file;
    previewFileName.textContent = file.name;
    previewFileSize.textContent = formatFileSize(file.size);
    
    // 显示预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        previewImage.src = event.target.result;
        previewImage.style.display = 'block';
        sendOriginalCheckbox.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      previewImage.src = '';
      previewImage.style.display = 'none';
      sendOriginalCheckbox.style.display = 'none';
    }
    
    filePreview.classList.add('visible');
    fileInput.value = ''; // 允许重复选择同一文件
  }

  // 取消文件上传
  function cancelFileUpload() {
    pendingFile = null;
    filePreview.classList.remove('visible');
    previewImage.src = '';
    previewFileName.textContent = '';
    previewFileSize.textContent = '';
  }

  // 确认文件上传
  function confirmFileUpload() {
    if (!pendingFile) return;
    
    // 检查文件大小限制（客户端预检查）
    const maxSize = 50 * 1024 * 1024; // 50MB，应与服务端配置一致
    if (pendingFile.size > maxSize) {
      addSystemMessage(`文件过大，最大支持${formatFileSize(maxSize)}`);
      cancelFileUpload();
      return;
    }
    
    // 初始化上传
    socket.emit('initUpload', {
      fileName: pendingFile.name,
      fileSize: pendingFile.size,
      fileType: pendingFile.type,
      conversationType: currentChat.type,
      conversationId: currentChat.id,
      sendOriginal: sendOriginalCheckbox.checked && pendingFile.type.startsWith('image/')
    });
    
    filePreview.classList.remove('visible');
  }

  // 开始文件上传
  function startFileUpload(data) {
    if (!pendingFile || data.error) {
      addSystemMessage(`上传失败: ${data.error || '未知错误'}`);
      pendingFile = null;
      return;
    }
    
    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('uploadId', data.uploadId);
    formData.append('conversationType', currentChat.type);
    formData.append('conversationId', currentChat.id);
    formData.append('sendOriginal', sendOriginalCheckbox.checked);
    
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    
    // 上传进度处理
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        socket.emit('uploadProgress', {
          uploadId: data.uploadId,
          loaded: e.loaded,
          total: e.total
        });
      }
    });
    
    // 上传完成处理
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        try {
          const result = JSON.parse(xhr.responseText);
          if (result.success) {
            socket.emit('uploadFinalize', { uploadId: data.uploadId });
          } else {
            socket.emit('uploadError', { uploadId: data.uploadId, error: result.error });
          }
        } catch (e) {
          socket.emit('uploadError', { uploadId: data.uploadId, error: '上传响应解析失败' });
        }
      } else {
        socket.emit('uploadError', { uploadId: data.uploadId, error: `HTTP错误: ${xhr.status}` });
      }
    });
    
    // 上传错误处理
    xhr.addEventListener('error', () => {
      socket.emit('uploadError', { uploadId: data.uploadId, error: '网络错误' });
    });
    
    // 记录活跃上传
    activeUploads.set(data.uploadId, {
      xhr,
      abort: () => xhr.abort()
    });
    
    // 创建上传进度UI
    const uploadElement = document.createElement('div');
    uploadElement.className = 'transfer-item';
    uploadElement.id = `upload-${data.uploadId}`;
    uploadElement.innerHTML = `
      <div class="transfer-info">
        <div class="transfer-name">${escapeHtml(pendingFile.name)}</div>
        <div class="transfer-progress-text">0%</div>
      </div>
      <div class="transfer-progress">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
      <div class="transfer-stats">
        <span class="transfer-speed">0 KB/s</span>
        <span class="transfer-remaining">剩余: 计算中</span>
        <button class="cancel-transfer" data-uploadid="${data.uploadId}">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    uploadsContainer.appendChild(uploadElement);
    
    // 取消上传按钮事件
    uploadElement.querySelector('.cancel-transfer').addEventListener('click', (e) => {
      const uploadId = e.target.closest('.cancel-transfer').dataset.uploadid;
      const upload = activeUploads.get(uploadId);
      if (upload) {
        upload.abort();
        activeUploads.delete(uploadId);
        document.getElementById(`upload-${uploadId}`).remove();
        addSystemMessage('上传已取消');
      }
    });
    
    // 发送文件
    xhr.send(formData);
    pendingFile = null;
    sendOriginalCheckbox.checked = false;
  }

  // 更新上传进度
  function updateUploadProgress(data) {
    const uploadElement = document.getElementById(`upload-${data.uploadId}`);
    if (!uploadElement) return;
    
    const progressBar = uploadElement.querySelector('.progress-bar');
    const progressText = uploadElement.querySelector('.transfer-progress-text');
    const speedText = uploadElement.querySelector('.transfer-speed');
    const remainingText = uploadElement.querySelector('.transfer-remaining');
    
    progressBar.style.width = `${data.progress}%`;
    progressText.textContent = `${data.progress}%`;
    speedText.textContent = data.speedFormatted;
    remainingText.textContent = `剩余: ${data.timeRemainingFormatted}`;
  }

  // 完成上传
  function completeUpload(data) {
    const uploadElement = document.getElementById(`upload-${data.uploadId}`);
    if (uploadElement) {
      uploadElement.classList.add('completed');
      uploadElement.querySelector('.transfer-progress-text').textContent = '100%';
      uploadElement.querySelector('.progress-bar').style.width = '100%';
      uploadElement.querySelector('.transfer-stats').innerHTML = '<span class="transfer-complete">上传完成</span>';
      
      // 3秒后移除上传进度条
      setTimeout(() => {
        uploadElement.remove();
      }, 3000);
    }
    
    activeUploads.delete(data.uploadId);
    
    // 显示文件消息
    if (data.file) {
      addMessage({
        ...data.file,
        user: username,
        isOwnMessage: true
      });
    }
  }

  // 处理上传错误
  function handleUploadError(data) {
    const uploadElement = document.getElementById(`upload-${data.uploadId}`);
    if (uploadElement) {
      uploadElement.classList.add('error');
      uploadElement.querySelector('.transfer-progress-text').textContent = '上传失败';
      uploadElement.querySelector('.transfer-stats').innerHTML = `<span class="transfer-error">${data.error}</span>`;
      
      // 5秒后移除上传进度条
      setTimeout(() => {
        uploadElement.remove();
      }, 5000);
    }
    
    activeUploads.delete(data.uploadId);
    addSystemMessage(`文件上传失败: ${data.error}`);
  }

  // 开始文件下载
  function startFileDownload(data) {
    if (data.error) {
      addSystemMessage(`下载失败: ${data.error}`);
      return;
    }
    
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `/download/${data.fileId}`, true);
    xhr.responseType = 'blob';
    
    // 下载进度处理
    xhr.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        socket.emit('downloadProgress', {
          downloadId: data.downloadId,
          loaded: e.loaded,
          total: e.total
        });
      }
    });
    
    // 下载完成处理
    xhr.addEventListener('load', () => {
      if (xhr.status === 200) {
        // 创建下载链接
        const blob = new Blob([xhr.response], { type: data.fileType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
        
        socket.emit('downloadComplete', { downloadId: data.downloadId });
        addSystemMessage(`文件 "${data.fileName}" 下载完成`);
      } else {
        socket.emit('downloadError', { 
          downloadId: data.downloadId, 
          error: `HTTP错误: ${xhr.status}` 
        });
      }
    });
    
    // 下载错误处理
    xhr.addEventListener('error', () => {
      socket.emit('downloadError', { 
        downloadId: data.downloadId, 
        error: '网络错误' 
      });
    });
    
    // 记录活跃下载
    activeDownloads.set(data.downloadId, {
      xhr,
      abort: () => xhr.abort()
    });
    
    // 创建下载进度UI
    const downloadElement = document.createElement('div');
    downloadElement.className = 'transfer-item';
    downloadElement.id = `download-${data.downloadId}`;
    downloadElement.innerHTML = `
      <div class="transfer-info">
        <div class="transfer-name">${escapeHtml(data.fileName)}</div>
        <div class="transfer-progress-text">0%</div>
      </div>
      <div class="transfer-progress">
        <div class="progress-bar" style="width: 0%"></div>
      </div>
      <div class="transfer-stats">
        <span class="transfer-speed">0 KB/s</span>
        <span class="transfer-remaining">剩余: 计算中</span>
        <button class="cancel-transfer" data-downloadid="${data.downloadId}">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
    downloadsContainer.appendChild(downloadElement);
    
    // 取消下载按钮事件
    downloadElement.querySelector('.cancel-transfer').addEventListener('click', (e) => {
      const downloadId = e.target.closest('.cancel-transfer').dataset.downloadid;
      const download = activeDownloads.get(downloadId);
      if (download) {
        download.abort();
        activeDownloads.delete(downloadId);
        document.getElementById(`download-${downloadId}`).remove();
        addSystemMessage('下载已取消');
      }
    });
    
    // 开始下载
    xhr.send();
  }

  // 更新下载进度
  function updateDownloadProgress(data) {
    const downloadElement = document.getElementById(`download-${data.downloadId}`);
    if (!downloadElement) return;
    
    const progressBar = downloadElement.querySelector('.progress-bar');
    const progressText = downloadElement.querySelector('.transfer-progress-text');
    const speedText = downloadElement.querySelector('.transfer-speed');
    const remainingText = downloadElement.querySelector('.transfer-remaining');
    
    progressBar.style.width = `${data.progress}%`;
    progressText.textContent = `${data.progress}%`;
    speedText.textContent = data.speedFormatted;
    remainingText.textContent = `剩余: ${data.timeRemainingFormatted}`;
  }

  // 处理下载错误
  function handleDownloadError(data) {
    const downloadElement = document.getElementById(`download-${data.downloadId}`);
    if (downloadElement) {
      downloadElement.classList.add('error');
      downloadElement.querySelector('.transfer-progress-text').textContent = '下载失败';
      downloadElement.querySelector('.transfer-stats').innerHTML = `<span class="transfer-error">${data.error}</span>`;
      
      // 5秒后移除下载进度条
      setTimeout(() => {
        downloadElement.remove();
      }, 5000);
    }
    
    activeDownloads.delete(data.downloadId);
    addSystemMessage(`文件下载失败: ${data.error}`);
  }

  // 打开图片查看器
  function openImageViewer(url, fileName) {
    currentImageUrl = url;
    modalImage.src = url;
    imageViewerModal.style.display = 'flex';
    downloadImage.dataset.filename = fileName;
  }

  // 下载当前查看的图片
  function downloadCurrentImage() {
    if (!currentImageUrl) return;
    
    const fileName = downloadImage.dataset.filename || 'image.jpg';
    fetch(currentImageUrl)
      .then(response => response.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 0);
      })
      .catch(error => {
        console.error('图片下载失败:', error);
        addSystemMessage('图片下载失败');
      });
  }

  // 下载文件
  function downloadFile(url, fileName) {
    socket.emit('initDownload', { fileUrl: url, fileName: fileName });
  }

  // 切换加密状态
  function toggleEncryption() {
    isEncryptionEnabled = !isEncryptionEnabled;
    updateEncryptionStatus();
  }

  // 更新加密状态显示
  function updateEncryptionStatus() {
    if (isEncryptionEnabled) {
      encryptToggle.classList.add('enabled');
      encryptionStatusIndicator.className = 'fas fa-lock';
      encryptionStatusText.textContent = '加密已启用';
      
      // 检查是否可以加密
      let canEncrypt = false;
      if (currentChat.type === 'room') {
        // 房间加密需要特殊处理，这里简化处理
        canEncrypt = true;
      } else {
        canEncrypt = userPublicKeys.has(currentChat.id);
      }
      
      if (!canEncrypt) {
        encryptionStatusText.textContent = '加密已启用，但无法获取目标公钥';
        encryptionStatusIndicator.className = 'fas fa-exclamation-triangle';
      }
    } else {
      encryptToggle.classList.remove('enabled');
      encryptionStatusIndicator.className = 'fas fa-unlock';
      encryptionStatusText.textContent = '加密已禁用';
    }
  }

  // 调整文本框高度
  function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 200) + 'px';
  }

  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }

  // 更新存储信息显示
  function updateStorageInfo(info) {
    storageInfoElement.classList.remove('error');
    storageInfoElement.innerHTML = `
      存储空间: 总容量 ${info.totalFormatted}, 剩余 ${info.freeFormatted} (已使用 ${info.usedPercentage}%)
    `;
    
    // 根据使用情况添加样式
    if (info.usedPercentage > 90) {
      storageInfoElement.classList.add('warning');
    } else {
      storageInfoElement.classList.remove('warning');
    }
  }

  // HTML转义
  function escapeHtml(text) {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // 初始化应用
  init();

  // 暴露全局函数
  window.openImageViewer = openImageViewer;
  window.downloadFile = downloadFile;
});