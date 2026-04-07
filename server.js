const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Serve static files from the root directory
app.use(express.static(path.join(__dirname, '.')));

// Database Connection using environment variable
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://mqsyr2853_db_user:I0JYehJtg1o8yScy@mmttaleen0.asw5isr.mongodb.net/EchogramDB?retryWrites=true&w=majority';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected ✅'))
  .catch(err => console.error('MongoDB connection error ❌:', err));

// --- SCHEMAS ---
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
  text: String,
  likes: [{ type: String }],
  dislikes: [{ type: String }],
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

// --- API ROUTES ---

app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    const existing = await User.findOne({ $or: [{ username }, { email }] });
    if (existing) return res.status(400).json({ error: 'Username or email taken' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: 'Invalid credentials' });
    res.json({ username: user.username, isAdmin: user.isAdmin, avatar: user.avatar });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-avatar', async (req, res) => {
  try {
    const { username, avatar } = req.body;
    await User.updateOne({ username }, { avatar });
    await Echo.updateMany(
      { "comments.author": username },
      { $set: { "comments.$[elem].authorAvatar": avatar } },
      { arrayFilters: [{ "elem.author": username }] }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/update-profile', async (req, res) => {
  try {
    const { username, bio, settings } = req.body;
    await User.updateOne({ username }, { bio, settings });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/remove-follower', async (req, res) => {
  try {
    const { currentUser, followerToRemove } = req.body;
    await User.updateOne({ username: currentUser }, { $pull: { followers: followerToRemove } });
    await User.updateOne({ username: followerToRemove }, { $pull: { following: currentUser } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/block', async (req, res) => {
  try {
    const { currentUser, userToBlock } = req.body;
    await User.updateOne({ username: currentUser }, { 
      $addToSet: { blocked: userToBlock },
      $pull: { following: userToBlock, followers: userToBlock }
    });
    await User.updateOne({ username: userToBlock }, { 
      $addToSet: { blockedBy: currentUser },
      $pull: { following: currentUser, followers: currentUser }
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/unblock', async (req, res) => {
  try {
    const { currentUser, userToUnblock } = req.body;
    await User.updateOne({ username: currentUser }, { $pull: { blocked: userToUnblock } });
    await User.updateOne({ username: userToUnblock }, { $pull: { blockedBy: currentUser } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const currentUser = req.query.currentUser;
    let excluded = [];
    if (currentUser) {
      const me = await User.findOne({ username: currentUser });
      if (me) excluded = [...me.blocked, ...me.blockedBy];
    }
    const users = await User.find({ 
      username: { $regex: q, $options: 'i', $nin: excluded }
    }, '-password');
    const echoes = await Echo.find({ 
      text: { $regex: q, $options: 'i' },
      author: { $nin: excluded }
    }).sort({ createdAt: -1 });
    res.json({ users, echoes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/echoes', async (req, res) => {
  try {
    const { text, image, author } = req.body;
    const echo = new Echo({ text, image, author });
    await echo.save();
    res.json(echo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
        await new Notification({ type: 'like', fromUser: username, toUser: echo.author, echoId: echo._id }).save();
      }
    }
    await echo.save();
    res.json(echo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/echoes/:id/comment', async (req, res) => {
  try {
    const { author, authorAvatar, text } = req.body;
    const echo = await Echo.findById(req.params.id);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    echo.comments.push({ author, authorAvatar, text, likes: [], dislikes: [] });
    await echo.save();
    if (echo.author !== author) {
      await new Notification({ type: 'comment', fromUser: author, toUser: echo.author, echoId: echo._id }).save();
    }
    res.json(echo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/comments/:echoId/:commentId/react', async (req, res) => {
  try {
    const { username, type } = req.body;
    const echo = await Echo.findById(req.params.echoId);
    if (!echo) return res.status(404).json({ error: 'Echo not found' });
    const comment = echo.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    comment.likes = comment.likes.filter(u => u !== username);
    comment.dislikes = comment.dislikes.filter(u => u !== username);
    if (type === 'like') comment.likes.push(username);
    else if (type === 'dislike') comment.dislikes.push(username);
    await echo.save();
    res.json(echo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/delete/:id', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await User.findOne({ username });
    if (!user || !user.isAdmin) return res.status(403).json({ error: 'Not authorized' });
    await Echo.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/messages/:user1/:user2', async (req, res) => {
  try {
    const { user1, user2 } = req.params;
    const u1 = await User.findOne({ username: user1 });
    if (u1 && (u1.blocked.includes(user2) || u1.blockedBy.includes(user2))) {
      return res.json([]);
    }
    const messages = await Message.find({
      $or: [
        { sender: user1, receiver: user2 },
        { sender: user2, receiver: user1 }
      ]
    }).sort({ createdAt: 1 });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', async (req, res) => {
  try {
    const { sender, receiver, text } = req.body;
    const msg = new Message({ sender, receiver, text });
    await msg.save();
    await new Notification({ type: 'message', fromUser: sender, toUser: receiver }).save();
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages/seen', async (req, res) => {
  try {
    const { sender, receiver } = req.body;
    await Message.updateMany({ sender, receiver, isSeen: false }, { isSeen: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/notifications/:username', async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    let excluded = user ? [...user.blocked, ...user.blockedBy] : [];
    const notifs = await Notification.find({ 
      toUser: req.params.username,
      fromUser: { $nin: excluded }
    }).sort({ createdAt: -1 }).limit(20);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/notifications/read', async (req, res) => {
  try {
    const { username } = req.body;
    await Notification.updateMany({ toUser: username, isRead: false }, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fix Routes: Ensure all non-API requests serve 'index.html'
app.get(/^(?!\/api).+/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Export app for Vercel
module.exports = app;

// Local development fallback
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
