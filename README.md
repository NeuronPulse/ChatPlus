# ChatPlus-TCP

一个基于TCP协议的简易聊天应用，包含前后端完整实现。

## 项目结构
ChatPlus-TCP/
├── server/
│   ├── index.js         # 服务器主文件，包含TCP服务和WebSocket代理
│   └── package.json     # 服务器依赖配置
├── client/
│   ├── index.html       # 客户端页面
│   └── js/
│       └── client.js    # 客户端脚本
└── README.md
## 功能特点

- 基于TCP协议的客户端-服务器通信
- WebSocket作为浏览器与TCP服务的中间层
- 支持多房间聊天
- 用户在线状态显示
- 响应式界面设计

## 协议设计

使用自定义的简单协议格式解决TCP粘包问题：`[长度][分隔符][数据]`

- 长度：消息内容的字节长度
- 分隔符：`|||`
- 数据：JSON格式的消息内容

## 运行方法

1. 克隆或下载项目到本地

2. 安装服务器依赖cd server
npm install
3. 启动服务器# 普通启动
npm start

# 开发模式（代码修改后自动重启）
npm run dev
4. 访问应用
打开浏览器，访问 http://localhost:8080

## 工作原理

1. 服务器同时启动两个服务：
   - TCP服务（3000端口）：处理核心聊天业务逻辑
   - HTTP/WebSocket服务（8080端口）：提供静态文件服务并作为浏览器与TCP服务的代理

2. 浏览器通过WebSocket连接到服务器，服务器内部建立TCP连接作为中转，实现浏览器与TCP服务的通信

3. 所有消息都按照自定义协议格式进行封装和解析，确保数据传输的完整性
