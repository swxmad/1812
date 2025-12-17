const express = require('express');
const session = require('express-session');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const sequelize = require('./config/database');
const User = require('./models/User');

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(session({
  secret: 'my-super-secret-key-2025',
  ressave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, Date.now() + ext);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpe?g|png|gif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

const refreshSessionUser = async (req, res, next) => {
  if (req.session.userId) {
    const user = await User.findByPk(req.session.userId);
    if (user) {
      req.session.userId = user.id;
      req.session.userRole = user.role;
    } else {
      req.session.destroy();
      return res.redirect('/login');
    }
  }
  next();
};

app.use(refreshSessionUser);

const requireRole = (...allowedRoles) => (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  const userRole = req.session.userRole;
  if (allowedRoles.includes(userRole)) {
    next();
  } else {
    res.status(403).send(`Доступ запрещён. Ваша роль: ${userRole}`);
  }
};

app.get('/', (req, res) => {
  if (req.session.userId) return res.redirect('/profile');
  res.render('register');
});

app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/profile');
  }
  res.send(`
    <div style="font-family: Arial; text-align: center; margin-top: 50px;">
      <h2>Добро пожаловать!</h2>
      <p><a href="/register">Зарегистрироваться</a></p>
      <p><a href="/login">Войти</a></p>
    </div>
  `);
});

app.post('/register', async (req, res) => {
  const { username, email, password, role } = req.body;
  const userRole = parseInt(role) || 1;
  
  if (userRole < 1 || userRole > 4) {
    return res.status(400).send('Недопустимая роль');
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, email, password: hashed, role: userRole });
    req.session.userId = user.id;
    req.session.userRole = user.role;
    res.redirect('/profile');
  } catch (err) {
    res.status(400).send('Ошибка регистрации');
  }
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ where: { email } });
  if (!user || !await bcrypt.compare(password, user.password)) {
    return res.status(401).send('Неверный email или пароль');
  }
  req.session.userId = user.id;
  req.session.userRole = user.role;
  res.redirect('/profile');
});

app.get('/profile', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  
  const user = await User.findByPk(req.session.userId);
  if (!user) return res.redirect('/login');

  let roleContent = '';
  if (user.role === 1) {
    roleContent = '<h3>Ваша панель (роль 1)</h3><p>Добро пожаловать, обычный пользователь! Здесь вы можете просматривать свой контент.</p>';
  } else if (user.role === 2) {
    roleContent = '<h3>Панель модератора (роль 2)</h3><p>Вы можете управлять комментариями и отчётами.</p>';
  } else if (user.role === 3) {
    roleContent = '<h3>Админ-панель (роль 3)</h3><p>Управление пользователями, настройками и контентом.</p>';
  } else if (user.role === 4) {
    roleContent = '<h3>Супер-админ (роль 4)</h3><p>Полный контроль над системой, включая безопасность и резервное копирование.</p>';
  }

  res.render('profile', { user, roleContent });
});

app.get('/profile/edit', async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const user = await User.findByPk(req.session.userId);
  res.render('edit-profile', { user });
});

app.post('/profile/edit', upload.single('profilePicture'), async (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const { firstName, lastName, email } = req.body;
  const user = await User.findByPk(req.session.userId);
  if (!user) return res.status(404).send('Пользователь не найден');

  user.firstName = firstName || null;
  user.lastName = lastName || null;
  user.email = email;
  if (req.file) user.profilePicture = req.file.filename;

  await user.save();
  res.redirect('/profile');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

app.get('/page1', requireRole(1), (req, res) => {
  res.render('page1');
});

app.get('/page2', requireRole(2), (req, res) => {
  res.render('page2');
});

app.get('/page3', requireRole(3, 4), (req, res) => {
  const role = req.session.userRole;
  res.render('page3', { role });
});

sequelize.authenticate()
  .then(() => {
    console.log('Подключение к БД успешно.');
    return User.sync(); 
  })
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Сервер запущен: http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Ошибка:', err);
    process.exit(1);
  });