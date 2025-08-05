const { sequelize, User } = require('./models');

(async () => {
  try {
    // 先查询一个存在的用户ID
    const user = await User.findOne();
    if (!user) {
      console.log('没有找到用户，请先创建用户');
      return;
    }
    const testUserId = user.id;
    console.log(`使用用户ID: ${testUserId} 进行测试`);

    // 检查friends表中是否有数据
    const [allFriends] = await sequelize.query('SELECT * FROM friends');
    console.log('Friends表中的所有数据:', allFriends);

    console.log('执行查询...');
    const result = await sequelize.query(
      'SELECT u.id, u.username, u.publicKey, f.status FROM friends f JOIN users u ON f.friendId = u.id WHERE f.userId = ? AND f.status = ?',
      {
        replacements: [testUserId, 'accepted'],
        type: sequelize.QueryTypes.SELECT
      }
    );
    console.log('完整查询结果:', result);
    const [friends] = result;
    console.log('查询结果:', friends);
  } catch (error) {
    console.error('查询错误:', error);
  } finally {
    sequelize.close();
  }
})();