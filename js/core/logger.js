/* VLC Web — registro de mensagens (Ferramentas → Mensagens) */
(function (VW) {
  'use strict';
  const U = VW.util;

  const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

  class Logger extends U.Emitter {
    constructor(max = 3000) {
      super();
      this.max = max;
      this.items = [];
    }
    add(level, module, msg) {
      const entry = { time: new Date(), level, module: module || 'main', msg: String(msg) };
      this.items.push(entry);
      if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
      this.emit('message', entry);
      if (level === 'error') console.error(`[${entry.module}]`, msg);
      return entry;
    }
    error(module, msg) { return this.add('error', module, msg); }
    warn(module, msg) { return this.add('warn', module, msg); }
    info(module, msg) { return this.add('info', module, msg); }
    debug(module, msg) { return this.add('debug', module, msg); }
    clear() { this.items = []; this.emit('clear'); }
    filter(maxLevel) { return this.items.filter(e => LEVELS[e.level] <= LEVELS[maxLevel]); }
    toText(maxLevel = 'debug') {
      return this.filter(maxLevel).map(e => `${e.time.toISOString()} ${e.module} ${e.level}: ${e.msg}`).join('\n');
    }
  }
  Logger.LEVELS = LEVELS;

  VW.Logger = Logger;
})(window.VW = window.VW || {});
