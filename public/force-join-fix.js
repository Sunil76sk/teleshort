/* TeleShort Force Join UI fix: keep the backend as the authority and render every required channel. */
(() => {
  const CHANNELS = [
    { title: 'Main Movie Channel', url: 'https://t.me/+IbHLv5W4jpBkYzBl' },
    { title: 'Backup Public Channel', url: 'https://t.me/kannadanewmovie_sk' }
  ];

  function render() {
    const gate = document.getElementById('ui-force-join');
    const verify = document.getElementById('btn-force-join-verify');
    if (!gate || !verify || gate.classList.contains('hidden')) return;

    let container = document.getElementById('force-join-channels');
    if (!container) {
      container = document.createElement('div');
      container.id = 'force-join-channels';
      container.className = 'space-y-2.5 mb-3';
      verify.parentNode.insertBefore(container, verify);
    }

    container.innerHTML = CHANNELS.map((channel, index) => `
      <a href="${channel.url}" target="_blank" rel="noopener noreferrer"
         class="w-full bg-slate-800 hover:bg-slate-700 text-white font-bold py-3.5 rounded-xl block text-sm border border-slate-700">
        <i class="fa-brands fa-telegram mr-2 text-indigo-400"></i>${index + 1}. ${channel.title}
      </a>
    `).join('');

    const oldButton = document.getElementById('btn-force-join-channel');
    if (oldButton) oldButton.classList.add('hidden');
  }

  const observer = new MutationObserver(render);
  observer.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  document.addEventListener('DOMContentLoaded', render);
  render();
})();
