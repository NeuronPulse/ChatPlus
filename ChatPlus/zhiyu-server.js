const net = require('net');
const fs = require('fs');
const path = require('path');
const colors = require('colors');

class ChatServer {
    constructor() {
        this.clients = new Map(); // 存储所有连接的客户端
        this.server = null;
        this.config = this.loadConfig();
        this.groupName = this.config.chat.groupName;
        this.port = this.config.server.port;
        this.usersData = this.loadUsers();
        this.messages = this.loadMessages(); // 加载历史消息
    }

    loadConfig() {
        try {
            const configPath = path.join(__dirname, 'config.json');
            const configData = fs.readFileSync(configPath, 'utf8');
            return JSON.parse(configData);
        } catch (error) {
            console.error('无法加载配置文件，使用默认配置'.red);
            return {
                server: { port: 8888, host: 'localhost' },
                chat: { groupName: 'Nuoke聊天群', maxUsernameLength: 20, minUsernameLength: 2 },
                features: { enablePrivateMessages: true, enableUserList: true, enableJoinLeaveNotifications: true }
            };
        }
    }

    loadUsers() {
        try {
            const usersPath = path.join(__dirname, 'users.json');
            const usersData = fs.readFileSync(usersPath, 'utf8');
            return JSON.parse(usersData);
        } catch (error) {
            return { users: {} };
        }
    }

    loadMessages() {
        try {
            const messagesPath = path.join(__dirname, 'messages.json');
            const messagesData = fs.readFileSync(messagesPath, 'utf8');
            return JSON.parse(messagesData);
        } catch (error) {
            return [];
        }
    }

    saveMessages() {
        try {
            const messagesPath = path.join(__dirname, 'messages.json');
            fs.writeFileSync(messagesPath, JSON.stringify(this.messages, null, 2), 'utf8');
        } catch (error) {
            console.error('保存消息记录失败:'.red, error.message);
        }
    }

    saveUsers() {
        try {
            const usersPath = path.join(__dirname, 'users.json');
            fs.writeFileSync(usersPath, JSON.stringify(this.usersData, null, 2), 'utf8');
        } catch (error) {
            console.error('保存用户数据失败:'.red, error.message);
        }
    }

