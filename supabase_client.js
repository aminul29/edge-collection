/**
 * Supabase Client for Edge Collections Extension
 * Pure native fetch implementation tailored for Chrome/Edge MV3 Extensions.
 */

const SUPABASE_CONFIG = {
  url: 'https://vvrglnsrgbvmjllmnhrl.supabase.co',
  anonKey: 'sb_publishable_sI4aCxCvDacB17rIKHfTvw_LaNQu8zx',
  storageKey: 'supabase_session'
};

const SupabaseClient = {
  _session: null,
  _refreshPromise: null,

  async init() {
    try {
      const session = await this._loadSession();
      if (session) {
        this._session = session;
        // Check if token needs refresh
        if (Date.now() >= (this._session.expires_at - 60) * 1000) {
          await this.refreshSession().catch(() => this._clearSession());
        }
      }
    } catch (err) {
      console.warn('SupabaseClient init error:', err);
    }
    return this;
  },

  async _loadSession() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get([SUPABASE_CONFIG.storageKey]);
      return res[SUPABASE_CONFIG.storageKey] || null;
    }
    const raw = localStorage.getItem(SUPABASE_CONFIG.storageKey);
    return raw ? JSON.parse(raw) : null;
  },

  async _saveSession(session) {
    this._session = session;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [SUPABASE_CONFIG.storageKey]: session });
    } else {
      localStorage.setItem(SUPABASE_CONFIG.storageKey, JSON.stringify(session));
    }
  },

  async _clearSession() {
    this._session = null;
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove([SUPABASE_CONFIG.storageKey]);
    } else {
      localStorage.removeItem(SUPABASE_CONFIG.storageKey);
    }
  },

  async getSession() {
    if (!this._session) {
      this._session = await this._loadSession();
    }
    if (this._session && Date.now() >= (this._session.expires_at - 60) * 1000) {
      await this.refreshSession().catch(() => null);
    }
    return this._session;
  },

  async getUser() {
    const session = await this.getSession();
    return session ? session.user : null;
  },

  isAuthenticated() {
    return !!(this._session && this._session.access_token);
  },

  async refreshSession() {
    if (this._refreshPromise) return this._refreshPromise;

    if (!this._session || !this._session.refresh_token) {
      await this._clearSession();
      throw new Error('No refresh token available');
    }

    this._refreshPromise = (async () => {
      try {
        const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=refresh_token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_CONFIG.anonKey
          },
          body: JSON.stringify({ refresh_token: this._session.refresh_token })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error_description || data.message || 'Token refresh failed');
        }

        const newSession = {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + data.expires_in),
          user: data.user || this._session.user
        };

        await this._saveSession(newSession);
        return newSession;
      } finally {
        this._refreshPromise = null;
      }
    })();

    return this._refreshPromise;
  },

  /**
   * Register a new user with Email + Password and Gumroad Pro License Key
   */
  async signUp(email, password, licenseKey) {
    const cleanEmail = email.trim().toLowerCase();
    const cleanKey = licenseKey.trim();

    // 1. Create auth user in Supabase
    const authRes = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/signup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_CONFIG.anonKey
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: password,
        data: {
          gumroad_license_key: cleanKey
        }
      })
    });

    const authData = await authRes.json();
    if (!authRes.ok) {
      throw new Error(authData.error_description || authData.msg || authData.message || 'Signup failed');
    }

    // If session is returned immediately (confirm email disabled in Supabase)
    if (authData.access_token && authData.user) {
      const session = {
        access_token: authData.access_token,
        refresh_token: authData.refresh_token,
        expires_at: authData.expires_at || (Math.floor(Date.now() / 1000) + authData.expires_in),
        user: authData.user
      };
      await this._saveSession(session);

      // Create profile record
      await this.from('profiles').upsert([{
        id: authData.user.id,
        email: cleanEmail,
        gumroad_license_key: cleanKey,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }]).catch(err => console.warn('Could not create initial profile record:', err));

      return { user: authData.user, session };
    }

    return { user: authData.user || authData, session: null, requiresEmailConfirmation: true };
  },

  /**
   * Log in an existing user with Email + Password
   */
  async signIn(email, password) {
    const cleanEmail = email.trim().toLowerCase();
    const response = await fetch(`${SUPABASE_CONFIG.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_CONFIG.anonKey
      },
      body: JSON.stringify({
        email: cleanEmail,
        password: password
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error_description || data.message || 'Invalid email or password');
    }

    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + data.expires_in),
      user: data.user
    };

    await this._saveSession(session);
    return session;
  },

  async signOut() {
    try {
      if (this._session && this._session.access_token) {
        await fetch(`${SUPABASE_CONFIG.url}/auth/v1/logout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${this._session.access_token}`
          }
        }).catch(() => {});
      }
    } finally {
      await this._clearSession();
    }
  },

  /**
   * Query builder for Supabase REST API
   */
  from(tableName) {
    const client = this;

    return {
      async select(columns = '*', filters = {}) {
        const session = await client.getSession();
        const headers = {
          'apikey': SUPABASE_CONFIG.anonKey
        };
        if (session && session.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }

        const params = new URLSearchParams();
        params.append('select', columns);

        for (const [key, val] of Object.entries(filters)) {
          params.append(key, val);
        }

        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tableName}?${params.toString()}`, {
          method: 'GET',
          headers: headers
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to select from ${tableName} (Status: ${response.status})`);
        }

        return await response.json();
      },

      async upsert(records, onConflict = 'id') {
        if (!records || records.length === 0) return [];

        const session = await client.getSession();
        if (!session || !session.access_token) {
          throw new Error('Authentication required for write operations');
        }

        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tableName}?on_conflict=${encodeURIComponent(onConflict)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${session.access_token}`,
            'Prefer': 'resolution=merge-duplicates,return=representation'
          },
          body: JSON.stringify(records)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to upsert to ${tableName} (Status: ${response.status})`);
        }

        return await response.json();
      },

      async update(id, updates) {
        const session = await client.getSession();
        if (!session || !session.access_token) {
          throw new Error('Authentication required for update operations');
        }

        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tableName}?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${session.access_token}`,
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(updates)
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to update ${tableName} (Status: ${response.status})`);
        }

        return await response.json();
      },

      async delete(id) {
        const session = await client.getSession();
        if (!session || !session.access_token) {
          throw new Error('Authentication required for delete operations');
        }

        const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${tableName}?id=eq.${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${session.access_token}`
          }
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.message || `Failed to delete from ${tableName} (Status: ${response.status})`);
        }

        return true;
      }
    };
  }
};
