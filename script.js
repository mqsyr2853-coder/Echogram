const socket = typeof io !== 'undefined' ? io() : null;
const currentUser = localStorage.getItem('echogram_user');

// Socket.io initialization
if (currentUser && socket) {
  socket.emit('join', currentUser);
}

let onlineUserList = [];

// Socket event listeners
if (socket) {
  socket.on('online_users', (users) => {
    onlineUserList = users;
    // Update current chat status if open
    if (currentChatUser) {
      const isOnline = onlineUserList.includes(currentChatUser);
      const dot = document.getElementById('chat-online-status');
      if (dot) dot.className = `status-dot ${isOnline ? 'online' : ''}`;
    }
    // Update profile status if open
    if (currentProfileUser) {
      const isOnline = onlineUserList.includes(currentProfileUser);
      const dot = document.getElementById('profile-online-status');
      if (dot) dot.className = `status-dot ${isOnline ? 'online' : ''}`;
    }
    // Update conversations list if in messages view
    if (!document.getElementById('view-messages').classList.contains('hidden')) {
      loadConversations();
    }
  });

  socket.on('new_message', (msg) => {
    if (msg.sender !== currentUser) {
      showToast(`New message from ${msg.sender}`);
      if (currentChatUser === msg.sender) loadChatMessages();
    }
  });

  socket.on('new_notification', (notif) => {
    showToast(getNotificationText(notif));
    checkNotifications();
  });
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.backgroundColor = '#000';
  toast.style.color = '#fff';
  toast.style.padding = '10px 20px';
  toast.style.borderRadius = '5px';
  toast.style.zIndex = '9999';
  toast.style.fontSize = '14px';
  toast.style.boxShadow = '0 2px 10px rgba(0,0,0,0.2)';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function getNotificationText(n) {
  if (n.type === 'like') return `${n.fromUser} liked your echo`;
  if (n.type === 'follow') return `${n.fromUser} followed you`;
  if (n.type === 'comment') return `${n.fromUser} commented on your echo`;
  return 'New notification';
}

const isAdmin = localStorage.getItem('echogram_admin') === 'true';
let currentUserAvatar = localStorage.getItem('echogram_avatar') || '';

if (!currentUser && window.location.pathname !== '/login.html') {
  window.location.href = '/login.html';
}

const defaultAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// App State
let appUsers = [];
let currentChatUser = null;
let currentProfileUser = null;
let myFollowing = [];
let myBlocked = [];

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  if (!currentUser) return;
  
  document.getElementById('current-username-desktop').textContent = currentUser;
  
  // Navigation
  const navLinks = document.querySelectorAll('.nav-links li');
  navLinks.forEach(link => {
    link.addEventListener('click', () => {
      const view = link.dataset.view;
      // sync all navs
      document.querySelectorAll(`[data-view="${view}"]`).forEach(l => {
        document.querySelectorAll(`.nav-links li`).forEach(nl => nl.classList.remove('active'));
        l.classList.add('active');
      });
      switchView(view);
    });
  });

  document.querySelectorAll('.logout-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.clear();
      window.location.href = '/login.html';
    });
  });

  // Profile Tabs Navigation
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.profile-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.ptab-content').forEach(c => c.classList.add('hidden'));
      tab.classList.add('active');
      document.getElementById(`ptab-${tab.dataset.ptab}`).classList.remove('hidden');
    });
  });

  document.getElementById('back-to-convos').addEventListener('click', () => {
    document.getElementById('chat-area').classList.add('hidden');
  });

  // Dark Mode Toggle
  const applyDarkMode = (isDark) => {
    if (isDark) {
      document.body.classList.add('dark-mode');
      document.querySelectorAll('#dark-mode-toggle i, #dark-mode-toggle-mobile i').forEach(i => {
        i.classList.remove('fa-moon');
        i.classList.add('fa-sun');
      });
    } else {
      document.body.classList.remove('dark-mode');
      document.querySelectorAll('#dark-mode-toggle i, #dark-mode-toggle-mobile i').forEach(i => {
        i.classList.remove('fa-sun');
        i.classList.add('fa-moon');
      });
    }
  };

  const savedDarkMode = localStorage.getItem('echogram_dark_mode') === 'true';
  applyDarkMode(savedDarkMode);

  const toggleDarkMode = () => {
    const isDark = document.body.classList.toggle('dark-mode');
    localStorage.setItem('echogram_dark_mode', isDark);
    applyDarkMode(isDark);
  };

  document.getElementById('dark-mode-toggle').addEventListener('click', toggleDarkMode);
  document.getElementById('dark-mode-toggle-mobile').addEventListener('click', toggleDarkMode);

  await loadCurrentUserProfile();
  loadFeed();
  startNotificationPolling();
});

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${viewId}`).classList.remove('hidden');
  
  if (viewId === 'home') loadFeed();
  if (viewId === 'search') document.getElementById('search-input').focus();
  if (viewId === 'notifications') {
    loadNotifications();
    // Mark notifications as read when opening the view
    fetchAPI('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ username: currentUser })
    }).then(() => {
      document.getElementById('notif-badge-desktop').classList.add('hidden');
      document.getElementById('notif-badge-mobile').classList.add('hidden');
      document.querySelectorAll('.notification-item.unread').forEach(el => el.classList.remove('unread'));
    }).catch(console.error);
  }
  if (viewId === 'messages') {
    document.getElementById('chat-area').classList.add('hidden'); // Reset to list on mobile
    loadConversations();
  }
  if (viewId === 'profile') loadProfile(currentUser);
}

// --- API Helpers ---
async function fetchAPI(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// --- Home & Feed ---
async function loadFeed() {
  try {
    const echoes = await fetchAPI(`/api/echoes?username=${currentUser}&currentUser=${currentUser}`);
    renderFeed(echoes, document.getElementById('feed-container'));
  } catch (err) {
    console.error(err);
  }
}

function renderFeed(echoes, container) {
  container.innerHTML = '';
  echoes.forEach(echo => {
    const echoEl = document.createElement('div');
    echoEl.className = 'echo-post';
    
    const isLiked = echo.likedBy.includes(currentUser);
    const isFollowing = myFollowing.includes(echo.author);
    
    let followBtnHtml = '';
    if (echo.author !== currentUser) {
      followBtnHtml = `<button class="feed-follow-btn outline-btn" onclick="toggleFollow('${echo.author}', ${isFollowing})">${isFollowing ? 'Following' : 'Follow'}</button>`;
    }
    
    echoEl.innerHTML = `
      <img class="echo-avatar" src="${defaultAvatar}" alt="Avatar" onclick="loadProfile('${echo.author}')">
      <div class="echo-content">
        <div class="echo-header">
          <div>
             <span class="echo-author" onclick="loadProfile('${echo.author}')">${echo.author} <span class="verified-badge-inline hidden">✓</span></span>
             <span class="echo-time">${new Date(echo.createdAt).toLocaleString()}</span>
          </div>
          ${followBtnHtml}
        </div>
        <div class="echo-text">${escapeHTML(echo.text)}</div>
        ${echo.image ? `<img src="${echo.image}" class="echo-image">` : ''}
        <div class="echo-actions">
          <button class="echo-action ${isLiked ? 'liked' : ''}" onclick="toggleLike('${echo._id}')">
            <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i> ${echo.likedBy.length}
          </button>
          <button class="echo-action" onclick="toggleComments('${echo._id}')">
            <i class="fa-regular fa-comment"></i> ${echo.comments.length}
          </button>
          <button class="echo-action" onclick="openSaveToCollection('${echo._id}')">
            <i class="fa-regular fa-bookmark"></i>
          </button>
          ${isAdmin ? `<button class="echo-action delete-btn" onclick="deleteEcho('${echo._id}')"><i class="fa-solid fa-trash"></i></button>` : ''}
        </div>
        <div id="comments-${echo._id}" class="comments-section hidden">
          <div class="comments-list" id="comments-list-${echo._id}">
            ${renderCommentsHTML(echo.comments, echo._id)}
          </div>
          <div class="comment-input-area">
            <input type="text" id="comment-input-${echo._id}" placeholder="Add a comment...">
            <button class="outline-btn" onclick="postComment('${echo._id}')">Post</button>
          </div>
        </div>
      </div>
    `;
    
    // Fetch author details async
    fetchAPI(`/api/users/${echo.author}?currentUser=${currentUser}`).then(u => {
      if (u.avatar) echoEl.querySelector('.echo-avatar').src = u.avatar;
      if (u.isAdmin) echoEl.querySelector('.verified-badge-inline').classList.remove('hidden');
    }).catch(()=>{});

    container.appendChild(echoEl);
  });
}

function renderCommentsHTML(comments, echoId) {
  return comments.map(c => {
    const isLiked = c.likes.includes(currentUser);
    const isDisliked = c.dislikes.includes(currentUser);
    
    const repliesHtml = (c.replies || []).map(r => `
      <div class="comment reply" style="margin-left: 40px; border-left: 1px solid var(--border-color); padding-left: 10px; margin-top: 10px;">
        <img class="comment-avatar" src="${r.authorAvatar || defaultAvatar}" alt="Avatar" style="width: 24px; height: 24px;">
        <div class="comment-body">
          <div class="comment-header">
            <span class="comment-author">${r.author} ${r.authorIsAdmin ? '<span class="verified-badge-inline">✓</span>' : ''}</span>
            <span class="comment-time">${new Date(r.createdAt).toLocaleDateString()}</span>
          </div>
          <div class="comment-text">${escapeHTML(r.text)}</div>
        </div>
      </div>
    `).join('');

    return `
      <div class="comment-wrapper" style="margin-bottom: 20px;">
        <div class="comment">
          <img class="comment-avatar" src="${c.authorAvatar || defaultAvatar}" alt="Avatar" onclick="loadProfile('${c.author}')">
          <div class="comment-body">
            <div class="comment-header">
              <span class="comment-author" onclick="loadProfile('${c.author}')">${c.author} ${c.authorIsAdmin ? '<span class="verified-badge-inline">✓</span>' : ''}</span>
              <span class="comment-time">${new Date(c.createdAt).toLocaleDateString()}</span>
            </div>
            <div class="comment-text">${escapeHTML(c.text)}</div>
            <div class="comment-actions">
               <button class="comment-action ${isLiked ? 'active' : ''}" onclick="reactComment('${echoId}', '${c._id}', 'like')">
                  <i class="${isLiked ? 'fa-solid' : 'fa-regular'} fa-heart"></i> ${c.likes.length}
               </button>
               <button class="comment-action ${isDisliked ? 'active' : ''}" onclick="reactComment('${echoId}', '${c._id}', 'dislike')">
                  <i class="${isDisliked ? 'fa-solid' : 'fa-regular'} fa-thumbs-down"></i> ${c.dislikes.length}
               </button>
               <button class="comment-action" onclick="toggleReplyInput('${c._id}')">
                  <i class="fa-solid fa-reply"></i> Reply
               </button>
            </div>
            <div id="reply-input-${c._id}" class="comment-input-area hidden" style="margin-top: 5px;">
              <input type="text" id="reply-text-${c._id}" placeholder="Write a reply..." style="font-size: 0.85rem; border: 1px solid var(--border-color); padding: 5px; outline: none; width: 100%;">
              <button class="outline-btn" style="padding: 4px 8px; font-size: 0.8rem; margin-top: 5px;" onclick="postReply('${echoId}', '${c._id}')">Post Reply</button>
            </div>
          </div>
        </div>
        ${repliesHtml}
      </div>
    `;
  }).join('');
}

// --- Compose Echo ---
document.getElementById('echo-image-upload').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      document.getElementById('image-preview').src = evt.target.result;
      document.getElementById('image-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('remove-image-btn').addEventListener('click', () => {
  document.getElementById('echo-image-upload').value = '';
  document.getElementById('image-preview-container').classList.add('hidden');
});

document.getElementById('post-echo-btn').addEventListener('click', async () => {
  const textInput = document.getElementById('echo-text');
  const fileInput = document.getElementById('echo-image-upload');
  
  if (!textInput.value.trim() && !fileInput.files[0]) return;
  
  const formData = new FormData();
  formData.append('text', textInput.value.trim());
  formData.append('author', currentUser);
  if (fileInput.files[0]) {
    formData.append('image', fileInput.files[0]);
  }
  
  try {
    const res = await fetch('/api/echoes', {
      method: 'POST',
      body: formData
    });
    if (!res.ok) throw new Error('Upload failed');
    textInput.value = '';
    document.getElementById('remove-image-btn').click();
    loadFeed();
  } catch (err) {
    alert('Failed to post echo');
  }
});

// --- Echo Actions ---
async function toggleLike(echoId) {
  try {
    await fetchAPI(`/api/echoes/${echoId}/like`, {
      method: 'POST',
      body: JSON.stringify({ username: currentUser })
    });
    if (!document.getElementById('view-home').classList.contains('hidden')) loadFeed();
    else if (!document.getElementById('view-profile').classList.contains('hidden')) loadProfile(currentProfileUser);
  } catch (err) {
    console.error(err);
  }
}

function toggleComments(echoId) {
  document.getElementById(`comments-${echoId}`).classList.toggle('hidden');
}

async function postComment(echoId) {
  const input = document.getElementById(`comment-input-${echoId}`);
  const text = input.value.trim();
  if (!text) return;
  
  try {
    const updatedEcho = await fetchAPI(`/api/echoes/${echoId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ author: currentUser, authorAvatar: currentUserAvatar, text })
    });
    // Immediately update UI
    document.getElementById(`comments-list-${echoId}`).innerHTML = renderCommentsHTML(updatedEcho.comments, echoId);
    input.value = '';
  } catch (err) {
    console.error(err);
  }
}

