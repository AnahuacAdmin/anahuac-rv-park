const API = {
  token: localStorage.getItem('rv_token'),
  user: JSON.parse(localStorage.getItem('rv_user') || 'null'),

  async request(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(`/api${url}`, { ...options, headers });
    if (res.status === 401) { this.logout(); return null; }
    if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error || 'Request failed'); }
    return res.json();
  },

  get(url) { return this.request(url); },
  post(url, data) { return this.request(url, { method: 'POST', body: JSON.stringify(data) }); },
  put(url, data) { return this.request(url, { method: 'PUT', body: JSON.stringify(data) }); },
  patch(url, data) { return this.request(url, { method: 'PATCH', body: JSON.stringify(data) }); },
  del(url) { return this.request(url, { method: 'DELETE' }); },

  async login(username, password) {
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) throw new Error('Invalid credentials');
    const data = await res.json();
    this.token = data.token;
    this.user = data.user;
    localStorage.setItem('rv_token', data.token);
    localStorage.setItem('rv_user', JSON.stringify(data.user));
    return data;
  },

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('rv_token');
    localStorage.removeItem('rv_user');
    document.getElementById('login-screen').style.display = '';
    document.getElementById('main-app').style.display = 'none';
    document.body.classList.add('login-page');
  }
};