    hashPassword(password) {
        // 简单的密码哈希（实际应用中应使用更安全的加密方式）
        let hash = 0;
        for (let i = 0; i < password.length; i++) {
            const char = password.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    }

    start() {
        this.server = net.createServer((socket) => {
            console.log(`新客户端连接: ${socket.remoteAddress}:${socket.remotePort}`.green);
            
            let clientInfo = {
                socket: socket,
                username: null,
                isLoggedIn: false,
                awaitingPassword: false,
                tempUsername: null,
                isRegistering: false,
                chatMode: 'group', // 'group' 或私聊用户名
                whisperTarget: null
            };
            
            // 使用socket作为键存储客户端信息
            this.clients.set(socket, clientInfo);

            socket.write(`欢迎来到${this.groupName}！\n请输入您的用户名: `);

            socket.on('data', (data) => {
                const message = data.toString().trim();
                
                if (!clientInfo.isLoggedIn) {
                    if (clientInfo.awaitingPassword) {
                        this.handlePassword(clientInfo, message);
                    } else {
                        this.handleLogin(clientInfo, message);
                    }
                } else {
                    this.handleMessage(clientInfo, message);
                }
            });

            socket.on('close', () => {
                this.handleDisconnect(clientInfo);
            });

            socket.on('error', (err) => {
                console.error(`客户端错误: ${err.message}`.red);
            });
        });

        this.server.listen(this.port, () => {
            console.log(`${this.groupName}服务器已启动，监听端口 ${this.port}`.cyan);
            console.log(`群聊名称: ${this.groupName}`.yellow);
        });
    }

    handleLogin(clientInfo, username) {
        const minLength = this.config.chat.minUsernameLength;
        const maxLength = this.config.chat.maxUsernameLength;

        username = username.trim();

        if (!username || username.length < minLength || username.length > maxLength) {
            clientInfo.socket.write(`用户名长度必须在${minLength}-${maxLength}个字符之间！\n`);
            clientInfo.socket.write('请输入您的用户名（至少2个字符）: ');
            return;
        }

        // 如果用户存在，则要求输入密码；否则视为注册
        if (this.usersData.users[username]) {
            clientInfo.socket.write('请输入密码: ');
            clientInfo.awaitingPassword = true;
            clientInfo.tempUsername = username;
        } else {
            clientInfo.socket.write('该用户不存在，请输入密码进行注册: ');
            clientInfo.awaitingPassword = true;
            clientInfo.tempUsername = username;
            clientInfo.isRegistering = true;
        }
    }

    handlePassword(clientInfo, password) {
        password = password.trim();
        if (password.length < 3) {
            clientInfo.socket.write('密码至少需要3个字符！\n');
            clientInfo.socket.write('请输入密码: ');
            return;
        }

        const username = clientInfo.tempUsername;
        const hashedPwd = this.hashPassword(password);

        if (clientInfo.isRegistering) {
            // 注册新用户
            this.usersData.users[username] = { 
                username: username,
                password: hashedPwd,
                createdAt: new Date().toISOString()
            };
            this.saveUsers();
            clientInfo.username = username;
            clientInfo.isLoggedIn = true;
            clientInfo.awaitingPassword = false;
            clientInfo.tempUsername = null;
            clientInfo.isRegistering = false;
            
            // 更新客户端映射，使用用户名作为键
            this.clients.set(username, clientInfo);
            this.clients.delete(clientInfo.socket);
            
            clientInfo.socket.write(`注册成功！欢迎 ${username} 加入${this.groupName}！\n`.green);
                clientInfo.socket.write('输入 /help 查看可用命令\n'.yellow);
                clientInfo.socket.write('当前为群聊模式，输入 /w 用户名 开始私聊\n'.cyan);
            
            // 发送历史消息
            if (this.messages.length > 0) {
                this.messages.forEach(msg => {
                    // 屏蔽空消息
                    if (msg.message.trim() === '') {
                        return;
                    }
                    if (msg.type === 'whisper') {
                        //clientInfo.socket.write(`[${msg.timestamp}] [私聊] ${msg.username} -> ${msg.target}: ${msg.message}\n`);
                        if (msg.target === username) {
                            clientInfo.socket.write(`[${msg.timestamp}] [私聊] ${msg.username} -> ${msg.target}: ${msg.message}\n`);
                        }
                    } else {
                        clientInfo.socket.write(`[${msg.timestamp}] ${msg.username}: ${msg.message}\n`);
                    }
                });
            }
            
            this.broadcast(`${username} 加入了聊天室！`, username);
            console.log(`${username} 注册并加入聊天室`.green);
        } else {
            // 验证密码登录
            const user = this.usersData.users[username];
            if (user && user.password === hashedPwd) {
                if (this.isUsernameTaken(username)) {
                    clientInfo.socket.write('该用户已在线，请勿重复登录！\n');
                    clientInfo.socket.write('请输入您的用户名: ');
                    clientInfo.awaitingPassword = false;
                    clientInfo.tempUsername = null;
                    return;
                }
                
                clientInfo.username = username;
                clientInfo.isLoggedIn = true;
                clientInfo.awaitingPassword = false;
                clientInfo.tempUsername = null;
                
                // 更新客户端映射，使用用户名作为键
                this.clients.set(username, clientInfo);
                this.clients.delete(clientInfo.socket);
                
                clientInfo.socket.write(`欢迎回来，${username}！\n`.green);
                
                // 发送历史消息
            if (this.messages.length > 0) {
                this.messages.forEach(msg => {
                    // 屏蔽空消息
                    if (msg.message.trim() === '') {
                        return;
                    }
                    if (msg.type === 'whisper') {
                        clientInfo.socket.write(`[${msg.timestamp}] [私聊] ${msg.username} -> ${msg.target}: ${msg.message}\n`);
                    } else {
                        clientInfo.socket.write(`[${msg.timestamp}] ${msg.username}: ${msg.message}\n`);
                    }
                });
            }
                
                clientInfo.socket.write('输入 /help 查看可用命令\n'.yellow);
                clientInfo.socket.write('当前为群聊模式，输入 /w 用户名 开始私聊\n'.cyan);
                this.broadcast(`${username} 加入了聊天室！`, username);
                console.log(`${username} 登录并加入聊天室`.green);
            } else {
                clientInfo.socket.write('密码错误！\n');
                clientInfo.socket.write('请输入您的用户名: ');
                clientInfo.awaitingPassword = false;
                clientInfo.tempUsername = null;
                return;
            }
        }
    }

    handleMessage(clientInfo, message) {
        if (!clientInfo.isLoggedIn) {
            return;
        }

        if (message.startsWith('/')) {
            this.handleCommand(clientInfo, message);
        } else {
            const timestamp = new Date().toLocaleTimeString();
            
            if (clientInfo.chatMode === 'group') {
                if (message.trim() === '') {
                    return;
                }
                // 群聊模式
                const formattedMessage = `[${timestamp}] ${clientInfo.username}: ${message}`;

                // 存储消息到历史记录
                const messageData = {
                    username: clientInfo.username,
                    message: message,
                    timestamp: timestamp,
                    time: new Date().toISOString()
                };
                this.messages.push(messageData);

                // 限制消息数量，最多保存100条
                if (this.messages.length > 100) {
                    this.messages = this.messages.slice(-100);
                }

                this.saveMessages();

                this.broadcast(formattedMessage, clientInfo.socket);
                console.log(`${clientInfo.username}: ${message}`.cyan);
            } else {
                if (message.trim() === '') {
                    return;
                }
                // 私聊模式
                this.sendWhisperMessage(clientInfo, message);
            }
        }
    }

    handleCommand(clientInfo, command) {
        const parts = command.split(' ');
        const cmd = parts[0].toLowerCase();

        switch (cmd) {
            case '/help':
                this.sendHelp(clientInfo.socket);
                break;
            case '/users':
                this.sendOnlineUsers(clientInfo.socket);
                break;
            case '/w':
                this.handleSwitchWhisper(clientInfo, parts.slice(1));
                break;
            case '/g':
            case '/group':
                this.handleSwitchGroup(clientInfo);
                break;
            case '/quit':
                clientInfo.socket.end();
                break;
            default:
                clientInfo.socket.write('未知命令，输入 /help 查看帮助\n');
        }
    }

    handleSwitchWhisper(clientInfo, args) {
        if (args.length < 1) {
            clientInfo.socket.write('用法: /w 用户名 - 切换到与指定用户的私聊模式\n');
            return;
        }

        const targetUsername = args[0];
        const targetClient = this.findClientByUsername(targetUsername);
        
        if (!targetClient) {
            clientInfo.socket.write(`用户 ${targetUsername} 不在线\n`);
            return;
        }

        if (targetClient === clientInfo) {
            clientInfo.socket.write('不能与自己私聊\n');
            return;
        }

        clientInfo.chatMode = 'whisper';
        clientInfo.whisperTarget = targetUsername;
        clientInfo.socket.write(`已切换到与 ${targetUsername} 的私聊模式\n`.yellow);
        clientInfo.socket.write('输入 /g 或 /group 返回群聊模式\n'.yellow);
    }

    handleSwitchGroup(clientInfo) {
        if (clientInfo.chatMode === 'group') {
            clientInfo.socket.write('当前已经是群聊模式\n');
        } else {
            clientInfo.chatMode = 'group';
            clientInfo.whisperTarget = null;
            clientInfo.socket.write('已返回群聊模式\n'.green);
        }
    }

    sendWhisperMessage(fromClient, message) {
        const targetClient = this.findClientByUsername(fromClient.whisperTarget);
        
        if (!targetClient) {
            fromClient.socket.write(`用户 ${fromClient.whisperTarget} 已下线，自动返回群聊模式\n`);
            fromClient.chatMode = 'group';
            fromClient.whisperTarget = null;
            return;
        }

        const timestamp = new Date().toLocaleTimeString();
        const whisperMessage = `[${timestamp}] [私聊] ${fromClient.username}: ${message}`;
        
        targetClient.socket.write(whisperMessage + '\n');
        fromClient.socket.write(`[${timestamp}] [你 -> ${fromClient.whisperTarget}]: ${message}\n`);
        
        // 保存私聊记录
        const messageData = {
            username: fromClient.username,
            message: message,
            target: fromClient.whisperTarget,
            type: 'whisper',
            timestamp: timestamp,
            time: new Date().toISOString()
        };
        this.messages.push(messageData);

        // 限制消息数量，最多保存100条
        if (this.messages.length > 100) {
            this.messages = this.messages.slice(-100);
        }

        this.saveMessages();
        
        console.log(`[私聊] ${fromClient.username} -> ${fromClient.whisperTarget}: ${message}`.magenta);
    }

    sendHelp(socket) {
        socket.write('\n命令列表:\n');
        socket.write('  /help - 显示此帮助信息\n');
        socket.write('  /users - 查看在线用户列表\n');
        socket.write('  /w 用户名 - 切换到与指定用户的私聊模式\n');
        socket.write('  /g 或 /group - 返回群聊模式\n');
        socket.write('  /quit - 退出聊天\n\n');
    }

    sendOnlineUsers(targetSocket = null) {
        const usernames = Array.from(this.clients.values())
            .map(client => client.username)
            .filter(username => username);
        
        const message = `在线用户 (${usernames.length}): ${usernames.join(', ')}\n`;
        
        if (targetSocket) {
            targetSocket.write(message);
        } else {
            this.broadcast(message, null);
        }
    }

    broadcast(message, excludeUsername) {
        this.clients.forEach((clientInfo, key) => {
            if (clientInfo.isLoggedIn && clientInfo.username !== excludeUsername) {
                clientInfo.socket.write(message + '\n');
            }
        });
    }

    handleDisconnect(clientInfo) {
        if (clientInfo.username) {
            console.log(`${clientInfo.username} 离开了聊天室`.red);
            this.broadcast(`${clientInfo.username} 离开了${this.groupName}`, clientInfo.username);
            // 如果已登录，使用用户名作为键删除
            this.clients.delete(clientInfo.username);
        } else {
            // 如果未登录，使用socket作为键删除
            this.clients.delete(clientInfo.socket);
        }
        this.sendOnlineUsers();
    }

    isUsernameTaken(username) {
        return Array.from(this.clients.values())
            .some(client => client.username === username);
    }

    findClientByUsername(username) {
        return Array.from(this.clients.values())
            .find(client => client.username === username);
    }

    // 修改群聊名称
    setGroupName(newName) {
        if (!newName || newName.trim().length === 0) {
            console.log('群聊名称不能为空'.red);
            return;
        }

        this.groupName = newName;
        this.config.chat.groupName = newName;
        
        // 保存到配置文件
        try {
            const configPath = path.join(__dirname, 'config.json');
            fs.writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf8');
            console.log(`群聊名称已修改为: ${newName}`.yellow);
            this.broadcast(`群聊名称已修改为: ${newName}`, null);
        } catch (error) {
            console.error('保存配置失败:'.red, error.message);
        }
    }
}

// 启动服务器
const chatServer = new ChatServer();
chatServer.start();

// 允许通过命令行修改群聊名称
process.stdin.on('data', (data) => {
    const input = data.toString().trim();
    if (input.startsWith('/setname ')) {
        const newName = input.substring(9);
        if (newName.length > 0) {
            chatServer.setGroupName(newName);
        } else {
            console.log('群聊名称不能为空'.red);
        }
    } else if (input === '/help') {
        console.log('服务器命令:');
        console.log('  /setname 新名称 - 修改群聊名称');
        console.log('  /help - 显示帮助');
    }
});

console.log('\n服务器管理命令:');
console.log('  /setname 新名称 - 修改群聊名称');
console.log('  /help - 显示服务器帮助');