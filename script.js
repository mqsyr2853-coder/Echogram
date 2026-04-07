const currentUser = localStorage.getItem('echogram_user');
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

  await loadCurrentUserProfile();
  loadFeed();
  startNotificationPolling();
});

function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(`view-${viewId}`).classList.remove('hidden');
  
  if (viewId === 'home') loadFeed();
  if (viewId === 'search') document.getElementById('search-input').focus();
  if (viewId === 'notifications') loadNotifications();
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
             <span class="echo-author" onclick="loadProfile('${echo.author}')">${echo.author}</span>
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
    
    // Fetch author avatar async
    fetchAPI(`/api/users/${echo.author}?currentUser=${currentUser}`).then(u => {
      if (u.avatar) echoEl.querySelector('.echo-avatar').src = u.avatar;
    }).catch(()=>{});

    container.appendChild(echoEl);
  });
}

function renderCommentsHTML(comments, echoId) {
  return comments.map(c => {
    const isLiked = c.likes.includes(currentUser);
    const isDisliked = c.dislikes.includes(currentUser);
    return `
      <div class="comment">
        <img class="comment-avatar" src="${c.authorAvatar || defaultAvatar}" alt="Avatar" onclick="loadProfile('${c.author}')">
        <div class="comment-body">
          <div class="comment-header">
            <span class="comment-author" onclick="loadProfile('${c.author}')">${c.author}</span>
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
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// --- Compose Echo ---
let composeImageBase64 = '';

document.getElementById('echo-image-upload').addEventListener('change', function(e) {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = function(evt) {
      composeImageBase64 = evt.target.result;
      document.getElementById('image-preview').src = composeImageBase64;
      document.getElementById('image-preview-container').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
  }
});

document.getElementById('remove-image-btn').addEventListener('click', () => {
  composeImageBase64 = '';
  document.getElementById('echo-image-upload').value = '';
  document.getElementById('image-preview-container').classList.add('hidden');
});

document.getElementById('post-echo-btn').addEventListener('click', async () => {
  const text = document.getElementById('echo-text').value.trim();
  if (!text && !composeImageBase64) return;
  
  try {
    await fetchAPI('/api/echoes', {
      method: 'POST',
      body: JSON.stringify({ text, image: composeImageBase64, author: currentUser })
    });
    document.getElementById('echo-text').value = '';
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
          <span>${u.username}</span>
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
    appUsers = await fetchAPI(`/api/users?currentUser=${currentUser}`);
    const list = document.getElementById('conversations-list');
    list.innerHTML = '';
    
    appUsers.filter(u => u.username !== currentUser).forEach(u => {
      const el = document.createElement('div');
      el.className = 'user-item';
      const isOnline = u.settings.showOnline ? 'online' : ''; 
      
      el.innerHTML = `
        <div class="user-item-info">
          <div style="position:relative;">
             <img src="${u.avatar || defaultAvatar}">
             <span class="status-dot ${isOnline}" style="position:absolute; bottom:0; right:0; border: 1px solid white;"></span>
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
  
  const user = appUsers.find(u => u.username === username);
  if (user && user.settings.showOnline) {
    document.getElementById('chat-online-status').classList.add('online');
  } else {
    document.getElementById('chat-online-status').classList.remove('online');
  }
  
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
    document.getElementById('profile-username').innerHTML = `${username} ${user.isVerified || user.isAdmin ? '<i class="fa-solid fa-check verified-badge"></i>' : ''}`;
    document.getElementById('profile-avatar').src = user.avatar || defaultAvatar;
    document.getElementById('profile-bio').textContent = user.bio || '';
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
  let avatar = fileInput.dataset.current || '';
  
  if (fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      avatar = e.target.result;
      await saveSettings(bio, { showOnline, showSeen }, avatar);
    };
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    await saveSettings(bio, { showOnline, showSeen }, avatar);
  }
});

async function saveSettings(bio, settings, avatar) {
  try {
    await fetchAPI('/api/update-profile', {
      method: 'POST',
      body: JSON.stringify({ username: currentUser, bio, settings })
    });
    if (avatar) {
      await fetchAPI('/api/upload-avatar', {
        method: 'POST',
        body: JSON.stringify({ username: currentUser, avatar })
      });
    }
    alert('Settings saved!');
    loadCurrentUserProfile();
  } catch (err) {
    alert('Error saving settings');
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
