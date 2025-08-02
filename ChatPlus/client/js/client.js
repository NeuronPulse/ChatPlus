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
  let currentChat = { type: 'room', id: 'default', name: '公共聊天室' };
  let rsa = null;
  let publicKey = '';
  let privateKey = '';
  let userPublicKeys = new Map();
  let pendingFile = null;
  let currentImageUrl = null;
  let activeUploads = new Map();
  let activeDownloads = new Map();

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
    tabUsers.classList.remove('active');
    tabRooms.classList.remove('active');
    tabFriends.classList.remove('active');
    
    contentUsers.style.display = 'none';
    contentRooms.style.display = 'none';
    contentFriends.style.display = 'none';
    
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
    socket = io('http://localhost:3000');
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
      if (!msg.roomId || msg.roomId === currentChat.id) {
        addSystemMessage(msg.text, msg.time);
      }
    });

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
  }

  // 发送消息
  function sendMessage() {
    const content = messageInput.value.trim();
    if (!content || !socket) return;

    let messageContent = content;
    
    // 如果启用加密且是私聊
    if (isEncryptionEnabled && currentChat.type === 'private') {
      const targetPublicKey = userPublicKeys.get(currentChat.id);
      if (targetPublicKey) {
        rsa.setPublicKey(targetPublicKey);
        messageContent = rsa.encrypt(content);
        
        if (!messageContent) {
          addSystemMessage('加密失败，请确保已获取对方公钥');
          return;
        }
      } else {
        addSystemMessage('无法加密消息，未找到对方公钥');
        return;
      }
    }

    const message = {
      content: messageContent,
      conversationType: currentChat.type,
      conversationId: currentChat.id,
      encrypted: isEncryptionEnabled && currentChat.type === 'private'
    };

    socket.emit('sendMessage', message);
    messageInput.value = '';
    adjustTextareaHeight();
  }

  // 处理新消息
  function handleNewMessage(message) {
    // 只显示当前聊天的消息
    if (message.conversationType === currentChat.type && 
        message.conversationId === currentChat.id) {
      
      let content = message.content;
      
      // 如果是加密消息且是发给自己的
      if (message.encrypted && message.conversationType === 'private' &&
          (message.sender === userId || message.conversationId === userId)) {
        try {
          rsa.setPrivateKey(privateKey);
          const decrypted = rsa.decrypt(content);
          content = decrypted || `[无法解密的消息: ${content}]`;
        } catch (e) {
          content = `[解密失败: ${content}]`;
        }
      }

      addMessage(
        message.sender === userId,
        message.senderName,
        content,
        new Date(message.timestamp),
        message.encrypted
      );
    }
  }

  // 添加消息到界面
  function addMessage(isOwn, sender, content, time, isEncrypted = false) {
    const messageElement = document.createElement('div');
    messageElement.className = `message ${isOwn ? 'own' : 'other'} ${isEncrypted ? 'encrypted' : ''} message-appear`;
    
    const formattedTime = time.toLocaleTimeString();
    const renderedContent = marked.parse(content);
    
    messageElement.innerHTML = `
      <div class="sender">
        ${sender}
        ${isEncrypted ? '<span class="encrypted-badge">🔒 加密</span>' : ''}
      </div>
      <div class="content">${renderedContent}</div>
      <div class="time">${formattedTime}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 添加系统消息
  function addSystemMessage(text, time = new Date()) {
    const messageElement = document.createElement('div');
    messageElement.className = 'message system message-appear';
    
    const formattedTime = time.toLocaleTimeString();
    
    messageElement.innerHTML = `
      <div class="content">${text}</div>
      <div class="time">${formattedTime}</div>
    `;
    
    messagesContainer.appendChild(messageElement);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 更新用户列表
  function updateUserList(users) {
    userListElement.innerHTML = '';
    
    users.forEach(user => {
      if (user.id === userId) return;
      
      const userElement = document.createElement('div');
      userElement.className = 'user-item';
      userElement.innerHTML = `
        <div class="user-avatar ${user.publicKey ? 'has-key' : ''}">
          ${user.username.charAt(0).toUpperCase()}
        </div>
        <div class="user-info">
          <div class="user-name">${user.username}</div>
          <div class="user-status">${user.publicKey ? '可加密聊天' : '等待公钥'}</div>
        </div>
        <button class="start-chat" data-userid="${user.id}" data-username="${user.username}">
          <i class="fa fa-comment"></i>
        </button>
      `;
      
      userListElement.appendChild(userElement);
      
      // 添加聊天按钮事件
      userElement.querySelector('.start-chat').addEventListener('click', (e) => {
        const userId = e.currentTarget.dataset.userid;
        const userName = e.currentTarget.dataset.username;
        switchToChat('private', userId, userName);
        
        // 如果没有对方公钥，请求获取
        if (!userPublicKeys.has(userId) && user.publicKey) {
          userPublicKeys.set(userId, user.publicKey);
          updateEncryptionStatus();
        } else if (!user.publicKey) {
          socket.emit('requestPublicKey', userId);
        }
      });
    });
  }

  // 切换聊天
  function switchToChat(type, id, name) {
    currentChat = { type, id, name };
    chatHeader.textContent = name;
    messagesContainer.innerHTML = '';
    
    // 请求历史消息
    socket.emit('getHistory', {
      conversationType: type,
      conversationId: id
    });
    
    // 如果是私聊，更新加密状态
    updateEncryptionStatus();
  }

  // 更新加密状态
  function updateEncryptionStatus() {
    if (currentChat.type === 'private') {
      const hasPublicKey = userPublicKeys.has(currentChat.id);
      encryptToggle.disabled = !hasPublicKey;
      
      if (!hasPublicKey) {
        isEncryptionEnabled = false;
        encryptionStatusText.textContent = '等待对方公钥';
        encryptionStatusIndicator.className = 'status-indicator status-not-encrypted';
      } else {
        encryptionStatusText.textContent = isEncryptionEnabled ? '已加密' : '未加密';
        encryptionStatusIndicator.className = `status-indicator ${isEncryptionEnabled ? 'status-encrypted' : 'status-not-encrypted'}`;
      }
    } else {
      // 群聊不支持加密
      isEncryptionEnabled = false;
      encryptToggle.disabled = true;
      encryptionStatusText.textContent = '群聊不支持加密';
      encryptionStatusIndicator.className = 'status-indicator status-not-encrypted';
    }
    
    encryptToggle.classList.toggle('active', isEncryptionEnabled);
  }

  // 切换加密状态
  function toggleEncryption() {
    if (currentChat.type !== 'private') return;
    
    isEncryptionEnabled = !isEncryptionEnabled;
    updateEncryptionStatus();
  }

  // 处理文件选择
  function handleFileSelection(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    pendingFile = file;
    previewFileName.textContent = file.name;
    previewFileSize.textContent = formatFileSize(file.size);
    
    // 显示图片预览
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        previewImage.src = event.target.result;
        previewImage.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      previewImage.style.display = 'none';
      previewImage.src = '';
    }
    
    filePreview.classList.remove('hidden');
    fileInput.value = ''; // 允许重复选择同一文件
  }

  // 取消文件上传
  function cancelFileUpload() {
    pendingFile = null;
    filePreview.classList.add('hidden');
    previewImage.src = '';
    previewFileName.textContent = '';
    previewFileSize.textContent = '';
  }

  // 确认文件上传
  function confirmFileUpload() {
    if (!pendingFile || !socket) return;
    
    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('senderId', userId);
    formData.append('senderName', username);
    formData.append('conversationType', currentChat.type);
    formData.append('conversationId', currentChat.id);
    
    // 添加过期时间（示例：7天）
    const expiryTime = Date.now() + 7 * 24 * 60 * 60 * 1000;
    formData.append('expiryTime', expiryTime);
    
    const uploadId = uuidv4();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload', true);
    
    // 上传进度
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        updateUploadProgress(uploadId, progress);
      }
    });
    
    xhr.onload = () => {
      if (xhr.status === 200) {
        addSystemMessage(`文件 "${pendingFile.name}" 上传成功`);
      } else {
        const error = JSON.parse(xhr.responseText).error || '上传失败';
        addSystemMessage(`文件上传失败: ${error}`);
      }
      removeUploadProgress(uploadId);
      cancelFileUpload();
    };
    
    xhr.onerror = () => {
      addSystemMessage('文件上传失败，请重试');
      removeUploadProgress(uploadId);
      cancelFileUpload();
    };
    
    // 添加到活跃上传列表
    addUploadProgress(uploadId, pendingFile.name);
    xhr.send(formData);
    
    activeUploads.set(uploadId, { xhr, abort: () => xhr.abort() });
  }

  // 格式化文件大小
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  // 调整文本框高度
  function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  }

  // 创建房间
  function createRoom() {
    const roomName = roomNameInput.value.trim();
    if (!roomName || !socket) return;
    
    socket.emit('createRoom', roomName);
    roomNameInput.value = '';
  }

  // 更新房间列表
  function updateRoomList(rooms) {
    roomListElement.innerHTML = '';
    
    rooms.forEach(room => {
      const roomElement = document.createElement('div');
      roomElement.className = 'room-item';
      roomElement.innerHTML = `
        <div class="room-info">
          <div class="room-name">${room.name}</div>
          <div class="room-creator">创建者: ${room.creatorName || '未知'}</div>
        </div>
        <button class="join-room" data-roomid="${room.id}" data-roomname="${room.name}">
          加入
        </button>
      `;
      
      roomListElement.appendChild(roomElement);
      
      // 加入房间按钮事件
      roomElement.querySelector('.join-room').addEventListener('click', (e) => {
        const roomId = e.currentTarget.dataset.roomid;
        const roomName = e.currentTarget.dataset.roomname;
        socket.emit('joinRoom', { roomId, roomName });
      });
    });
  }

  // 其他辅助函数...
  function updateUploadProgress(uploadId, progress) {
    const element = document.getElementById(`upload-${uploadId}`);
    if (element) {
      element.querySelector('.progress-bar').style.width = `${progress}%`;
      element.querySelector('.progress-text').textContent = `${progress}%`;
    }
  }

  function addUploadProgress(uploadId, fileName) {
    const uploadElement = document.createElement('div');
    uploadElement.id = `upload-${uploadId}`;
    uploadElement.className = 'upload-item';
    uploadElement.innerHTML = `
      <div class="upload-info">
        <div class="upload-filename">${fileName}</div>
        <div class="progress-container">
          <div class="progress-bar" style="width: 0%"></div>
          <div class="progress-text">0%</div>
        </div>
      </div>
      <button class="cancel-upload" data-uploadid="${uploadId}">
        <i class="fa fa-times"></i>
      </button>
    `;
    
    uploadsContainer.appendChild(uploadElement);
    
    // 取消上传按钮事件
    uploadElement.querySelector('.cancel-upload').addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.uploadid;
      const upload = activeUploads.get(id);
      if (upload) upload.abort();
      removeUploadProgress(id);
    });
  }

  function removeUploadProgress(uploadId) {
    const element = document.getElementById(`upload-${uploadId}`);
    if (element) element.remove();
    activeUploads.delete(uploadId);
  }

  function toggleFriendRequests() {
    friendRequestsContainer.classList.toggle('hidden');
  }

  function updateFriendRequests(requests) {
    friendRequestsContainer.innerHTML = '';
    
    if (requests.length === 0) {
      friendRequestsContainer.innerHTML = '<div class="no-requests">暂无好友请求</div>';
      return;
    }
    
    requests.forEach(request => {
      const requestElement = document.createElement('div');
      requestElement.className = 'friend-request';
      requestElement.innerHTML = `
        <div class="request-info">
          <div class="request-sender">${request.User.username}</div>
          <div class="request-time">${new Date(request.createdAt).toLocaleString()}</div>
        </div>
        <div class="request-actions">
          <button class="accept-request" data-requestid="${request.id}">接受</button>
          <button class="decline-request" data-requestid="${request.id}">拒绝</button>
        </div>
      `;
      
      friendRequestsContainer.appendChild(requestElement);
      
      // 接受/拒绝按钮事件
      requestElement.querySelector('.accept-request').addEventListener('click', (e) => {
        socket.emit('respondFriendRequest', {
          requestId: e.currentTarget.dataset.requestid,
          accept: true
        });
      });
      
      requestElement.querySelector('.decline-request').addEventListener('click', (e) => {
        socket.emit('respondFriendRequest', {
          requestId: e.currentTarget.dataset.requestid,
          accept: false
        });
      });
    });
  }

  function updateFriendList(friends) {
    friendListElement.innerHTML = '';
    
    if (friends.length === 0) {
      friendListElement.innerHTML = '<div class="no-friends">暂无好友</div>';
      return;
    }
    
    friends.forEach(friend => {
      const friendElement = document.createElement('div');
      friendElement.className = 'friend-item';
      friendElement.innerHTML = `
        <div class="friend-avatar">
          ${friend.friendUsername.charAt(0).toUpperCase()}
        </div>
        <div class="friend-name">${friend.friendUsername}</div>
        <button class="chat-with-friend" data-userid="${friend.friendId}" data-username="${friend.friendUsername}">
          <i class="fa fa-comment"></i>
        </button>
      `;
      
      friendListElement.appendChild(friendElement);
      
      // 聊天按钮事件
      friendElement.querySelector('.chat-with-friend').addEventListener('click', (e) => {
        const userId = e.currentTarget.dataset.userid;
        const userName = e.currentTarget.dataset.username;
        switchToChat('private', userId, userName);
      });
    });
  }

  function showRoomJoinRequest(request) {
    const confirmJoin = confirm(`用户 ${request.userName} 希望加入房间 ${request.roomName}，是否允许？`);
    socket.emit('respondRoomRequest', {
      requestId: request.id,
      accepted: confirmJoin
    });
  }

  function downloadCurrentImage() {
    if (!currentImageUrl) return;
    
    const a = document.createElement('a');
    a.href = currentImageUrl;
    a.download = `image-${Date.now()}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // 初始化应用
  init();
});