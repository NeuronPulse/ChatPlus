const { sequelize } = require('./models');

(async () => {
  try {
    const [friendsColumns] = await sequelize.query('PRAGMA table_info(friends)');
    const [usersColumns] = await sequelize.query('PRAGMA table_info(users)');
    console.log('Friends Table Columns:');
    console.log(friendsColumns);
    console.log('Users Table Columns:');
    console.log(usersColumns);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    sequelize.close();
  }
})();