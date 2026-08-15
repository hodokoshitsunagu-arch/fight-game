export class AnnouncementSystem {
  constructor(root = document.body) {
    this.root = document.createElement('div');
    this.root.className = 'game-announcement';
    this.root.setAttribute('aria-live', 'assertive');
    this.root.innerHTML = '<div class="game-announcement__eyebrow"></div><div class="game-announcement__main"></div><div class="game-announcement__zh"></div>';
    root.appendChild(this.root);
    this.eyebrow = this.root.querySelector('.game-announcement__eyebrow');
    this.main = this.root.querySelector('.game-announcement__main');
    this.zh = this.root.querySelector('.game-announcement__zh');
    this.timer = 0;
    this.priority = -1;
    this.lastKey = '';
    this.cooldowns = new Map();
  }

  show({ key, main, zh = '', eyebrow = '', tone = 'wave', duration = 1300, priority = 1 }) {
    const now = performance.now();
    if ((this.cooldowns.get(key) ?? 0) > now || (this.root.classList.contains('is-visible') && priority < this.priority)) return false;
    this.lastKey = key;
    this.priority = priority;
    this.eyebrow.textContent = eyebrow;
    this.main.textContent = main;
    this.zh.textContent = zh;
    this.root.dataset.tone = tone;
    this.root.classList.remove('is-visible');
    void this.root.offsetWidth;
    this.root.classList.add('is-visible');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.root.classList.remove('is-visible');
      this.priority = -1;
    }, duration);
    this.cooldowns.set(key, now + Math.min(duration, 1000));
    return true;
  }

  clear() {
    clearTimeout(this.timer);
    this.root.classList.remove('is-visible');
    this.priority = -1;
  }

  dispose() {
    this.clear();
    this.root.remove();
  }
}
