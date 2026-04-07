require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');
const http = require('http');
const multer = require('multer');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Serve uploads folder statically
app.use('/uploads', express.static(uploadDir));

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// Socket.io Connection Logic
let onlineUsers = new Set();

io.on('connection', (socket) => {
  let socketUser = null;

  socket.on('join', (username) => {
    socketUser = username;
    socket.join(username);
    onlineUsers.add(username);
    io.emit('online_users', Array.from(onlineUsers));
  });

  socket.on('disconnect', () => {
    if (socketUser) {
      onlineUsers.delete(socketUser);
      io.emit('online_users', Array.from(onlineUsers));
    }
  });
});
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// تشغيل الملفات الثابتة
app.use(express.static(path.join(__dirname, '.')));

// الربط بقاعدة البيانات
const MONGODB_URI = process.env.MONGO_URI || 'mongodb+srv://mqsyr2853_db_user:I0JYehJtg1o8yScy@mmttaleen0.asw5isr.mongodb.net/EchogramDB?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Echogram Full Power: MongoDB connected ✅'))
  .catch(err => console.error('MongoDB connection error ❌:', err));

// --- SCHEMAS (المخططات الكاملة) ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '' },
  isVerified: { type: Boolean, default: false },
  isAdmin: { type: Boolean, default: false },
  followers: [{ type: String }],
  following: [{ type: String }],
  blocked: [{ type: String }],
  blockedBy: [{ type: String }],
  settings: {
    showOnline: { type: Boolean, default: true },
    showSeen: { type: Boolean, default: true }
  }
});
const User = mongoose.model('User', userSchema);

