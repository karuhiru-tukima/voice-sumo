/* Firebase Realtime Database transport. Microphone audio never leaves the device. */
(function (global) {
  'use strict';
  class Events {
    constructor() { this.handlers = new Map(); }
    on(name, fn) {
      if (!this.handlers.has(name)) this.handlers.set(name, []);
      this.handlers.get(name).push(fn);
      return this;
    }
    emit(name, value) { for (const fn of this.handlers.get(name) || []) fn(value); }
  }
  class Connection extends Events {
    constructor(owner, id, side) {
      super(); this.owner = owner; this.id = id; this.side = side;
      this.open = false; this.closed = false; this.seq = 0;
      this.seen = {}; this.pending = {}; this.sending = false;
      this.timer = null; this.lastSent = 0; this.ref = owner.db.ref('voiceSumoLinks/' + id);
      owner.connections.add(this);
    }
    async listen() {
      if (this.closed) return;
      this.disconnect = this.ref.onDisconnect();
      await this.disconnect.remove();
      if (this.closed) { this.ref.remove().catch(() => {}); return; }
      this.listener = snapshot => {
        if (this.closed) return;
        const value = snapshot.val();
        if (!value) { this.finish(); return; }
        if (value.status === 'connected' && !this.open) {
          this.open = true; this.emit('open');
        }
        if (!this.open || this.closed) return;
        const packets = value[this.side === 'a' ? 'bPackets' : 'aPackets'] || {};
        Object.entries(packets).sort((x, y) => x[1].seq - y[1].seq).forEach(([type, packet]) => {
          if (this.closed || !packet || packet.seq <= (this.seen[type] || 0)) return;
          this.seen[type] = packet.seq; this.emit('data', packet.data);
        });
      };
      this.ref.on('value', this.listener, error => {
        if (!this.closed) { this.emit('error', error); this.finish(); }
      });
    }
    send(data) {
      if (!this.open || this.closed || !data || !['hello','state','vol','ready','full'].includes(data.t)) return;
      this.pending[data.t] = {seq: ++this.seq, data: JSON.parse(JSON.stringify(data))};
      this.schedule();
    }
    schedule() {
      if (this.closed || this.timer || this.sending || !Object.keys(this.pending).length) return;
      this.timer = setTimeout(() => this.flush(), Math.max(0, 100 - (Date.now() - this.lastSent)));
    }
    async flush() {
      this.timer = null;
      if (this.closed || !Object.keys(this.pending).length) return;
      const packet = this.pending; this.pending = {}; this.sending = true; this.lastSent = Date.now();
      try { await this.ref.child(this.side + 'Packets').update(packet); }
      catch (error) { if (!this.closed) { this.emit('error', error); this.close(); } }
      finally { this.sending = false; this.schedule(); }
    }
    finish() {
      if (this.closed) return;
      this.closed = true; this.open = false;
      clearTimeout(this.timer); this.pending = {};
      if (this.listener) this.ref.off('value', this.listener);
      this.owner.connections.delete(this);
      this.emit('close');
    }
    close() {
      if (this.closed) return;
      this.finish();
      this.ref.remove().then(() => this.disconnect && this.disconnect.cancel()).catch(() => {});
    }
  }
  class FirebaseRelayPeer extends Events {
    constructor(id) {
      super();
      const fb = global.firebase;
      if (!fb || !fb.apps.length || !fb.auth().currentUser || typeof fb.database !== 'function') {
        throw new Error('Firebaseに接続中です。少し待ってからお試しください。');
      }
      this.id = id || 'vs-' + global.crypto.randomUUID();
      this.uid = fb.auth().currentUser.uid; this.db = fb.database();
      this.destroyed = false; this.registered = false; this.connections = new Set();
      this.accepted = new Set(); this.ref = this.db.ref('voiceSumoPeers/' + this.id);
      this.ready = Promise.resolve().then(() => this.register()).catch(error => {
        if (!this.destroyed) this.emit('error', {type: error.type || 'network', message: error.message});
        return false;
      });
    }
    async register() {
      const result = await this.ref.transaction(value => value ? undefined : {
        uid: this.uid, createdAt: global.firebase.database.ServerValue.TIMESTAMP
      }, undefined, false);
      if (!result.committed) throw Object.assign(new Error('この部屋番号は使用中です'), {type:'unavailable-id'});
      this.registered = true;
      if (this.destroyed) { await this.ref.remove(); return false; }
      this.disconnect = this.ref.onDisconnect(); await this.disconnect.remove();
      if (this.destroyed) { await this.ref.remove(); return false; }
      this.inbox = this.ref.child('inbox');
      this.incoming = snapshot => this.accept(snapshot).catch(error => {
        if (!this.destroyed) this.emit('error', {type:'network', message:error.message});
      });
      this.inbox.on('child_added', this.incoming);
      let online = false;
      this.presence = this.db.ref('.info/connected');
      this.presenceListener = snapshot => {
        if (this.destroyed) return;
        if (snapshot.val()) online = true;
        else if (online) this.emit('error', {type:'network', message:'Firebaseとの接続が切れました'});
      };
      this.presence.on('value', this.presenceListener);
      this.emit('open', this.id); return true;
    }
    connect(target) {
      const ref = this.db.ref('voiceSumoLinks').push();
      const connection = new Connection(this, ref.key, 'a');
      this.startConnection(connection, target).catch(error => {
        if (!this.destroyed && !connection.closed) {
          this.emit('error', {type:error.type || 'network', message:error.message});
          connection.close();
        }
      });
      return connection;
    }
    async startConnection(connection, target) {
      if (!await this.ready || this.destroyed || connection.closed) return;
      const targetRef = this.db.ref('voiceSumoPeers/' + target);
      const targetData = (await targetRef.once('value')).val();
      if (this.destroyed || connection.closed) return;
      if (!targetData) throw Object.assign(new Error('部屋が見つかりません'), {type:'peer-unavailable'});
      await connection.ref.set({
        aUid:this.uid, bUid:targetData.uid, aId:this.id, bId:target,
        createdAt:global.firebase.database.ServerValue.TIMESTAMP, status:'opening'
      });
      if (this.destroyed || connection.closed) { await connection.ref.remove(); return; }
      await connection.listen();
      if (this.destroyed || connection.closed) return;
      await targetRef.child('inbox/' + connection.id).set({fromUid:this.uid, fromId:this.id});
    }
    async accept(snapshot) {
      if (this.destroyed || this.accepted.has(snapshot.key)) return;
      this.accepted.add(snapshot.key);
      const ref = this.db.ref('voiceSumoLinks/' + snapshot.key);
      const data = (await ref.once('value')).val();
      if (this.destroyed) return;
      if (!data || data.bId !== this.id || data.bUid !== this.uid || data.aUid !== snapshot.val().fromUid) {
        await snapshot.ref.remove(); return;
      }
      const connection = new Connection(this, snapshot.key, 'b');
      this.emit('connection', connection);
      await connection.listen();
      if (!connection.closed && !this.destroyed) await ref.child('status').set('connected');
      await snapshot.ref.remove();
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      if (this.inbox && this.incoming) this.inbox.off('child_added', this.incoming);
      if (this.presence) this.presence.off('value', this.presenceListener);
      for (const connection of [...this.connections]) connection.close();
      if (this.registered) this.ref.remove().then(() => this.disconnect && this.disconnect.cancel()).catch(() => {});
    }
  }
  global.FirebaseRelayPeer = FirebaseRelayPeer;
})(window);