function toggleReplyInput(commentId) {
  const input = document.getElementById(`reply-input-${commentId}`);
  input.classList.toggle('hidden');
  if (!input.classList.contains('hidden')) {
    document.getElementById(`reply-text-${commentId}`).focus();
  }
}

async function postReply(echoId, commentId) {
  const input = document.getElementById(`reply-text-${commentId}`);
  const text = input.value.trim();
  if (!text) return;
  
  try {
    const updatedEcho = await fetchAPI(`/api/echoes/${echoId}/comments/${commentId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ author: currentUser, authorAvatar: currentUserAvatar, text })
    });
    document.getElementById(`comments-list-${echoId}`).innerHTML = renderCommentsHTML(updatedEcho.comments, echoId);
  } catch (err) {
    console.error(err);
  }
}

async function reactComment(echoId, commentId, type) {
  try {
    const updatedEcho = await fetchAPI(`/api/comments/${echoId}/${commentId}/react`, {
      method: 'PUT',
      body: JSON.stringify({ username: currentUser, type })
    });
    document.getElementById(`comments-list-${echoId}`).innerHTML = renderCommentsHTML(updatedEcho.comments, echoId);
  } catch (err) {
    console.error(err);
  }
}

async function deleteEcho(echoId) {
  if (!confirm('Delete this echo?')) return;
  try {
    await fetchAPI(`/api/admin/delete/${echoId}`, {
      method: 'DELETE',
      body: JSON.stringify({ username: currentUser })
    });
    if (!document.getElementById('view-home').classList.contains('hidden')) loadFeed();
    else if (!document.getElementById('view-profile').classList.contains('hidden')) loadProfile(currentProfileUser);
  } catch (err) {
    alert('Not authorized');
  }
}

// --- Search ---
let searchTimeout;
document.getElementById('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => performSearch(e.target.value.trim()), 300);
});

async function performSearch(query) {
  if (!query) {
    document.getElementById('search-results-users').innerHTML = '';
    document.getElementById('search-results-echoes').innerHTML = '';
    return;
  }
  
  try {
    const data = await fetchAPI(`/api/search?q=${encodeURIComponent(query)}&currentUser=${currentUser}`);
    
    // Render Users
    const usersContainer = document.getElementById('search-results-users');
    usersContainer.innerHTML = data.users.length ? '<h3>Users</h3>' : '';
    data.users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'user-item';
      
      const isFollowing = myFollowing.includes(u.username);
      let btnHtml = '';
      if (u.username !== currentUser) {
        btnHtml = `<button class="outline-btn" onclick="event.stopPropagation(); toggleFollow('${u.username}', ${isFollowing}); performSearch('${query}')">${isFollowing ? 'Following' : 'Follow'}</button>`;
      }
      
      el.innerHTML = `
        <div class="user-item-info">
          <img src="${u.avatar || defaultAvatar}">
          <div class="user-item-details">
            <span class="username">${u.username} ${u.isAdmin ? '<span class="verified-badge-inline">✓</span>' : ''}</span>
            <span class="bio">${u.bio ? escapeHTML(u.bio).substring(0, 50) + '...' : ''}</span>
          </div>
        </div>
        <div class="user-item-actions">${btnHtml}</div>
      `;
      el.onclick = () => {
        document.querySelector('[data-view="profile"]').click();
        loadProfile(u.username);
      };
      usersContainer.appendChild(el);
    });
    
    // Render Echoes
    const echoesContainer = document.getElementById('search-results-echoes');
    echoesContainer.innerHTML = data.echoes.length ? '<h3>Echoes</h3>' : '';
    renderFeed(data.echoes, echoesContainer);
    
  } catch (err) {
    console.error(err);
  }
}

async function editUsername() {
  const newUsername = prompt("Enter your new username:", currentUser);
  if (!newUsername || newUsername === currentUser) return;
  
  try {
    const res = await fetch('/api/users/update-username', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldUsername: currentUser, newUsername })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    
    // Update local state
    localStorage.setItem('echogram_user', newUsername);
    location.reload(); // Refresh to update all references
  } catch (err) {
    alert("Error: " + err.message);
  }
}

// --- Notifications ---
async function startNotificationPolling() {
  setInterval(checkNotifications, 5000);
  checkNotifications();
}

async function checkNotifications() {
  try {
    const notifs = await fetchAPI(`/api/notifications/${currentUser}`);
    const unread = notifs.filter(n => !n.isRead).length;
    const desktopBadge = document.getElementById('notif-badge-desktop');
    const mobileBadge = document.getElementById('notif-badge-mobile');
    
    if (unread > 0) {
      desktopBadge.textContent = unread;
      desktopBadge.classList.remove('hidden');
      mobileBadge.textContent = unread;
      mobileBadge.classList.remove('hidden');
    } else {
      desktopBadge.classList.add('hidden');
      mobileBadge.classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadNotifications() {
  try {
    const notifs = await fetchAPI(`/api/notifications/${currentUser}`);
    const container = document.getElementById('notifications-container');
    container.innerHTML = '';
    
    if (notifs.length === 0) {
      container.innerHTML = '<p style="padding: 20px; color: #666;">No notifications yet.</p>';
      return;
    }
    
    notifs.forEach(n => {
      const el = document.createElement('div');
      el.className = `notification-item ${n.isRead ? '' : 'unread'}`;
      
      let icon = '';
      let text = '';
      if (n.type === 'like') { icon = '<i class="fa-solid fa-heart"></i>'; text = `<b>${n.fromUser}</b> liked your echo.`; }
      if (n.type === 'follow') { icon = '<i class="fa-solid fa-user-plus"></i>'; text = `<b>${n.fromUser}</b> followed you.`; }
      if (n.type === 'comment') { icon = '<i class="fa-solid fa-comment"></i>'; text = `<b>${n.fromUser}</b> commented on your echo.`; }
      if (n.type === 'message') { icon = '<i class="fa-solid fa-envelope"></i>'; text = `<b>${n.fromUser}</b> sent you a message.`; }
      
      el.innerHTML = `
        ${icon}
        <div class="notification-content">${text}</div>
        <div class="echo-time">${new Date(n.createdAt).toLocaleDateString()}</div>
      `;
      
      el.onclick = () => {
        if (n.type === 'message') {
          document.querySelector('[data-view="messages"]').click();
          openChat(n.fromUser);
        } else {
          document.querySelector('[data-view="profile"]').click();
          loadProfile(n.fromUser);
        }
      };
      
      container.appendChild(el);
    });
    
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('mark-read-btn').addEventListener('click', async () => {
  try {
    await fetchAPI('/api/notifications/read', {
      method: 'POST',
      body: JSON.stringify({ username: currentUser })
    });
    loadNotifications();
    checkNotifications();
  } catch (err) {
    console.error(err);
  }
});

// --- Messages ---
let chatInterval;

async function loadConversations() {
  try {
    const chatUsers = await fetchAPI(`/api/conversations/${currentUser}`);
    const list = document.getElementById('conversations-list');
    list.innerHTML = '';
    
    if (chatUsers.length === 0) {
      list.innerHTML = '<p style="padding:20px; color:#666;">No active conversations.</p>';
      return;
    }

    chatUsers.forEach(u => {
      const el = document.createElement('div');
      el.className = 'user-item';
      const isOnline = onlineUserList.includes(u.username);
      
      el.innerHTML = `
        <div class="user-item-info">
          <div style="position:relative;">
             <img src="${u.avatar || defaultAvatar}">
             <span class="status-dot ${isOnline ? 'online' : ''}" style="position:absolute; bottom:0; right:0; border: 1px solid white;"></span>
          </div>
          <span>${u.username}</span>
        </div>
      `;
      el.onclick = () => openChat(u.username);
      list.appendChild(el);
    });
  } catch (err) {
    console.error(err);
  }
}

function openChat(username) {
  currentChatUser = username;
  document.getElementById('chat-area').classList.remove('hidden');
  document.getElementById('chat-with-username').textContent = username;
  
  const isOnline = onlineUserList.includes(username);
  const dot = document.getElementById('chat-online-status');
  if (dot) dot.className = `status-dot ${isOnline ? 'online' : ''}`;
  
  if (chatInterval) clearInterval(chatInterval);
  loadChatMessages();
  chatInterval = setInterval(loadChatMessages, 3000);
}

async function loadChatMessages() {
  if (!currentChatUser) return;
  try {
    const msgs = await fetchAPI(`/api/messages/${currentUser}/${currentChatUser}`);
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    
    msgs.forEach(m => {
      const isSent = m.sender === currentUser;
      const el = document.createElement('div');
      el.className = `message-bubble ${isSent ? 'message-sent' : 'message-received'}`;
      
      let seenHtml = '';
      if (isSent) {
        seenHtml = `<div class="message-seen">${m.isSeen ? '✓✓' : '✓'}</div>`;
      }
      
      el.innerHTML = `
        <div>${escapeHTML(m.text)}</div>
        ${seenHtml}
      `;
      container.appendChild(el);
    });
    
    container.scrollTop = container.scrollHeight;
    
    // Mark as seen
    await fetchAPI('/api/messages/seen', {
      method: 'POST',
      body: JSON.stringify({ sender: currentChatUser, receiver: currentUser })
    });
    
  } catch (err) {
    console.error(err);
  }
}

document.getElementById('send-message-btn').addEventListener('click', sendMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

async function sendMessage() {
  const input = document.getElementById('message-input');
  const text = input.value.trim();
  if (!text || !currentChatUser) return;
  
  try {
    await fetchAPI('/api/messages', {
      method: 'POST',
      body: JSON.stringify({ sender: currentUser, receiver: currentChatUser, text })
    });
    input.value = '';
    loadChatMessages();
  } catch (err) {
    console.error(err);
  }
}

// --- Profile & Settings ---
async function loadCurrentUserProfile() {
  try {
    const user = await fetchAPI(`/api/users/${currentUser}`);
    myFollowing = user.following || [];
    myBlocked = user.blocked || [];
    
    if (user.avatar) {
      currentUserAvatar = user.avatar;
      localStorage.setItem('echogram_avatar', user.avatar);
      document.getElementById('current-user-avatar-desktop').src = user.avatar;
      document.getElementById('compose-avatar').src = user.avatar;
      document.getElementById('settings-avatar-upload').dataset.current = user.avatar;
    }
    document.getElementById('settings-bio').value = user.bio || '';
    document.getElementById('settings-show-online').checked = user.settings.showOnline;
    document.getElementById('settings-show-seen').checked = user.settings.showSeen;
  } catch (err) {
    console.error(err);
  }
}

async function loadProfile(username) {
  currentProfileUser = username;
  document.querySelectorAll('[data-view="profile"]').forEach(l => l.classList.add('active'));
  document.querySelector('[data-ptab="echoes"]').click(); // Reset to Echoes tab
  
  try {
    const user = await fetchAPI(`/api/users/${username}?currentUser=${currentUser}`);
    
    document.getElementById('profile-title').textContent = username;
    document.getElementById('profile-username').innerHTML = `
      ${username} 
      ${user.isAdmin ? '<span class="verified-badge-inline">✓</span>' : ''}
      ${username === currentUser ? '<i class="fa-solid fa-pen-to-square edit-icon" onclick="editUsername()" style="font-size: 1rem; cursor: pointer; margin-left: 10px;"></i>' : ''}
    `;
    document.getElementById('profile-avatar').src = user.avatar || defaultAvatar;
    document.getElementById('profile-bio').textContent = user.bio || '';
    
    // Set online status in profile header
    const isOnline = onlineUserList.includes(username);
    const profileDot = document.getElementById('profile-online-status');
    if (profileDot) {
      profileDot.className = `status-dot ${isOnline ? 'online' : ''}`;
    }
    document.getElementById('profile-following-count').textContent = user.following.length;
    document.getElementById('profile-followers-count').textContent = user.followers.length;
    
    // Actions
    const editBtn = document.getElementById('edit-profile-btn');
    const followBtn = document.getElementById('follow-btn');
    const blockBtn = document.getElementById('block-btn');
    
    if (username === currentUser) {
      editBtn.classList.remove('hidden');
      followBtn.classList.add('hidden');
      blockBtn.classList.add('hidden');
      editBtn.onclick = () => document.querySelector('[data-view="settings"]').click();
    } else {
      editBtn.classList.add('hidden');
      followBtn.classList.remove('hidden');
      blockBtn.classList.remove('hidden');
      
      const isFollowing = myFollowing.includes(username);
      followBtn.textContent = isFollowing ? 'Unfollow' : 'Follow';
      followBtn.className = isFollowing ? 'outline-btn' : 'primary-btn';
      followBtn.onclick = async () => {
        await toggleFollow(username, isFollowing);
        loadProfile(username);
      };
      
      const isBlocked = myBlocked.includes(username);
      blockBtn.textContent = isBlocked ? 'Unblock' : 'Block';
      blockBtn.onclick = async () => {
        if (!confirm(`Are you sure you want to ${isBlocked ? 'unblock' : 'block'} ${username}?`)) return;
        await toggleBlock(username, isBlocked);
        if(!isBlocked) {
          // If we just blocked them, kick back to home
          document.querySelector('[data-view="home"]').click();
        } else {
          loadProfile(username);
        }
      };
    }
    
    // Load Tab Data
    const res = await fetch(`/api/search?q=${username}&currentUser=${currentUser}`);
    const data = await res.json();
    const userEchoes = data.echoes.filter(e => e.author === username);
    renderFeed(userEchoes, document.getElementById('profile-feed-container'));
    
    renderUserList(user.followers, document.getElementById('profile-followers-list'), username === currentUser ? 'follower' : null);
    renderUserList(user.following, document.getElementById('profile-following-list'), null);
    loadCollections(username);
  } catch (err) {
    if (err.message.includes('blocked')) {
      alert('This user is unavailable.');
      document.querySelector('[data-view="home"]').click();
    }
  }
}

async function renderUserList(usernames, container, mode) {
  container.innerHTML = '';
  if (usernames.length === 0) {
    container.innerHTML = '<p style="padding:20px; color:#666;">Nothing to see here.</p>';
    return;
  }
  
  for (let uname of usernames) {
    try {
      const u = await fetchAPI(`/api/users/${uname}?currentUser=${currentUser}`);
      const el = document.createElement('div');
      el.className = 'user-item';
      
      let actionsHtml = '';
      if (mode === 'follower') {
        actionsHtml = `
          <div class="user-item-actions">
            <button class="outline-btn" onclick="event.stopPropagation(); removeFollower('${u.username}')">Remove</button>
            <button class="outline-btn" style="border-color:#000; color:#000;" onclick="event.stopPropagation(); toggleBlock('${u.username}', false); document.querySelector('[data-view=\\'home\\']').click();">Block</button>
          </div>
        `;
      }
      
      el.innerHTML = `
        <div class="user-item-info">
          <img src="${u.avatar || defaultAvatar}">
          <span>${u.username}</span>
        </div>
        ${actionsHtml}
      `;
      el.onclick = () => loadProfile(u.username);
      container.appendChild(el);
    } catch(err) {
      // User might be blocked, skip rendering them
    }
  }
}

async function toggleFollow(username, isFollowing) {
  try {
    await fetchAPI('/api/follow', {
      method: 'POST',
      body: JSON.stringify({ follower: currentUser, following: username, action: isFollowing ? 'unfollow' : 'follow' })
    });
    if (isFollowing) {
      myFollowing = myFollowing.filter(u => u !== username);
    } else {
      myFollowing.push(username);
    }
    if (!document.getElementById('view-home').classList.contains('hidden')) loadFeed();
  } catch (err) {
    console.error(err);
  }
}

async function removeFollower(followerUsername) {
  if (!confirm(`Remove ${followerUsername} from your followers?`)) return;
  try {
    await fetchAPI('/api/users/remove-follower', {
      method: 'POST',
      body: JSON.stringify({ currentUser, followerToRemove: followerUsername })
    });
    loadProfile(currentUser);
  } catch (err) {
    console.error(err);
  }
}

async function toggleBlock(username, isBlocked) {
  try {
    await fetchAPI(isBlocked ? '/api/users/unblock' : '/api/users/block', {
      method: 'POST',
      body: JSON.stringify({ currentUser, [isBlocked ? 'userToUnblock' : 'userToBlock']: username })
    });
    await loadCurrentUserProfile();
  } catch (err) {
    console.error(err);
  }
}

// Settings Update
document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const bio = document.getElementById('settings-bio').value;
  const showOnline = document.getElementById('settings-show-online').checked;
  const showSeen = document.getElementById('settings-show-seen').checked;
  
  const fileInput = document.getElementById('settings-avatar-upload');
  
  try {
    // 1. Update Profile (Bio and Settings)
    await fetchAPI('/api/update-profile', {
      method: 'POST',
      body: JSON.stringify({ 
        username: currentUser, 
        bio, 
        settings: { showOnline, showSeen } 
      })
    });

    // 2. Upload Avatar if a file is selected
    if (fileInput.files[0]) {
      const formData = new FormData();
      formData.append('username', currentUser);
      formData.append('avatar', fileInput.files[0]);

      const res = await fetch('/api/upload-avatar', {
        method: 'POST',
        body: formData
      });
      if (!res.ok) throw new Error('Avatar upload failed');
    }

    alert('Settings saved!');
    loadCurrentUserProfile();
  } catch (err) {
    console.error(err);
    alert('Error saving settings: ' + err.message);
  }
});

async function openSaveToCollection(echoId) {
  try {
    const collections = await fetchAPI(`/api/collections/${currentUser}`);
    let collOptions = collections.map((c, i) => `${i+1}. ${c.name}`).join('\n');
    let promptMsg = "Save to collection:\n" + (collOptions || "No collections yet.") + "\n\nType the name to save, or type a new name to create one:";
    
    let choice = prompt(promptMsg);
    if (!choice) return;

    const existing = collections.find(c => c.name.toLowerCase() === choice.toLowerCase());
    
    if (existing) {
      await fetchAPI(`/api/collections/${existing._id}/save`, {
        method: 'PUT',
        body: JSON.stringify({ echoId })
      });
      alert('Saved to ' + existing.name);
    } else {
      const newColl = await fetchAPI('/api/collections', {
        method: 'POST',
        body: JSON.stringify({ name: choice, owner: currentUser })
      });
      await fetchAPI(`/api/collections/${newColl._id}/save`, {
        method: 'PUT',
        body: JSON.stringify({ echoId })
      });
      alert('Created and saved to ' + newColl.name);
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadCollections(username) {
  const container = document.getElementById('profile-collections-grid');
  container.innerHTML = '';
  try {
    const collections = await fetchAPI(`/api/collections/${username}`);
    if (collections.length === 0) {
      container.innerHTML = '<p style="padding:20px; color:#666;">No collections yet.</p>';
      return;
    }

    collections.forEach(c => {
      const el = document.createElement('div');
      el.className = 'collection-item';
      el.innerHTML = `
        <div class="collection-square">
          <i class="fa-solid fa-folder"></i>
          <span class="collection-count">${c.echoes.length}</span>
        </div>
        <div class="collection-name">${c.name}</div>
      `;
      el.onclick = () => loadCollectionDetail(c._id);
      container.appendChild(el);
    });
  } catch (err) {
    console.error(err);
  }
}

async function loadCollectionDetail(id) {
  try {
    const coll = await fetchAPI(`/api/collections/id/${id}`);
    const container = document.getElementById('profile-collections-grid');
    container.innerHTML = `
      <div style="width: 100%; padding: 10px; border-bottom: 1px solid var(--border-color); margin-bottom: 10px; display: flex; align-items: center; gap: 10px;">
        <i class="fa-solid fa-arrow-left" style="cursor:pointer;" onclick="loadCollections('${currentProfileUser}')"></i>
        <h3 style="margin:0;">${coll.name}</h3>
      </div>
      <div id="collection-echoes-container"></div>
    `;
    renderFeed(coll.echoes, document.getElementById('collection-echoes-container'));
  } catch (err) {
    console.error(err);
  }
}

// Helpers
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag])
  );
}
