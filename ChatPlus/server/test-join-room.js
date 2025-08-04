const http = require('http');

// 测试房间加入功能
function testJoinRoom() {
  const options = {
    hostname: 'localhost',
    port: 3000,
    path: '/test-join-room?roomId=test-room-1',
    method: 'GET'
  };

  const req = http.request(options, (res) => {
    console.log(`状态码: ${res.statusCode}`);
    res.setEncoding('utf8');
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      console.log('响应体:', data);
    });
  });

  req.on('error', (e) => {
    console.error(`请求遇到问题: ${e.message}`);
  });

  // 发送请求
  req.end();
}

testJoinRoom();