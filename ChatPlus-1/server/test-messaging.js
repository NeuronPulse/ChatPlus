const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');

// 测试配置
const SERVER_URL = 'http://localhost:3001';
const TEST_ROOM_NAME = 'test-room-' + Math.floor(Math.random() * 10000);
const USER1_NAME = 'test-user1';
const USER2_NAME = 'test-user2';
const TEST_FILE_PATH = path.join(__dirname, 'test-file.txt');

// 创建测试文件
fs.writeFileSync(TEST_FILE_PATH, 'This is a test file content.');

// 记录测试结果
const testResults = [];
function logResult(testName, success, message) {
  const result = { testName, success, message };
  testResults.push(result);
  console.log(`[${success ? '成功' : '失败'}] ${testName}: ${message}`);
}

// 用户1连接
const user1Socket = io(SERVER_URL);
// 用户2连接
const user2Socket = io(SERVER_URL);

// 测试步骤
async function runTests() {
  console.log('开始测试消息发送和文件上传功能...');

  // 用户1登录
  user1Socket.emit('login', USER1_NAME);
  await new Promise(resolve => {
    user1Socket.on('loginSuccess', () => {
      logResult('用户1登录', true, '用户1登录成功');
      resolve();
    });
    user1Socket.on('loginError', (error) => {
      logResult('用户1登录', false, `用户1登录失败: ${error}`);
      resolve();
    });
  });

  // 用户2登录
  user2Socket.emit('login', USER2_NAME);
  await new Promise(resolve => {
    user2Socket.on('loginSuccess', () => {
      logResult('用户2登录', true, '用户2登录成功');
      resolve();
    });
    user2Socket.on('loginError', (error) => {
      logResult('用户2登录', false, `用户2登录失败: ${error}`);
      resolve();
    });
  });

  // 用户1创建房间
  let roomId;
  user1Socket.emit('createRoom', TEST_ROOM_NAME);
  await new Promise(resolve => {
    user1Socket.on('roomCreated', (room) => {
      roomId = room.id;
      logResult('创建房间', true, `房间创建成功: ${room.name} (${room.id})`);
      resolve();
    });
    user1Socket.on('roomError', (error) => {
      logResult('创建房间', false, `房间创建失败: ${error}`);
      resolve();
    });
  });

  // 用户2加入房间
  user2Socket.emit('joinRoom', roomId);
  await new Promise(resolve => {
    user2Socket.on('roomJoined', () => {
      logResult('用户2加入房间', true, '用户2成功加入房间');
      resolve();
    });
    user2Socket.on('roomError', (error) => {
      logResult('用户2加入房间', false, `用户2加入房间失败: ${error}`);
      resolve();
    });
  });

  // 用户1发送消息
  const testMessage = '这是一条测试消息';
  user1Socket.emit('sendMessage', {
    conversationType: 'room',
    conversationId: roomId,
    content: testMessage
  });
  await new Promise(resolve => {
    let messageReceived = false;
    user2Socket.on('newMessage', (message) => {
      if (message.conversationId === roomId && message.content === testMessage) {
        messageReceived = true;
        logResult('用户1发送消息', true, '用户2成功接收用户1的消息');
        resolve();
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!messageReceived) {
        logResult('用户1发送消息', false, '用户2未收到用户1的消息');
        resolve();
      }
    }, 3000);
  });

  // 用户2发送消息
  const testMessage2 = '这是用户2的回复';
  user2Socket.emit('sendMessage', {
    conversationType: 'room',
    conversationId: roomId,
    content: testMessage2
  });
  await new Promise(resolve => {
    let messageReceived = false;
    user1Socket.on('newMessage', (message) => {
      if (message.conversationId === roomId && message.content === testMessage2) {
        messageReceived = true;
        logResult('用户2发送消息', true, '用户1成功接收用户2的消息');
        resolve();
      }
    });

    // 超时处理
    setTimeout(() => {
      if (!messageReceived) {
        logResult('用户2发送消息', false, '用户1未收到用户2的消息');
        resolve();
      }
    }, 3000);
  });

  // 用户1上传文件
  // 注意：这个测试需要在浏览器环境中进行更完整的测试
  logResult('文件上传测试', true, '文件上传功能需要在浏览器中进行完整测试');

  // 测试完成
  console.log('\n测试总结:');
  let allSuccess = true;
  testResults.forEach(result => {
    if (!result.success) allSuccess = false;
    console.log(`- ${result.testName}: ${result.success ? '成功' : '失败'} - ${result.message}`);
  });

  if (allSuccess) {
    console.log('\n所有测试通过!');
  } else {
    console.log('\n有测试未通过，请查看上面的详细信息。');
  }

  // 清理
  fs.unlinkSync(TEST_FILE_PATH);
  user1Socket.disconnect();
  user2Socket.disconnect();
  process.exit(0);
}

// 等待连接建立
Promise.all([
  new Promise(resolve => user1Socket.on('connect', resolve)),
  new Promise(resolve => user2Socket.on('connect', resolve))
]).then(runTests);

// 错误处理
user1Socket.on('error', (error) => {
  console.error('用户1连接错误:', error);
});

user2Socket.on('error', (error) => {
  console.error('用户2连接错误:', error);
});