const commentSchema = new mongoose.Schema({
  author: String,
  authorAvatar: String,
  authorIsAdmin: { type: Boolean, default: false },
  text: String,
  likes: [{ type: String }],
  dislikes: [{ type: String }],
  replies: [{
    author: String,
    authorAvatar: String,
    authorIsAdmin: { type: Boolean, default: false },
    text: String,
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: { type: Date, default: Date.now }
});

const echoSchema = new mongoose.Schema({
  text: { type: String },
  image: { type: String },
  author: { type: String, required: true },
  likedBy: [{ type: String }],
  comments: [commentSchema],
  createdAt: { type: Date, default: Date.now }
});
const Echo = mongoose.model('Echo', echoSchema);

const messageSchema = new mongoose.Schema({
  sender: { type: String, required: true },
  receiver: { type: String, required: true },
  text: { type: String, required: true },
  isSeen: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

const notificationSchema = new mongoose.Schema({
  type: { type: String, required: true },
  fromUser: { type: String, required: true },
  toUser: { type: String, required: true },
  echoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Echo' },
  isRead: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});
const Notification = mongoose.model('Notification', notificationSchema);

const collectionSchema = new mongoose.Schema({
  name: { type: String, required: true },
  owner: { type: String, required: true },
  echoes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Echo' }]
});
const Collection = mongoose.model('Collection', collectionSchema);

// --- API ROUTES (المسارات الكاملة) ---

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ error: 'Username or email taken' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ username: user.username, isAdmin: user.isAdmin, avatar: user.avatar });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:username', async (req, res) => {
  try {
    const { currentUser } = req.query;
    const user = await User.findOne({ username: req.params.username }, '-password');
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me && (me.blocked.includes(user.username) || me.blockedBy.includes(user.username))) {
        return res.status(403).json({ error: 'User is blocked' });
      }
    }
    res.json(user);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/follow', async (req, res) => {
  try {
    const { follower, following, action } = req.body;
    if (action === 'follow') {
      await User.updateOne({ username: follower }, { $addToSet: { following: following } });
      await User.updateOne({ username: following }, { $addToSet: { followers: follower } });
      await new Notification({ type: 'follow', fromUser: follower, toUser: following }).save();
    } else {
      await User.updateOne({ username: follower }, { $pull: { following: following } });
      await User.updateOne({ username: following }, { $pull: { followers: follower } });
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users', async (req, res) => {
  try {
    const { currentUser } = req.query;
    let excluded = [];
    if (currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me) excluded = [...me.blocked, ...me.blockedBy];
    }
    const users = await User.find({ username: { $nin: excluded } }, 'username avatar settings isVerified isAdmin');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/echoes', async (req, res) => {
  try {
    const { username, currentUser } = req.query; 
    let excluded = [];
    if (currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me) excluded = [...me.blocked, ...me.blockedBy];
    }
    let query = { author: { $nin: excluded } };
    if (username && username !== currentUser) {
      query.author = username;
      if (excluded.includes(username)) return res.json([]);
    } else if (username === currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me && me.following.length > 0) {
        const feedUsers = [...me.following, currentUser].filter(u => !excluded.includes(u));
        query.author = { $in: feedUsers };
      }
    }
    let echoes = await Echo.find(query).sort({ createdAt: -1 });
    if (echoes.length === 0 && username === currentUser) {
       echoes = await Echo.find({ author: { $nin: excluded } }).sort({ createdAt: -1 });
    }
    res.json(echoes);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/echoes', upload.single('image'), async (req, res) => {
  try {
    const { text, author } = req.body;
    let image = '';
    if (req.file) {
      image = '/uploads/' + req.file.filename;
    }
    const echo = new Echo({ text, image, author });
    await echo.save();
    res.json(echo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/echoes/:id/like', async (req, res) => {
  try {
    const { username } = req.body;
    const echo = await Echo.findById(req.params.id);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    if (echo.likedBy.includes(username)) {
      echo.likedBy = echo.likedBy.filter(u => u !== username);
    } else {
      echo.likedBy.push(username);
      if (echo.author !== username) {
        const notif = new Notification({ type: 'like', fromUser: username, toUser: echo.author, echoId: echo._id });
        await notif.save();
        io.to(echo.author).emit('new_notification', notif);
      }
    }
    await echo.save();
    res.json(echo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/echoes/:id/comment', async (req, res) => {
  try {
    const { author, authorAvatar, text } = req.body;
    const user = await User.findOne({ username: author });
    const isAdmin = user ? user.isAdmin : false;
    
    const echo = await Echo.findById(req.params.id);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    
    echo.comments.push({ author, authorAvatar, authorIsAdmin: isAdmin, text });
    await echo.save();
    
    if (echo.author !== author) {
      await new Notification({ type: 'comment', fromUser: author, toUser: echo.author, echoId: echo._id }).save();
    }
    
    res.json(echo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/comments/:echoId/:commentId/react', async (req, res) => {
  try {
    const { echoId, commentId } = req.params;
    const { username, type } = req.body; // type: 'like' or 'dislike'
    
    const echo = await Echo.findById(echoId);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    
    const comment = echo.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    if (type === 'like') {
      if (comment.likes.includes(username)) {
        comment.likes = comment.likes.filter(u => u !== username);
      } else {
        comment.likes.push(username);
        comment.dislikes = comment.dislikes.filter(u => u !== username);
      }
    } else if (type === 'dislike') {
      if (comment.dislikes.includes(username)) {
        comment.dislikes = comment.dislikes.filter(u => u !== username);
      } else {
        comment.dislikes.push(username);
        comment.likes = comment.likes.filter(u => u !== username);
      }
    }
    
    await echo.save();
    res.json(echo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/echoes/:echoId/comments/:commentId/reply', async (req, res) => {
  try {
    const { echoId, commentId } = req.params;
    const { author, authorAvatar, text } = req.body;
    
    const user = await User.findOne({ username: author });
    const isAdmin = user ? user.isAdmin : false;

    const echo = await Echo.findById(echoId);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    
    const comment = echo.comments.id(commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    
    comment.replies.push({ author, authorAvatar, authorIsAdmin: isAdmin, text });
    await echo.save();
    
    res.json(echo);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { sender, receiver, text } = req.body;
    const msg = new Message({ sender, receiver, text });
    await msg.save();
    io.to(receiver).emit('new_message', msg);
    io.to(sender).emit('new_message', msg);
    res.json(msg);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/conversations/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const messages = await Message.find({
      $or: [{ sender: username }, { receiver: username }]
    }).sort({ createdAt: -1 });

    const chatPartners = new Set();
    messages.forEach(m => {
      if (m.sender === username) chatPartners.add(m.receiver);
      else chatPartners.add(m.sender);
    });

    const users = await User.find({ username: { $in: Array.from(chatPartners) } }, 'username avatar settings isVerified isAdmin');
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/:username', async (req, res) => {
  try {
    const notifs = await Notification.find({ toUser: req.params.username }).sort({ createdAt: -1 }).limit(20);
    res.json(notifs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q, currentUser } = req.query;
    if (!q) return res.json({ users: [], echoes: [] });

    const regex = new RegExp(q, 'i');
    
    let excluded = [];
    if (currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me) excluded = [...me.blocked, ...me.blockedBy];
    }

    const users = await User.find({ 
      username: regex,
      username: { $nin: excluded }
    }, 'username avatar bio isVerified isAdmin').limit(10);

    const echoes = await Echo.find({ 
      text: regex,
      author: { $nin: excluded }
    }).sort({ createdAt: -1 }).limit(20);

    res.json({ users, echoes });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/users/update-username', async (req, res) => {
  try {
    const { oldUsername, newUsername } = req.body;
    if (!oldUsername || !newUsername) return res.status(400).json({ error: 'Missing usernames' });

    const existing = await User.findOne({ username: newUsername });
    if (existing) return res.status(400).json({ error: 'Username already taken' });

    // 1. Update User itself
    await User.updateOne({ username: oldUsername }, { username: newUsername });

    // 2. Update Echoes author and likedBy
    await Echo.updateMany({ author: oldUsername }, { author: newUsername });
    await Echo.updateMany({ likedBy: oldUsername }, { $set: { "likedBy.$": newUsername } });

    // 3. Update Comments inside Echoes
    await Echo.updateMany(
      { "comments.author": oldUsername },
      { $set: { "comments.$[elem].author": newUsername } },
      { arrayFilters: [{ "elem.author": oldUsername }] }
    );

    // 4. Update Messages
    await Message.updateMany({ sender: oldUsername }, { sender: newUsername });
    await Message.updateMany({ receiver: oldUsername }, { receiver: newUsername });

    // 5. Update Notifications
    await Notification.updateMany({ fromUser: oldUsername }, { fromUser: newUsername });
    await Notification.updateMany({ toUser: oldUsername }, { toUser: newUsername });

    // 6. Update other users' followers/following/blocked lists
    await User.updateMany({ followers: oldUsername }, { $set: { "followers.$": newUsername } });
    await User.updateMany({ following: oldUsername }, { $set: { "following.$": newUsername } });
    await User.updateMany({ blocked: oldUsername }, { $set: { "blocked.$": newUsername } });
    await User.updateMany({ blockedBy: oldUsername }, { $set: { "blockedBy.$": newUsername } });

    res.json({ success: true, newUsername });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/collections', async (req, res) => {
  try {
    const { name, owner } = req.body;
    const collection = new Collection({ name, owner });
    await collection.save();
    res.json(collection);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/collections/:username', async (req, res) => {
  try {
    const collections = await Collection.find({ owner: req.params.username });
    res.json(collections);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/collections/id/:id', async (req, res) => {
  try {
    const coll = await Collection.findById(req.params.id).populate('echoes');
    res.json(coll);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/collections/:id/save', async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ error: 'Collection not found' });
    const { echoId } = req.body;
    if (!collection.echoes.includes(echoId)) {
      collection.echoes.push(echoId);
      await collection.save();
    }
    res.json(collection);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/update-profile', async (req, res) => {
  try {
    const { username, bio, settings } = req.body;
    await User.updateOne({ username }, { bio, settings });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
  try {
    const { username } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const avatarPath = '/uploads/' + req.file.filename;
    await User.updateOne({ username }, { avatar: avatarPath });
    res.json({ avatar: avatarPath });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Routing Fallback
app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) {
      return res.status(404).json({ error: 'API route not found' });
    }
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
