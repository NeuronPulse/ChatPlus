const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

// 初始化数据库连接
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: path.join(__dirname, '../chatplus.db'),
  logging: false // 关闭SQL日志输出
});

// 定义模型
const User = sequelize.define('User', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  publicKey: DataTypes.TEXT,
  online: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  }
});

const Room = sequelize.define('Room', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  creator: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

const RoomMember = sequelize.define('RoomMember', {
  roomId: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  userId: {
    type: DataTypes.STRING,
    primaryKey: true
  }
});

const Message = sequelize.define('Message', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  sender: {
    type: DataTypes.STRING,
    allowNull: false
  },
  conversationType: {
    type: DataTypes.STRING, // 'room' 或 'private'
    allowNull: false
  },
  conversationId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  content: DataTypes.TEXT,
  encrypted: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  type: {
    type: DataTypes.STRING,
    defaultValue: 'text' // 'text', 'image', 'file'
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  }
});

const Friend = sequelize.define('Friend', {
  userId: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  friendId: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending' // 'pending', 'accepted', 'rejected'
  }
});

const File = sequelize.define('File', {
  id: {
    type: DataTypes.STRING,
    primaryKey: true
  },
  name: DataTypes.STRING,
  url: DataTypes.STRING,
  thumbnailUrl: DataTypes.STRING,
  size: DataTypes.INTEGER,
  uploadTime: {
    type: DataTypes.DATE,
    defaultValue: Sequelize.NOW
  },
  expiryTime: DataTypes.DATE,
  owner: DataTypes.STRING,
  type: DataTypes.STRING, // 'file'|'voice'
  conversationType: DataTypes.STRING, // 'room'|'private'
  conversationId: DataTypes.STRING
});

// 建立关联关系
RoomMember.belongsTo(User, { foreignKey: 'userId' });
RoomMember.belongsTo(Room, { foreignKey: 'roomId' });
Message.belongsTo(User, { foreignKey: 'sender' });
File.belongsTo(User, { foreignKey: 'owner' });
Friend.belongsTo(User, { foreignKey: 'userId', as: 'user' });
Friend.belongsTo(User, { foreignKey: 'friendId', as: 'friend' });

// User和Friend之间的多对多关联
User.belongsToMany(User, {
  through: 'Friend',
  as: 'friends',
  foreignKey: 'userId',
  otherKey: 'friendId'
});

User.belongsToMany(User, {
  through: 'Friend',
  as: 'friendOf',
  foreignKey: 'friendId',
  otherKey: 'userId'
});

// 同步数据库
async function syncDB() {
  try {
    // 同步所有表，不需要每次都删除
    await sequelize.sync();
    console.log('数据库同步完成');
  } catch (error) {
    console.error('数据库同步失败:', error);
  }
}

module.exports = {
  sequelize,
  syncDB,
  User,
  Room,
  RoomMember,
  Message,
  Friend,
  File
};