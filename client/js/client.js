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

  // 全局变量
  let socket;
  let username = '';
  let isEncryptionEnabled = false;
  let currentRecipient = null; // 当前消息接收者（用于加密消息）
  let rsa = null; // RSA加密实例
  let publicKey = ''; // 自己的公钥
  let privateKey = ''; // 自己的私钥
  let userPublicKeys = new Map(); // 存储其他用户的公钥
  let pendingFile = null; // 待上传的文件
  let currentImageUrl = null; // 当前查看的图片URL

  // 初始化加密模块
  function initEncryption() {
    rsa = new JSEncrypt({ default_key_size: 2048 });
    
    // 生成密钥对
    privateKey = rsa.getPrivateKey();
    publicKey = rsa.getPublicKey();
    
    console.log('已生成加密密钥对');
  }

  // 初始化Markdown支持
  function initMarkdown() {
    // 配置marked
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
    // 初始化加密
    initEncryption();
    // 初始化Markdown
    initMarkdown();

    // 登录按钮点击事件
    loginButton.addEventListener('click', handleLogin);
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleLogin();
    });

    // 发送消息
    sendButton.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // 文件上传
    fileInput.addEventListener('change', handleFileSelection);
    cancelUpload.addEventListener('click', cancelFileUpload);
    confirmUpload.addEventListener('click', confirmFileUpload);
    
    // 侧边栏控制
    openSidebarButton.addEventListener('click', () => {
      sidebar.classList.add('open');
    });
    
    closeSidebarButton.addEventListener('click', () => {
      sidebar.classList.remove('open');
    });

    // 加密开关
    encryptToggle.addEventListener('click', toggleEncryption);

    // 图片查看器
    closeModal.addEventListener('click', () => {
      imageViewerModal.style.display = 'none';
    });
    
    downloadImage.addEventListener('click', downloadCurrentImage);
    
    // 点击模态框背景关闭
    imageViewerModal.addEventListener('click', (e) => {
      if (e.target === imageViewerModal) {
        imageViewerModal.style.display = 'none';
      }
    });

    // 自动调整文本框高度
    messageInput.addEventListener('input', adjustTextareaHeight);
    adjustTextareaHeight();
  }

  // 处理登录
  function handleLogin() {
    const inputValue = usernameInput.value.trim();
    if (!inputValue) return;

    username = inputValue;
    userInfo.textContent = username;
    
    // 连接WebSocket
    connectWebSocket();
    
    // 隐藏登录界面
    loginScreen.style.opacity = '0';
    setTimeout(() => {
      loginScreen.style.display = 'none';
    }, 300);
  }

  // 连接WebSocket
  function connectWebSocket() {
    socket = io();

    // 登录
    socket.emit('login', username);
    
    // 发送公钥
    socket.emit('publicKey', publicKey);

    // 接收用户列表
    socket.on('userList', updateUserList);

    // 接收新消息
    socket.on('newMessage', handleNewMessage);

    // 接收系统消息
    socket.on('systemMessage', (msg) => {
      addSystemMessage(msg.text, msg.time);
    });

    // 接收公钥响应
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

    // 连接断开
    socket.on('disconnect', () => {
      addSystemMessage('与服务器断开连接，正在尝试重连...');
      // 尝试重连
      setTimeout(connectWebSocket, 3000);
    });

    // 登录错误
    socket.on('loginError', (error) => {
      addSystemMessage(`登录失败: ${error}`);
      loginScreen.style.display = 'flex';
      loginScreen.style.opacity = '1';
    });
  }

  // 更新用户列表
  function updateUserList(users) {
    userListElement.innerHTML = '';
    
    users.forEach(user => {
      if (user.name === username) return; // 跳过自己
      
      const userItem = document.createElement('div');
      userItem.className = `user-item ${currentRecipient === user.name ? 'active' : ''}`;
      userItem.dataset.username = user.name;
      
      // 生成用户头像首字母
      const initial = user.name.charAt(0).toUpperCase();
      
      userItem.innerHTML = `
        <div class="user-avatar ${user.hasPublicKey ? 'has-key' : ''}">${initial}</div>
        <div class="user-name">${escapeHtml(user.name)}</div>
        ${user.hasPublicKey ? '<i class="fas fa-lock" style="color: #10b981; font-size: 0.8rem;"></i>' : ''}
      `;
      
      // 点击用户设置为当前接收者
      userItem.addEventListener('click', () => {
        currentRecipient = user.name;
        
        // 更新UI
        document.querySelectorAll('.user-item').forEach(item => {
          item.classList.remove('active');
        });
        userItem.classList.add('active');
        
        // 如果用户有公钥，自动请求
        if (user.hasPublicKey && !userPublicKeys.has(user.name)) {
          socket.emit('requestPublicKey', user.name);
        }
        
        updateEncryptionStatus();
        sidebar.classList.remove('open');
      });
      
      userListElement.appendChild(userItem);
    });
  }

  // 处理新消息 - 修复加密问题
  function handleNewMessage(message) {
    // 如果是加密消息，尝试解密
    let decryptedText = message.text;
    let isEncrypted = message.isEncrypted || false;
    
    if (isEncrypted) {
      try {
        // 发送者是自己的消息不需要解密（我们保存的是明文）
        if (message.user === username) {
          decryptedText = message.plainText || message.text;
        } else {
          // 使用私钥解密他人发送的消息
          decryptedText = rsa.decrypt(message.text) || '无法解密此消息';
        }
      } catch (e) {
        console.error('解密失败:', e);
        decryptedText = '解密失败: 无法读取此消息';
      }
    }
    
    // 显示消息
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
      
      // 如果是图片，显示预览
      if (message.isImage) {
        // 构建图片查看器点击事件
        const viewImageHandler = `openImageViewer('${message.originalUrl || message.fileUrl}', '${escapeHtml(message.fileName)}')`;
        
        fileContent = `
          <div class="image-message" onclick="${viewImageHandler}">
            <img src="${message.thumbnailUrl || message.fileUrl}" alt="${escapeHtml(message.fileName)}" class="image-preview">
          </div>
        `;
      } else {
        // 其他文件类型
        fileContent = `
          <div class="file-message">
            <div class="file-icon">
              <i class="fas fa-file"></i>
            </div>
            <div class="file-info">
              <div class="file-name">${escapeHtml(message.fileName)}</div>
              <div class="file-size">${formatFileSize(message.fileSize)}</div>
              <a href="${message.fileUrl}" class="file-link" target="_blank" download>下载文件</a>
            </div>
          </div>
        `;
      }
      
      messageContent = `
        <div class="sender">${escapeHtml(message.user)} ${message.isEncrypted ? '<span style="font-size: 0.7rem; color: var(--encrypted-indicator);">🔒 加密</span>' : ''}</div>
        ${fileContent}
        <div class="time">${message.time}</div>
      `;
    } else {
      // 文本消息 - 使用Markdown渲染
      const htmlContent = marked.parse(message.text);
      
      messageContent = `
        <div class="sender">${escapeHtml(message.user)} ${message.isEncrypted ? '<span style="font-size: 0.7rem; color: var(--encrypted-indicator);">🔒 加密</span>' : ''}</div>
        <div class="content">${htmlContent}</div>
        <div class="time">${message.time}</div>
      `;
    }
    
    messageElement.innerHTML = messageContent;
    messagesContainer.appendChild(messageElement);
    scrollToBottom();
    
    // 添加动画延迟，使消息逐条显示
    messageElement.style.animationDelay = `${messagesContainer.children.length * 50}ms`;
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

  // 发送消息 - 修复加密逻辑
  function sendMessage() {
    const text = messageInput.value.trim();
    if (!text || !socket) return;
    
    let message = {
      type: 'chat',
      text: text,
      isEncrypted: false
    };
    
    // 如果启用了加密且有接收者和公钥
    if (isEncryptionEnabled && currentRecipient && userPublicKeys.has(currentRecipient)) {
      try {
        // 使用接收者的公钥加密消息
        const recipientPublicKey = userPublicKeys.get(currentRecipient);
        const encrypt = new JSEncrypt();
        encrypt.setPublicKey(recipientPublicKey);
        const encryptedText = encrypt.encrypt(text);
        
        if (encryptedText) {
          message = {
            ...message,
            text: encryptedText,
            plainText: text, // 保存明文以便自己查看
            isEncrypted: true,
            recipient: currentRecipient
          };
        } else {
          throw new Error('加密失败');
        }
      } catch (e) {
        console.error('消息加密失败:', e);
        addSystemMessage('消息加密失败，请确保已获取接收者的公钥');
        isEncryptionEnabled = false;
        updateEncryptionStatus();
        return;
      }
    } else if (isEncryptionEnabled) {
      // 加密已启用但无法加密
      addSystemMessage('无法发送加密消息，请选择一个有公钥的用户');
      return;
    }

    socket.emit('chatMessage', message);

    // 清空输入框
    messageInput.value = '';
    adjustTextareaHeight();
  }

  // 处理文件选择
  function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) return;

    pendingFile = file;
    
    // 显示预览
    previewFileName.textContent = file.name;
    previewFileSize.textContent = formatFileSize(file.size);
    
    // 显示/隐藏图片选项
    const isImage = file.type.startsWith('image/');
    imageOptions.style.display = isImage ? 'flex' : 'none';
    
    // 如果是图片，显示预览图
    if (isImage) {
      const reader = new FileReader();
      reader.onload = function(e) {
        previewImage.src = e.target.result;
        previewImage.style.display = 'block';
      };
      reader.readAsDataURL(file);
    } else {
      // 非图片文件
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

    const formData = new FormData();
    formData.append('file', pendingFile);
    formData.append('sendOriginal', sendOriginalCheckbox.checked);
    formData.append('sender', username); // 添加发送者信息

    // 隐藏预览
    filePreview.style.display = 'none';
    
    // 显示上传中消息
    addSystemMessage(`正在上传文件: ${pendingFile.name}...`);

    // 上传文件
    fetch('/upload', {
      method: 'POST',
      body: formData
    })
    .then(response => response.json())
    .then(data => {
      if (data.error) {
        addSystemMessage(`文件上传失败: ${data.error}`);
        return;
      }

      // 发送文件消息
      let message = {
        type: 'file',
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        originalUrl: data.originalUrl,
        thumbnailUrl: data.thumbnailUrl,
        fileSize: data.fileSize,
        isImage: data.isImage,
        mimeType: data.mimeType,
        isEncrypted: false
      };
      
      // 文件链接可以加密，但文件内容本身不会加密
      if (isEncryptionEnabled && currentRecipient && userPublicKeys.has(currentRecipient)) {
        message.isEncrypted = true;
        message.recipient = currentRecipient;
      }

      socket.emit('chatMessage', message);
      addSystemMessage(`文件上传成功: ${data.fileName}`);
    })
    .catch(error => {
      addSystemMessage(`文件上传失败: ${error.message}`);
    })
    .finally(() => {
      // 重置文件输入
      fileInput.value = '';
      pendingFile = null;
    });
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
    
    // 创建一个隐藏的a标签用于下载
    const a = document.createElement('a');
    a.href = currentImageUrl;
    a.download = currentImageUrl.split('/').pop().split('-').slice(2).join('-') || 'image';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // 切换加密状态
  function toggleEncryption() {
    isEncryptionEnabled = !isEncryptionEnabled;
    encryptToggle.classList.toggle('active', isEncryptionEnabled);
    updateEncryptionStatus();
    
    if (isEncryptionEnabled && (!currentRecipient || !userPublicKeys.has(currentRecipient))) {
      addSystemMessage('请从用户列表中选择一个有公钥的用户以发送加密消息');
    }
  }

  // 更新加密状态显示
  function updateEncryptionStatus() {
    if (isEncryptionEnabled && currentRecipient && userPublicKeys.has(currentRecipient)) {
      encryptionStatusIndicator.className = 'status-indicator status-encrypted';
      encryptionStatusText.textContent = `端到端加密: 已启用 (与 ${currentRecipient} 通信)`;
    } else {
      encryptionStatusIndicator.className = 'status-indicator status-not-encrypted';
      encryptionStatusText.textContent = '端到端加密: 未启用';
    }
  }

  // 辅助函数：滚动到底部
  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  // 辅助函数：调整文本框高度
  function adjustTextareaHeight() {
    messageInput.style.height = 'auto';
    const scrollHeight = messageInput.scrollHeight;
    // 限制最大高度
    messageInput.style.height = `${Math.min(scrollHeight, 120)}px`;
  }

  // 辅助函数：格式化文件大小
  function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

  // 暴露给全局，用于图片查看器
  window.openImageViewer = openImageViewer;

  // 初始化应用
  init();
});
